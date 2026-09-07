import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { FleetTimer, ResourceRewards } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

export type CloudSnapshot = {
  fleets: FleetTimer[];
  settings: Record<string, unknown>;
  rewardSettings?: Record<string, unknown>;
  pinnedExpeditionIds: string[];
  customPresets: unknown[];
  history: unknown[];
  resourceStockSnapshots?: unknown[];
  resourceTargetInputs?: Record<string, unknown>;
  nozakiTimer?: Record<string, unknown>;
  historyClearedAt?: number;
  resourceStockClearedAt?: number;
  monthlyPeriodVersion?: number;
  monthlyCompletions?: Record<string, string[]>;
  setupNotificationTestDone?: boolean;
  setupGuideDismissed?: boolean;
  collapsedPanels: Record<string, boolean>;
  savedAt: string;
  appVersion: string;
};

export type ScheduledNotificationInput = {
  userId: string;
  fleetNo: number;
  expeditionId: string;
  expeditionName: string;
  endAt: number;
  content: string;
  webhookUrl: string;
};

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
};

export type ActiveTimerRecord = {
  fleet_no: number;
  expedition_id: string;
  start_at: string | null;
  end_at: string | null;
  status: "idle" | "running" | "completed" | "cleared" | string;
  pc_notify?: boolean;
  discord_notify?: boolean;
  updated_at?: string | null;
};

export type NotificationLogRecord = {
  id: string;
  fleet_no: number;
  expedition_id: string;
  expedition_name: string;
  end_at: string | null;
  status: "pending" | "sent" | "error" | "cancelled" | string;
  sent_at: string | null;
  error_message: string | null;
  created_at: string | null;
};

export type AuthState = {
  session: Session | null;
  user: User | null;
};

export async function getCurrentAuthState(): Promise<AuthState> {
  if (!supabase) return { session: null, user: null };
  const { data } = await supabase.auth.getSession();
  return { session: data.session, user: data.session?.user ?? null };
}

export async function saveCloudSnapshot(userId: string, snapshot: CloudSnapshot, expected: CloudSnapshot | null): Promise<boolean> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const row = { user_id: userId, settings_json: snapshot, updated_at: new Date().toISOString() };
  if (!expected) {
    const { error } = await supabase.from("user_settings").insert(row);
    if (error?.code === "23505") return false;
    if (error) throw error;
    return true;
  }
  let query = supabase.from("user_settings").update(row).eq("user_id", userId);
  query = expected.savedAt ? query.eq("settings_json->>savedAt", expected.savedAt) : query.is("settings_json->>savedAt", null);
  const { data, error } = await query.select("user_id");
  if (error) throw error;
  return Boolean(data?.length);
}

const operationQueues = new Map<string, Promise<void>>();
function orderedOperation(key: string, operation: () => Promise<void>): Promise<void> {
  const previous = operationQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  operationQueues.set(key, next);
  const cleanup = () => { if (operationQueues.get(key) === next) operationQueues.delete(key); };
  next.then(cleanup, cleanup);
  return next;
}

export async function loadCloudSnapshot(userId: string): Promise<CloudSnapshot | null> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { data, error } = await supabase
    .from("user_settings")
    .select("settings_json")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.settings_json as CloudSnapshot | null) ?? null;
}

async function scheduleCloudNotificationNow(input: ScheduledNotificationInput): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");

  // 同じ艦隊の未送信予約が残っていると二重通知になりやすいので、開始時に古いpendingをキャンセル。
  const { error: cancelError } = await supabase
    .from("scheduled_notifications")
    .update({ status: "cancelled", error_message: "replaced by newer timer" })
    .eq("user_id", input.userId)
    .eq("fleet_no", input.fleetNo)
    .in("status", ["pending", "processing"]);

  if (cancelError) throw cancelError;
  const { error } = await supabase.from("scheduled_notifications").insert({
    user_id: input.userId,
    fleet_no: input.fleetNo,
    expedition_id: input.expeditionId,
    expedition_name: input.expeditionName,
    end_at: new Date(input.endAt).toISOString(),
    content: input.content,
    webhook_url: input.webhookUrl.trim() || "push-only",
    status: "pending"
  });
  if (error) throw error;
}

