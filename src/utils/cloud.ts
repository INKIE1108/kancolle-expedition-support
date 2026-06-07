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
  pinnedExpeditionIds: string[];
  customPresets: unknown[];
  history: unknown[];
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

export type ActiveTimerRecord = {
  fleet_no: number;
  expedition_id: string;
  start_at: string | null;
  end_at: string | null;
  status: "idle" | "running" | "completed";
  pc_notify?: boolean;
  discord_notify?: boolean;
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

export async function saveCloudSnapshot(userId: string, snapshot: CloudSnapshot): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: userId,
      settings_json: snapshot,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
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

export async function scheduleCloudNotification(input: ScheduledNotificationInput): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  if (!input.webhookUrl.trim()) throw new Error("Discord Webhook URLが未設定です");

  // 同じ艦隊の未送信予約が残っていると二重通知になりやすいので、開始時に古いpendingをキャンセル。
  await supabase
    .from("scheduled_notifications")
    .update({ status: "cancelled", error_message: "replaced by newer timer" })
    .eq("user_id", input.userId)
    .eq("fleet_no", input.fleetNo)
    .eq("status", "pending");

  const { error } = await supabase.from("scheduled_notifications").insert({
    user_id: input.userId,
    fleet_no: input.fleetNo,
    expedition_id: input.expeditionId,
    expedition_name: input.expeditionName,
    end_at: new Date(input.endAt).toISOString(),
    content: input.content,
    webhook_url: input.webhookUrl.trim(),
    status: "pending"
  });
  if (error) throw error;
}

export async function cancelCloudNotification(userId: string, fleetNo: number): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { error } = await supabase
    .from("scheduled_notifications")
    .update({ status: "cancelled", error_message: "cancelled by user" })
    .eq("user_id", userId)
    .eq("fleet_no", fleetNo)
    .eq("status", "pending");
  if (error) throw error;
}

export async function saveActiveTimers(userId: string, fleets: FleetTimer[]): Promise<void> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const rows = fleets.map((fleet) => ({
    user_id: userId,
    fleet_no: fleet.fleetNo,
    expedition_id: fleet.expeditionId,
    start_at: fleet.startAt ? new Date(fleet.startAt).toISOString() : null,
    end_at: fleet.endAt ? new Date(fleet.endAt).toISOString() : null,
    status: fleet.endAt ? (Date.now() >= fleet.endAt ? "completed" : "running") : "idle",
    pc_notify: fleet.pcNotify,
    discord_notify: fleet.discordNotify,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase.from("active_timers").upsert(rows, { onConflict: "user_id,fleet_no" });
  if (error) throw error;
}

export async function loadActiveTimers(userId: string): Promise<ActiveTimerRecord[]> {
  if (!supabase) throw new Error("Supabaseが未設定です");
  const { data, error } = await supabase
    .from("active_timers")
    .select("fleet_no, expedition_id, start_at, end_at, status, pc_notify, discord_notify")
    .eq("user_id", userId)
    .order("fleet_no", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ActiveTimerRecord[];
}

export function buildRewardSummary(resources: ResourceRewards): string {
  return `燃${resources.fuel} / 弾${resources.ammo} / 鋼${resources.steel} / ボ${resources.bauxite}`;
}
