import type { SupabaseClient } from "@supabase/supabase-js";

export type PushDeviceRow = {
  id: string;
  user_id: string;
  endpoint: string;
  enabled: boolean;
  device_label: string | null;
  device_kind: string | null;
  browser_name: string | null;
  os_name: string | null;
  user_agent: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_seen_at: string | null;
  last_tested_at: string | null;
};

export type DeviceStatus = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  currentEndpoint: string | null;
  currentDevice: PushDeviceRow | null;
  devices: PushDeviceRow[];
  registeredCount: number;
  latestRegisteredAt: string | null;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function formatDateTimeJa(value?: string | null) {
  if (!value) return "未登録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未登録";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function detectDeviceInfo() {
  const ua = navigator.userAgent || "";

  const osName =
    /Android/i.test(ua) ? "Android" :
    /iPhone|iPad|iPod/i.test(ua) ? "iOS/iPadOS" :
    /Windows/i.test(ua) ? "Windows" :
    /Macintosh|Mac OS X/i.test(ua) ? "macOS" :
    /Linux/i.test(ua) ? "Linux" :
    "Unknown OS";

  const browserName =
    /Edg\//i.test(ua) ? "Edge" :
    /Chrome\//i.test(ua) && !/Edg\//i.test(ua) ? "Chrome" :
    /Firefox\//i.test(ua) ? "Firefox" :
    /Safari\//i.test(ua) && !/Chrome\//i.test(ua) ? "Safari" :
    "Unknown Browser";

  const deviceKind =
    /Mobi|Android|iPhone/i.test(ua) ? "mobile" :
    /iPad|Tablet/i.test(ua) ? "tablet" :
    "desktop";

  const deviceLabel =
    deviceKind === "mobile" ? `${osName} ${browserName} / スマホ` :
    deviceKind === "tablet" ? `${osName} ${browserName} / タブレット` :
    `${osName} ${browserName} / PC`;

  return {
    osName,
    browserName,
    deviceKind,
    deviceLabel,
    userAgent: ua
  };
}

export function isPushSupported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export async function getCurrentPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function loadDeviceStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<DeviceStatus> {
  const supported = isPushSupported();
  const permission = supported ? Notification.permission : "unsupported";

  const currentSubscription = supported ? await getCurrentPushSubscription() : null;
  const currentEndpoint = currentSubscription?.endpoint ?? null;

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const devices = (data || []) as PushDeviceRow[];
  const currentDevice = currentEndpoint
    ? devices.find((device) => device.endpoint === currentEndpoint) ?? null
    : null;

  const latestRegisteredAt =
    devices
      .map((device) => device.updated_at || device.created_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  return {
    supported,
    permission,
    currentEndpoint,
    currentDevice,
    devices,
    registeredCount: devices.length,
    latestRegisteredAt
  };
}

export async function registerCurrentDevice(
  supabase: SupabaseClient,
  userId: string,
  vapidPublicKey: string
) {
  if (!isPushSupported()) {
    throw new Error("このブラウザはWeb Push通知に対応していません。");
  }

  let permission = Notification.permission;
  if (permission !== "granted") {
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    throw new Error("通知が許可されていません。ブラウザ設定から通知を許可してください。");
  }

  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("通知登録情報を取得できませんでした。");
  }

  const device = detectDeviceInfo();
  const nowIso = new Date().toISOString();

  const { data: existing, error: findError } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;

  if (existing?.id) {
    const { error } = await supabase
      .from("push_subscriptions")
      .update({
        p256dh,
        auth,
        enabled: true,
        device_label: device.deviceLabel,
        device_kind: device.deviceKind,
        browser_name: device.browserName,
        os_name: device.osName,
        user_agent: device.userAgent,
        last_seen_at: nowIso,
        updated_at: nowIso
      })
      .eq("id", existing.id)
      .eq("user_id", userId);

    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("push_subscriptions")
      .insert({
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        enabled: true,
        device_label: device.deviceLabel,
        device_kind: device.deviceKind,
        browser_name: device.browserName,
        os_name: device.osName,
        user_agent: device.userAgent,
        last_seen_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso
      });

    if (error) throw error;
  }

  return endpoint;
}

export async function markCurrentDeviceTested(
  supabase: SupabaseClient,
  userId: string
) {
  const subscription = await getCurrentPushSubscription();
  if (!subscription?.endpoint) return;

  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("push_subscriptions")
    .update({
      last_tested_at: nowIso,
      last_seen_at: nowIso,
      updated_at: nowIso
    })
    .eq("user_id", userId)
    .eq("endpoint", subscription.endpoint);

  if (error) throw error;
}

export async function unregisterCurrentDevice(
  supabase: SupabaseClient,
  userId: string
) {
  const subscription = await getCurrentPushSubscription();
  if (!subscription?.endpoint) {
    throw new Error("この端末には解除できる通知登録がありません。");
  }

  const endpoint = subscription.endpoint;

  const { error } = await supabase
    .from("push_subscriptions")
    .update({
      enabled: false,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", userId)
    .eq("endpoint", endpoint);

  if (error) throw error;

  await subscription.unsubscribe();
}
