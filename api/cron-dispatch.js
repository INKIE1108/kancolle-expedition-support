import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const FALLBACK_DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:example@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

function getHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  if (typeof value === "string") return value;
  return "";
}

function getCronSecretFromRequest(req) {
  const authHeader = getHeaderValue(req.headers.authorization);

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  const xCronSecret = getHeaderValue(req.headers["x-cron-secret"]);
  if (xCronSecret.trim()) {
    return xCronSecret.trim();
  }

  const host = getHeaderValue(req.headers.host) || "localhost";
  const protocol = getHeaderValue(req.headers["x-forwarded-proto"]) || "https";
  const url = new URL(req.url || "", `${protocol}://${host}`);

  return url.searchParams.get("secret") || "";
}

function checkCronAuth(req) {
  const expected = CRON_SECRET || "";
  const received = getCronSecretFromRequest(req);

  return Boolean(expected && received && expected === received);
}

function buildPushPayload(content) {
  const cleanBody = String(content || "")
    .replace(/\*\*/g, "")
    .split("\n")
    .slice(0, 4)
    .join("\n");

  return JSON.stringify({
    title: "艦これ遠征サポート",
    body: cleanBody,
    tag: "kancolle-expedition-complete",
    url: "/"
  });
}

async function sendDiscord(webhookUrl, content) {
  if (!webhookUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "webhook_missing"
    };
  }

  const discordResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!discordResponse.ok) {
    throw new Error(`Discord ${discordResponse.status}`);
  }

  return { ok: true };
}

async function sendPushToUser(supabase, userId, content) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return {
      ok: false,
      skipped: true,
      reason: "vapid_missing",
      sent: 0,
      removed: 0,
      errors: []
    };
  }

  if (!userId) {
    return {
      ok: false,
      skipped: true,
      reason: "user_id_missing",
      sent: 0,
      removed: 0,
      errors: []
    };
  }

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId)
    .eq("enabled", true);

  if (error) throw error;

  const subscriptions = data || [];
  let sent = 0;
  let removed = 0;
  const errors = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        buildPushPayload(content)
      );

      sent += 1;
    } catch (error) {
      const statusCode = error?.statusCode;

      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from("push_subscriptions")
          .update({ enabled: false })
          .eq("id", subscription.id);

        removed += 1;
      } else {
        errors.push(error instanceof Error ? error.message : "push_error");
      }
    }
  }

  return {
    ok: errors.length === 0,
    sent,
    removed,
    errors
  };
}

async function markNotificationSent(supabase, id, errorMessage = null) {
  await supabase
    .from("scheduled_notifications")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      error_message: errorMessage
    })
    .eq("id", id);
}

async function markNotificationError(supabase, id, errorInfo) {
  await supabase
    .from("scheduled_notifications")
    .update({
      status: "error",
      error_message: JSON.stringify(errorInfo).slice(0, 1000)
    })
    .eq("id", id);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed",
      allowed: ["GET", "POST"]
    });
  }

  if (!CRON_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "CRON_SECRET is not configured"
    });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Supabase service environment variables are not configured"
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("scheduled_notifications")
    .select("id, user_id, content, webhook_url")
    .eq("status", "pending")
    .lte("end_at", nowIso)
    .order("end_at", { ascending: true })
    .limit(50);

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }

  const results = [];

  for (const item of data || []) {
    const webhookUrl = item.webhook_url || FALLBACK_DISCORD_WEBHOOK_URL;

    const result = {
      id: item.id,
      discord: null,
      push: null,
      status: "sent"
    };

    try {
      result.discord = await sendDiscord(webhookUrl, item.content);
    } catch (error) {
      result.discord = {
        ok: false,
        error: error instanceof Error ? error.message : "discord_error"
      };
    }

    try {
      result.push = await sendPushToUser(supabase, item.user_id, item.content);
    } catch (error) {
      result.push = {
        ok: false,
        error: error instanceof Error ? error.message : "push_error"
      };
    }

    const discordOk = Boolean(result.discord?.ok || result.discord?.skipped);
    const pushOk = Boolean(result.push?.ok || result.push?.skipped);
    const sentSomething = Boolean(result.discord?.ok || (result.push?.sent ?? 0) > 0);

    if (discordOk && pushOk && sentSomething) {
      await markNotificationSent(supabase, item.id, null);
      result.status = "sent";
    } else if (sentSomething) {
      await markNotificationSent(supabase, item.id, "partial notification success");
      result.status = "partial_sent";
    } else {
      await markNotificationError(supabase, item.id, {
        discord: result.discord,
        push: result.push
      });
      result.status = "error";
    }

    results.push(result);
  }

  return res.status(200).json({
    ok: true,
    checkedAt: nowIso,
    count: results.length,
    results
  });
}
