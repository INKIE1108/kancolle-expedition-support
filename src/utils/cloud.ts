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
  const { error } = await supabase.from("scheduled_notifications").insert({
    user_id: input.userId,
    fleet_no: input.fleetNo,
    expedition_id: input.expeditionId,
    expedition_name: input.expeditionName,
    end_at: new Date(input.endAt).toISOString(),
    content: input.content,
    status: "pending"
  });
  if (error) throw error;
}

export function buildRewardSummary(resources: ResourceRewards): string {
  return `燃${resources.fuel} / 弾${resources.ammo} / 鋼${resources.steel} / ボ${resources.bauxite}`;
}