async function cancelCloudNotificationNow(userId: string, fleetNo: number): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { error } = await supabase
    .from("scheduled_notifications")
    .update({ status: "cancelled", error_message: "cancelled by user" })
    .eq("user_id", userId)
    .eq("fleet_no", fleetNo)
    .in("status", ["pending", "processing"]);
  if (error) throw error;
}

export function scheduleCloudNotification(input: ScheduledNotificationInput): Promise<void> {
  return orderedOperation(`notification:${input.userId}:${input.fleetNo}`, () => scheduleCloudNotificationNow(input));
}
export function cancelCloudNotification(userId: string, fleetNo: number): Promise<void> {
  return orderedOperation(`notification:${userId}:${fleetNo}`, () => cancelCloudNotificationNow(userId, fleetNo));
}

function toActiveTimerRow(userId: string, fleet: FleetTimer, now = Date.now()) {
  if (!fleet.startAt || !fleet.endAt) return null;

  // v3.1: active_timersは「未来に終わるrunning」だけを保存する。
  // 0秒/完了済み/未実行状態を保存すると、別端末のタイマーを0秒に引っ張るため保存しない。
  if (fleet.endAt <= now + 1000) return null;

  return {
    user_id: userId,
    fleet_no: fleet.fleetNo,
    expedition_id: fleet.expeditionId,
    start_at: new Date(fleet.startAt).toISOString(),
    end_at: new Date(fleet.endAt).toISOString(),
    status: "running",
    pc_notify: fleet.pcNotify,
    discord_notify: fleet.discordNotify,
    updated_at: new Date().toISOString()
  };
}


async function saveActiveTimerNow(userId: string, fleet: FleetTimer): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const row = toActiveTimerRow(userId, fleet);
  if (!row) return;
  const { error } = await supabase.from("active_timers").upsert(row, { onConflict: "user_id,fleet_no" });
  if (error) throw error;
}

export function saveActiveTimer(userId: string, fleet: FleetTimer): Promise<void> {
  return orderedOperation(`timer:${userId}:${fleet.fleetNo}`, () => saveActiveTimerNow(userId, fleet));
}
export async function saveActiveTimers(userId: string, fleets: FleetTimer[]): Promise<void> {
  await Promise.all(fleets.map(fleet => saveActiveTimer(userId, fleet)));
}
export function clearActiveTimer(userId: string, fleetNo: number, expeditionId = ""): Promise<void> {
  return orderedOperation(`timer:${userId}:${fleetNo}`, () => clearActiveTimerNow(userId, fleetNo, expeditionId));
}

async function clearActiveTimerNow(userId: string, fleetNo: number, expeditionId = ""): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");

  // v3.1: deleteではなくclearedの墓標を残す。
  // 他端末はこの明示クリアだけを受け取ってタイマーを消す。
  const { error } = await supabase.from("active_timers").upsert(
    {
      user_id: userId,
      fleet_no: fleetNo,
      expedition_id: expeditionId,
      start_at: null,
      end_at: null,
      status: "cleared",
      pc_notify: false,
      discord_notify: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id,fleet_no" }
  );
  if (error) throw error;
}


export async function loadActiveTimers(userId: string): Promise<ActiveTimerRecord[]> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { data, error } = await supabase
    .from("active_timers")
    .select("fleet_no, expedition_id, start_at, end_at, status, pc_notify, discord_notify, updated_at")
    .eq("user_id", userId)
    .order("fleet_no", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ActiveTimerRecord[];
}

export async function savePushSubscription(userId: string, input: PushSubscriptionInput): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent ?? null,
      enabled: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
}

export async function loadNotificationHistory(userId: string, limit = 30): Promise<NotificationLogRecord[]> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { data, error } = await supabase
    .from("scheduled_notifications")
    .select("id, fleet_no, expedition_id, expedition_name, end_at, status, sent_at, error_message, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as NotificationLogRecord[];
}

export async function disablePushSubscription(endpoint: string): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { error } = await supabase
    .from("push_subscriptions")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("endpoint", endpoint);
  if (error) throw error;
}

export function buildRewardSummary(resources: ResourceRewards): string {
  return `燃${resources.fuel} / 弾${resources.ammo} / 鋼${resources.steel} / ボ${resources.bauxite}`;
}
