import { createClient } from "@supabase/supabase-js";

const FALLBACK_DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: "Supabase service environment variables are not configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("scheduled_notifications")
    .select("id, content, webhook_url")
    .eq("status", "pending")
    .lte("end_at", nowIso)
    .order("end_at", { ascending: true })
    .limit(20);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const results = [];
  for (const item of data || []) {
    const webhookUrl = item.webhook_url || FALLBACK_DISCORD_WEBHOOK_URL;
    try {
      if (!webhookUrl) throw new Error("Webhook URL is missing for this notification");

      const discordResponse = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: item.content })
      });

      if (!discordResponse.ok) {
        throw new Error(`Discord ${discordResponse.status}`);
      }

      await supabase
        .from("scheduled_notifications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", item.id);

      results.push({ id: item.id, status: "sent" });
    } catch (error) {
      await supabase
        .from("scheduled_notifications")
        .update({ status: "error", error_message: error instanceof Error ? error.message : "unknown" })
        .eq("id", item.id);
      results.push({ id: item.id, status: "error" });
    }
  }

  return res.status(200).json({ ok: true, checkedAt: nowIso, count: results.length, results });
}
