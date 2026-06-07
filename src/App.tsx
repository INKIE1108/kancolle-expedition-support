import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { expeditions as fallbackExpeditions } from "./data/expeditions";
import type { AppSettings, Expedition, FleetTimer, ResourceRewards } from "./types";
import { formatClock, formatDateTime, formatRemaining, minutesToLabel } from "./utils/time";
import { loadFromStorage, saveToStorage } from "./utils/storage";
import {
  buildRewardSummary,
  cancelCloudNotification,
  getCurrentAuthState,
  isSupabaseConfigured,
  loadActiveTimers,
  loadCloudSnapshot,
  loadNotificationHistory,
  saveActiveTimers,
  saveCloudSnapshot,
  savePushSubscription,
  scheduleCloudNotification,
  supabase,
  type AuthState,
  type CloudSnapshot,
  type NotificationLogRecord
} from "./utils/cloud";
import { sendDiscordNotification } from "./utils/notify";
import type { DeviceStatus } from "./utils/deviceNotifications";
import { NotificationDevicePanel } from "./components/NotificationDevicePanel";
import { InitialSetupGuide } from "./components/InitialSetupGuide";

const FLEET_STORAGE_KEY = "kancolle-expedition-fleets-v1";
const SETTINGS_STORAGE_KEY = "kancolle-expedition-settings-v1";
const PINNED_STORAGE_KEY = "kancolle-expedition-pinned-v1";
const SORT_STORAGE_KEY = "kancolle-expedition-sort-v1";
const CUSTOM_PRESETS_STORAGE_KEY = "kancolle-expedition-custom-presets-v1";
const HISTORY_STORAGE_KEY = "kancolle-expedition-history-v1";
const COLLAPSE_STORAGE_KEY = "kancolle-expedition-collapse-v1";
const MONTHLY_STORAGE_KEY = "kancolle-expedition-monthly-v1";
const SETUP_TEST_STORAGE_KEY = "kancolle-expedition-setup-test-v1";

type SortMode =
  | "ID順"
  | "短時間順"
  | "長時間順"
  | "燃料時給順"
  | "弾薬時給順"
  | "鋼材時給順"
  | "ボーキ時給順";

type ExpeditionPreset = {
  id: string;
  name: string;
  description: string;
  fleetExpeditionIds: Record<FleetTimer["fleetNo"], string>;
  custom?: boolean;
  createdAt?: number;
};

type HistoryResult = "success" | "great";

type ExpeditionHistory = {
  id: string;
  completedAt: number;
  fleetNo: FleetTimer["fleetNo"];
  expeditionId: string;
  expeditionName: string;
  result: HistoryResult;
  rewards: ResourceRewards;
  itemReward: string;
};

type MonthlyCompletionMap = Record<string, string[]>;

type GuideMode =
  | "燃料"
  | "弾薬"
  | "鋼材"
  | "ボーキ"
  | "バケツ"
  | "寝る前"
  | "授業・バイト"
  | "短時間";

type CollapsibleKey = "account" | "pwa" | "notifications" | "presets" | "monthly" | "strategy" | "details" | "diagnostics" | "log";

type CollapseState = Record<CollapsibleKey, boolean>;

type MobileTab = "timers" | "assist" | "search" | "account";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const defaultPresets: ExpeditionPreset[] = [
  {
    id: "daily-fuel",
    name: "燃料重視",
    description: "普段回しやすい燃料寄り。燃料を減らしたくない日の基本セット。",
    fleetExpeditionIds: { 2: "05", 3: "21", 4: "38" }
  },
  {
    id: "ammo-steel",
    name: "弾薬・鋼材重視",
    description: "東京急行系を中心に、弾薬と鋼材をまとめて補給。",
    fleetExpeditionIds: { 2: "02", 3: "37", 4: "38" }
  },
  {
    id: "bauxite",
    name: "ボーキ重視",
    description: "防空射撃演習とボーキサイト輸送を中心に航空戦後の回復用。",
    fleetExpeditionIds: { 2: "06", 3: "11", 4: "35" }
  },
  {
    id: "bucket-short",
    name: "バケツ・短時間",
    description: "こまめに触れる時向け。短時間遠征を多めにして回転率優先。",
    fleetExpeditionIds: { 2: "02", 3: "04", 4: "A2" }
  },
  {
    id: "sleep-work",
    name: "寝る前・外出中",
    description: "長めの遠征をセットして、授業・バイト・睡眠中に放置しやすく。",
    fleetExpeditionIds: { 2: "09", 3: "11", 4: "40" }
  }
];

const sortModes: SortMode[] = [
  "ID順",
  "短時間順",
  "長時間順",
  "燃料時給順",
  "弾薬時給順",
  "鋼材時給順",
  "ボーキ時給順"
];

const guideModes: GuideMode[] = ["燃料", "弾薬", "鋼材", "ボーキ", "バケツ", "寝る前", "授業・バイト", "短時間"];

const defaultCollapsedPanels: CollapseState = {
  account: false,
  pwa: false,
  notifications: true,
  presets: false,
  monthly: false,
  strategy: false,
  details: false,
  diagnostics: false,
  log: true
};

const backupStorageKeys = [
  FLEET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  PINNED_STORAGE_KEY,
  SORT_STORAGE_KEY,
  CUSTOM_PRESETS_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  MONTHLY_STORAGE_KEY,
  COLLAPSE_STORAGE_KEY
] as const;

const initialFleets: FleetTimer[] = [2, 3, 4].map((fleetNo) => ({
  fleetNo: fleetNo as 2 | 3 | 4,
  expeditionId: fallbackExpeditions[0]?.id ?? "",
  startAt: null,
  endAt: null,
  notifiedAt: null,
  recordedAt: null,
  pcNotify: false,
  discordNotify: true
}));

const initialSettings: AppSettings = {
  discordWebhookUrl: "",
  discordNotifyMode: "direct",
  serverNotificationMode: "supabase"
};

const resourceKeyMap: Record<Exclude<GuideMode, "バケツ" | "寝る前" | "授業・バイト" | "短時間">, keyof ResourceRewards> = {
  燃料: "fuel",
  弾薬: "ammo",
  鋼材: "steel",
  ボーキ: "bauxite"
};

function getFallbackExpedition(expeditionId: string): Expedition {
  return fallbackExpeditions.find((item) => item.id === expeditionId) ?? fallbackExpeditions[0];
}

function getResourceRate(expedition: Expedition): ResourceRewards {
  const hourFactor = 60 / expedition.durationMinutes;
  return {
    fuel: Math.round(expedition.rewards.fuel * hourFactor),
    ammo: Math.round(expedition.rewards.ammo * hourFactor),
    steel: Math.round(expedition.rewards.steel * hourFactor),
    bauxite: Math.round(expedition.rewards.bauxite * hourFactor)
  };
}

function getTotalResources(resources: ResourceRewards): number {
  return resources.fuel + resources.ammo + resources.steel + resources.bauxite;
}

function multiplyResources(resources: ResourceRewards, multiplier: number): ResourceRewards {
  return {
    fuel: Math.floor(resources.fuel * multiplier),
    ammo: Math.floor(resources.ammo * multiplier),
    steel: Math.floor(resources.steel * multiplier),
    bauxite: Math.floor(resources.bauxite * multiplier)
  };
}

function addResources(a: ResourceRewards, b: ResourceRewards): ResourceRewards {
  return {
    fuel: a.fuel + b.fuel,
    ammo: a.ammo + b.ammo,
    steel: a.steel + b.steel,
    bauxite: a.bauxite + b.bauxite
  };
}

function getPresetRates(preset: ExpeditionPreset): ResourceRewards {
  return Object.values(preset.fleetExpeditionIds).reduce<ResourceRewards>(
    (total, expeditionId) => addResources(total, getResourceRate(getFallbackExpedition(expeditionId))),
    { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  );
}

function formatResources(resources: ResourceRewards): string {
  return `燃${resources.fuel} / 弾${resources.ammo} / 鋼${resources.steel} / ボ${resources.bauxite}`;
}

function getNextActions(expedition: Expedition): string[] {
  const actions = ["艦これ側で遠征帰投を確認", "補給してから再出発"];

  if (expedition.greatSuccess.type === "drum" || expedition.requirements.stats.includes("ドラム缶")) {
    actions.push("ドラム缶の搭載艦数・個数を確認");
  }

  if (expedition.greatSuccess.note.includes("キラ")) {
    actions.push("大成功狙いならキラ状態を確認");
  }

  if (expedition.itemReward !== "なし") {
    actions.push(`入手候補：${expedition.itemReward}`);
  }

  return actions.slice(0, 4);
}

function isSameDay(timestamp: number, base = Date.now()): boolean {
  const a = new Date(timestamp);
  const b = new Date(base);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatShortDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function getMonthKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function isMonthlyExpedition(expedition: Expedition): boolean {
  return expedition.purposeTags.includes("マンスリー") || expedition.id.startsWith("E");
}

function diagnoseNotification(row: NotificationLogRecord): string {
  if (row.status === "pending") return "まだ送信待ち。終了時刻を過ぎたあと、外部cron実行で送信される。";
  if (row.status === "sent") return row.error_message ? "一部成功。Discordまたはスマホ通知の片方で問題があった可能性。" : "送信完了。Discordまたは登録済み端末へ通知済み。";
  if (row.status === "cancelled") return "新しい遠征開始やクリア操作でキャンセル済み。二重通知防止の正常動作。";
  if (row.status === "error") {
    const message = row.error_message || "";
    if (message.includes("webhook_missing")) return "Discord Webhook URLが未設定か空。通知設定を確認。";
    if (message.includes("Discord")) return "Discord側で送信失敗。Webhook URLの削除・権限・チャンネル設定を確認。";
    if (message.includes("push")) return "スマホ/PWA通知で失敗。端末通知登録を再登録してみて。";
    return "送信失敗。error_messageの内容とVercel/cronログを確認。";
  }
  return "状態不明。最新のcron実行履歴とSupabaseの行を確認。";
}

function getGuideDescription(mode: GuideMode): string {
  if (mode === "バケツ") return "高速修復材を狙える遠征を中心に表示。短時間周回にも向く。";
  if (mode === "寝る前") return "長めの遠征を優先。睡眠中や長時間放置で触りにくい時向け。";
  if (mode === "授業・バイト") return "2〜6時間程度の遠征を中心に表示。途中で触りにくい時向け。";
  if (mode === "短時間") return "1時間以内を中心に表示。こまめに触れる時の回転率重視。";
  return `${mode}の時給目安が高い遠征を優先表示。資材不足の時の候補探し向け。`;
}

function buildDiscordContent(fleet: FleetTimer, expedition: Expedition, endAt: number): string {
  return [
    `⏰ **第${fleet.fleetNo}艦隊 遠征完了**`,
    `遠征：${expedition.name}`,
    `終了予定：${formatDateTime(endAt)}`,
    `報酬目安：${buildRewardSummary(expedition.rewards)}`,
    `補給・再出発は手動で確認してね。`
  ].join("\n");
}


function getServerApiUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
  return output;
}

function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function App() {
  const [expeditions, setExpeditions] = useState<Expedition[]>(fallbackExpeditions);
  const [dataStatus, setDataStatus] = useState<"loading" | "external" | "fallback" | "error">("loading");
  const [dataMessage, setDataMessage] = useState<string>("遠征データJSONを読み込み中...");

  const [fleets, setFleets] = useState<FleetTimer[]>(() =>
    loadFromStorage(FLEET_STORAGE_KEY, initialFleets)
  );
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadFromStorage(SETTINGS_STORAGE_KEY, initialSettings)
  );
  const [pinnedExpeditionIds, setPinnedExpeditionIds] = useState<string[]>(() =>
    loadFromStorage(PINNED_STORAGE_KEY, ["02", "05", "06", "09", "11", "21", "37", "38"])
  );
  const [customPresets, setCustomPresets] = useState<ExpeditionPreset[]>(() =>
    loadFromStorage(CUSTOM_PRESETS_STORAGE_KEY, [])
  );
  const [monthlyCompletions, setMonthlyCompletions] = useState<MonthlyCompletionMap>(() =>
    loadFromStorage(MONTHLY_STORAGE_KEY, {})
  );
  const [setupNotificationTestDone, setSetupNotificationTestDone] = useState<boolean>(() =>
    loadFromStorage(SETUP_TEST_STORAGE_KEY, false)
  );
  const [history, setHistory] = useState<ExpeditionHistory[]>(() =>
    loadFromStorage(HISTORY_STORAGE_KEY, [])
  );
  const [selectedDetailId, setSelectedDetailId] = useState<string>(fallbackExpeditions[0]?.id ?? "");
  const [tagFilter, setTagFilter] = useState<string>("すべて");
  const [keyword, setKeyword] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>(() => loadFromStorage(SORT_STORAGE_KEY, "ID順" as SortMode));
  const [guideMode, setGuideMode] = useState<GuideMode>("燃料");
  const [customPresetName, setCustomPresetName] = useState<string>("");
  const [customPresetDescription, setCustomPresetDescription] = useState<string>("");
  const [serverTimeOffsetMs, setServerTimeOffsetMs] = useState<number>(0);
  const [timeSyncMessage, setTimeSyncMessage] = useState<string>("端末時刻で動作中");
  const [timeSyncOk, setTimeSyncOk] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const serverTimeAnchorRef = useRef<{ serverTimeMs: number; performanceMs: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [collapsedPanels, setCollapsedPanels] = useState<CollapseState>(() =>
    loadFromStorage(COLLAPSE_STORAGE_KEY, defaultCollapsedPanels)
  );
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
  });
  const [updateReady, setUpdateReady] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("timers");
  const [compactFleetCards, setCompactFleetCards] = useState<boolean>(() =>
    loadFromStorage("kancolle-expedition-compact-fleet-v1", false)
  );
  const [authState, setAuthState] = useState<AuthState>({ session: null, user: null });
  const [authEmail, setAuthEmail] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [cloudSyncBusy, setCloudSyncBusy] = useState<boolean>(false);
  const [cloudSyncMessage, setCloudSyncMessage] = useState<string>("");
  const [pushMessage, setPushMessage] = useState<string>("");
  const [pushBusy, setPushBusy] = useState<boolean>(false);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<NotificationLogRecord[]>([]);
  const [notificationHistoryBusy, setNotificationHistoryBusy] = useState<boolean>(false);
  const [notificationHistoryMessage, setNotificationHistoryMessage] = useState<string>("");
  const vapidPublicKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "";
  const lastAutoLoadedUserRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  const allPresets = useMemo(() => [...defaultPresets, ...customPresets], [customPresets]);
  const expeditionTags = useMemo(
    () => Array.from(new Set(expeditions.flatMap((expedition) => expedition.purposeTags))).sort(),
    [expeditions]
  );

  function findExpedition(expeditionId: string): Expedition {
    return expeditions.find((item) => item.id === expeditionId) ?? fallbackExpeditions[0];
  }

  function getSyncedNow(): number {
    const anchor = serverTimeAnchorRef.current;
    if (!anchor) return Date.now();
    return anchor.serverTimeMs + (performance.now() - anchor.performanceMs);
  }

  function getPresetRatesFor(preset: ExpeditionPreset): ResourceRewards {
    return Object.values(preset.fleetExpeditionIds).reduce<ResourceRewards>(
      (total, expeditionId) => addResources(total, getResourceRate(findExpedition(expeditionId))),
      { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
    );
  }


  const pinnedExpeditions = useMemo<Expedition[]>(
    () => pinnedExpeditionIds.map((id) => findExpedition(id)).filter(Boolean),
    [pinnedExpeditionIds, expeditions]
  );

  const filteredExpeditions = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const pinnedSet = new Set(pinnedExpeditionIds);
    const result = expeditions.filter((expedition) => {
      const tagOk =
        tagFilter === "すべて" ||
        (tagFilter === "ピン留め" ? pinnedSet.has(expedition.id) : expedition.purposeTags.includes(tagFilter));
      const keywordOk =
        normalizedKeyword.length === 0 ||
        `${expedition.id} ${expedition.name} ${expedition.area} ${expedition.purposeTags.join(" ")}`
          .toLowerCase()
          .includes(normalizedKeyword);
      return tagOk && keywordOk;
    });

    return [...result].sort((a, b) => {
      if (sortMode === "短時間順") return a.durationMinutes - b.durationMinutes;
      if (sortMode === "長時間順") return b.durationMinutes - a.durationMinutes;
      if (sortMode === "燃料時給順") return getResourceRate(b).fuel - getResourceRate(a).fuel;
      if (sortMode === "弾薬時給順") return getResourceRate(b).ammo - getResourceRate(a).ammo;
      if (sortMode === "鋼材時給順") return getResourceRate(b).steel - getResourceRate(a).steel;
      if (sortMode === "ボーキ時給順") return getResourceRate(b).bauxite - getResourceRate(a).bauxite;
      return a.id.localeCompare(b.id, "ja", { numeric: true });
    });
  }, [keyword, tagFilter, pinnedExpeditionIds, sortMode]);

  const guideExpeditions = useMemo(() => {
    if (guideMode === "バケツ") {
      return expeditions
        .filter((expedition) => expedition.itemReward.includes("高速修復材") || expedition.purposeTags.includes("バケツ"))
        .sort((a, b) => a.durationMinutes - b.durationMinutes)
        .slice(0, 6);
    }

    if (guideMode === "寝る前") {
      return expeditions
        .filter((expedition) => expedition.durationMinutes >= 240)
        .sort((a, b) => getTotalResources(getResourceRate(b)) - getTotalResources(getResourceRate(a)))
        .slice(0, 6);
    }

    if (guideMode === "授業・バイト") {
      return expeditions
        .filter((expedition) => expedition.durationMinutes >= 120 && expedition.durationMinutes <= 360)
        .sort((a, b) => getTotalResources(getResourceRate(b)) - getTotalResources(getResourceRate(a)))
        .slice(0, 6);
    }

    if (guideMode === "短時間") {
      return expeditions
        .filter((expedition) => expedition.durationMinutes <= 60)
        .sort((a, b) => getTotalResources(getResourceRate(b)) - getTotalResources(getResourceRate(a)))
        .slice(0, 6);
    }

    const key = resourceKeyMap[guideMode];
    return expeditions
      .filter((expedition) => getResourceRate(expedition)[key] > 0)
      .sort((a, b) => getResourceRate(b)[key] - getResourceRate(a)[key])
      .slice(0, 6);
  }, [guideMode]);

  const selectedDetail = findExpedition(selectedDetailId);
  const totalExpeditionCount = expeditions.length;
  const activeExpeditions = fleets.map((fleet) => findExpedition(fleet.expeditionId));
  const activeHourlyTotal = activeExpeditions.reduce<ResourceRewards>(
    (total, expedition) => addResources(total, getResourceRate(expedition)),
    { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  );
  const currentMonthKey = getMonthKey(now);
  const monthlyExpeditions = useMemo(() => expeditions.filter(isMonthlyExpedition), [expeditions]);
  const currentMonthlyDoneIds = monthlyCompletions[currentMonthKey] ?? [];
  const monthlyDoneCount = monthlyExpeditions.filter((expedition) => currentMonthlyDoneIds.includes(expedition.id)).length;
  const todayHistory = history.filter((item) => isSameDay(item.completedAt, now));
  const todayTotal = todayHistory.reduce<ResourceRewards>(
    (total, item) => addResources(total, item.rewards),
    { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  );
  const todayGreatCount = todayHistory.filter((item) => item.result === "great").length;
  const selectedGreatRewards = multiplyResources(selectedDetail.rewards, 1.5);
  const userId = authState.user?.id ?? null;
  const loggedIn = Boolean(userId);
  const webhookRegistered = Boolean(settings.discordWebhookUrl.trim());
  const deviceRegistered = Boolean(deviceStatus?.currentDevice);
  const testNotificationDone = Boolean(setupNotificationTestDone || deviceStatus?.currentDevice?.last_tested_at || log.some((item) => item.includes("通知テスト")));
  const expeditionStarted = fleets.some((fleet) => fleet.startAt !== null) || log.some((item) => item.includes("開始:") || item.includes("通知予約"));

  useEffect(() => {
    let cancelled = false;

    async function loadExpeditionsJson() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/expeditions.json`, { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = (await response.json()) as Expedition[];
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("遠征データJSONが空です");
        if (!cancelled) {
          setExpeditions(parsed);
          setDataStatus("external");
          setDataMessage(`${parsed.length}件を /data/expeditions.json から読み込み`);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "不明なエラー";
          setExpeditions(fallbackExpeditions);
          setDataStatus("fallback");
          setDataMessage(`外部JSON読込失敗: ${message}。内蔵データで継続`);
        }
      }
    }

    loadExpeditionsJson();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveToStorage(FLEET_STORAGE_KEY, fleets);
  }, [fleets]);

  useEffect(() => {
    saveToStorage(SETTINGS_STORAGE_KEY, settings);
  }, [settings]);

  useEffect(() => {
    saveToStorage(PINNED_STORAGE_KEY, pinnedExpeditionIds);
  }, [pinnedExpeditionIds]);

  useEffect(() => {
    saveToStorage(SORT_STORAGE_KEY, sortMode);
  }, [sortMode]);

  useEffect(() => {
    saveToStorage(CUSTOM_PRESETS_STORAGE_KEY, customPresets);
  }, [customPresets]);

  useEffect(() => {
    saveToStorage(MONTHLY_STORAGE_KEY, monthlyCompletions);
  }, [monthlyCompletions]);

  useEffect(() => {
    saveToStorage(SETUP_TEST_STORAGE_KEY, setupNotificationTestDone);
  }, [setupNotificationTestDone]);

  useEffect(() => {
    saveToStorage(HISTORY_STORAGE_KEY, history);
  }, [history]);

  useEffect(() => {
    saveToStorage(COLLAPSE_STORAGE_KEY, collapsedPanels);
  }, [collapsedPanels]);

  useEffect(() => {
    saveToStorage("kancolle-expedition-compact-fleet-v1", compactFleetCards);
  }, [compactFleetCards]);

  useEffect(() => {
    if (!supabase) return;

    getCurrentAuthState().then(setAuthState).catch(() => undefined);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthState({ session, user: session?.user ?? null });
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authState.user?.id) refreshNotificationHistory().catch(() => undefined);
    else setNotificationHistory([]);
  }, [authState.user?.id]);

  useEffect(() => {
    const userId = authState.user?.id;
    if (!userId || lastAutoLoadedUserRef.current === userId) return;
    lastAutoLoadedUserRef.current = userId;

    applyCloudSnapshot(userId, false).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "クラウド自動読込に失敗";
      setCloudSyncMessage(message);
    });
  }, [authState.user?.id]);

  useEffect(() => {
    const userId = authState.user?.id;
    if (!userId) return;

    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      const snapshot = createCloudSnapshot();
      saveCloudSnapshot(userId, snapshot)
        .then(() => saveActiveTimers(userId, fleets))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "クラウド自動保存に失敗";
          addLog(message);
        });
    }, 900);

    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [authState.user?.id, fleets, settings, pinnedExpeditionIds, customPresets, history, collapsedPanels]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsStandalone(true);
      setInstallPrompt(null);
      addLog("PWAインストールを検出");
    };
    const handlePwaUpdate = () => {
      setUpdateReady(true);
      addLog("新しいバージョンを検出。更新ボタンで反映できるよ");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    window.addEventListener("kancolle-pwa-update", handlePwaUpdate);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      window.removeEventListener("kancolle-pwa-update", handlePwaUpdate);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function syncServerTime() {
      try {
        const requestStartedAtDate = Date.now();
        const requestStartedAtPerf = performance.now();
        const response = await fetch(getServerApiUrl(`/api/server-time?t=${requestStartedAtDate}`), {
          cache: "no-store",
          headers: { "Cache-Control": "no-store" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = (await response.json()) as { serverTimeMs?: number };
        if (typeof parsed.serverTimeMs !== "number") throw new Error("serverTimeMs missing");

        const requestFinishedAtDate = Date.now();
        const requestFinishedAtPerf = performance.now();
        const roundTripDate = requestFinishedAtDate - requestStartedAtDate;
        const roundTripPerf = requestFinishedAtPerf - requestStartedAtPerf;
        const estimatedNetworkDelay = Math.max(0, roundTripPerf / 2);
        const estimatedServerNow = parsed.serverTimeMs + estimatedNetworkDelay;
        const offset = estimatedServerNow - requestFinishedAtDate;

        if (!cancelled) {
          serverTimeAnchorRef.current = {
            serverTimeMs: estimatedServerNow,
            performanceMs: requestFinishedAtPerf
          };
          setServerTimeOffsetMs(offset);
          setTimeSyncOk(true);
          const rounded = Math.round(offset / 1000);
          const latency = Math.round(roundTripDate);
          setTimeSyncMessage(
            Math.abs(rounded) <= 1
              ? `サーバー時刻で計測中（通信${latency}ms）`
              : `サーバー時刻で計測中（端末差 ${rounded > 0 ? "+" : ""}${rounded}秒 / 通信${latency}ms）`
          );
          setNow(getSyncedNow());
        }
      } catch {
        if (!cancelled) {
          serverTimeAnchorRef.current = null;
          setTimeSyncOk(false);
          setTimeSyncMessage("サーバー時刻同期に失敗。端末時刻で暫定計測中");
        }
      }
    }

    syncServerTime();
    const syncTimer = window.setInterval(syncServerTime, 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
    };
  }, []);

  useEffect(() => {
    setNow(getSyncedNow());
    const timer = window.setInterval(() => setNow(getSyncedNow()), 1000);
    return () => window.clearInterval(timer);
  }, [serverTimeOffsetMs]);

  useEffect(() => {
    const completedFleets = fleets.filter(
      (fleet) => fleet.endAt !== null && fleet.notifiedAt === null && now >= fleet.endAt
    );

    if (completedFleets.length === 0) return;

    completedFleets.forEach((fleet) => {
      const expedition = findExpedition(fleet.expeditionId);
      addLog(`遠征完了: 第${fleet.fleetNo}艦隊 ${expedition.name}`);
    });

    setFleets((current) =>
      current.map((fleet) => {
        if (fleet.endAt !== null && fleet.notifiedAt === null && now >= fleet.endAt) {
          return { ...fleet, notifiedAt: now };
        }
        return fleet;
      })
    );
  }, [now, fleets]);

  function addLog(message: string) {
    const stamped = `${new Intl.DateTimeFormat("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date())} ${message}`;
    setLog((current) => [stamped, ...current].slice(0, 12));
  }

  function isPinned(expeditionId: string) {
    return pinnedExpeditionIds.includes(expeditionId);
  }

  function togglePin(expeditionId: string) {
    setPinnedExpeditionIds((current) => {
      if (current.includes(expeditionId)) {
        return current.filter((id) => id !== expeditionId);
      }
      return [...current, expeditionId];
    });
  }

  function movePinned(expeditionId: string, direction: -1 | 1) {
    setPinnedExpeditionIds((current) => {
      const index = current.indexOf(expeditionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [target] = next.splice(index, 1);
      next.splice(nextIndex, 0, target);
      return next;
    });
  }

  function updateFleet(fleetNo: FleetTimer["fleetNo"], patch: Partial<FleetTimer>) {
    setFleets((current) =>
      current.map((fleet) => (fleet.fleetNo === fleetNo ? { ...fleet, ...patch } : fleet))
    );
  }

  function setFleetExpedition(fleetNo: FleetTimer["fleetNo"], expeditionId: string) {
    updateFleet(fleetNo, {
      expeditionId,
      startAt: null,
      endAt: null,
      notifiedAt: null,
      recordedAt: null
    });
    setSelectedDetailId(expeditionId);
  }

  function startFleet(fleet: FleetTimer) {
    const expedition = findExpedition(fleet.expeditionId);
    const startAt = getSyncedNow();
    const endAt = startAt + expedition.durationMinutes * 60 * 1000;
    updateFleet(fleet.fleetNo, { startAt, endAt, notifiedAt: null, recordedAt: null });
    addLog(`開始: 第${fleet.fleetNo}艦隊 ${expedition.name}`);

    if (fleet.discordNotify) {
      if (!authState.user) {
        addLog("通知予約は提督ログイン後に使えるよ");
        return;
      }
      if (!settings.discordWebhookUrl.trim()) {
        addLog("Discord Webhook URLを設定してから通知予約してね");
        return;
      }
      scheduleCloudNotification({
        userId: authState.user.id,
        fleetNo: fleet.fleetNo,
        expeditionId: expedition.id,
        expeditionName: expedition.name,
        endAt,
        content: buildDiscordContent(fleet, expedition, endAt),
        webhookUrl: settings.discordWebhookUrl
      })
        .then(() => addLog(`サーバー側通知を予約: 第${fleet.fleetNo}艦隊 ${expedition.name}`))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "サーバー側通知予約に失敗";
          addLog(message);
        });
    }
  }

  function restartFleet(fleet: FleetTimer) {
    startFleet(fleet);
  }

  function clearFleet(fleetNo: FleetTimer["fleetNo"]) {
    updateFleet(fleetNo, { startAt: null, endAt: null, notifiedAt: null, recordedAt: null });
    if (authState.user) {
      cancelCloudNotification(authState.user.id, fleetNo).catch(() => undefined);
    }
    addLog(`クリア: 第${fleetNo}艦隊`);
  }

  function applyPreset(preset: ExpeditionPreset) {
    setFleets((current) =>
      current.map((fleet) => ({
        ...fleet,
        expeditionId: preset.fleetExpeditionIds[fleet.fleetNo],
        startAt: null,
        endAt: null,
        notifiedAt: null,
        recordedAt: null
      }))
    );
    setSelectedDetailId(preset.fleetExpeditionIds[2]);
    addLog(`プリセット適用: ${preset.name}`);
  }

  function createCustomPreset() {
    const name = customPresetName.trim();
    if (!name) {
      addLog("カスタムプリセット名を入力してね");
      return;
    }

    const preset: ExpeditionPreset = {
      id: `custom-${Date.now()}`,
      name,
      description: customPresetDescription.trim() || "現在の第2〜第4艦隊から作成したカスタムセット。",
      custom: true,
      createdAt: Date.now(),
      fleetExpeditionIds: {
        2: fleets.find((fleet) => fleet.fleetNo === 2)?.expeditionId ?? expeditions[0].id,
        3: fleets.find((fleet) => fleet.fleetNo === 3)?.expeditionId ?? expeditions[0].id,
        4: fleets.find((fleet) => fleet.fleetNo === 4)?.expeditionId ?? expeditions[0].id
      }
    };

    setCustomPresets((current) => [preset, ...current].slice(0, 20));
    setCustomPresetName("");
    setCustomPresetDescription("");
    addLog(`カスタムプリセット作成: ${preset.name}`);
  }

  function deleteCustomPreset(presetId: string) {
    const target = customPresets.find((preset) => preset.id === presetId);
    setCustomPresets((current) => current.filter((preset) => preset.id !== presetId));
    if (target) addLog(`カスタムプリセット削除: ${target.name}`);
  }
  function isMonthlyDone(expeditionId: string): boolean {
    return (monthlyCompletions[currentMonthKey] ?? []).includes(expeditionId);
  }

  function setMonthlyDone(expeditionId: string, done: boolean) {
    setMonthlyCompletions((current) => {
      const monthItems = new Set(current[currentMonthKey] ?? []);
      if (done) monthItems.add(expeditionId);
      else monthItems.delete(expeditionId);
      return { ...current, [currentMonthKey]: Array.from(monthItems).sort((a, b) => a.localeCompare(b, "ja", { numeric: true })) };
    });
    const expedition = findExpedition(expeditionId);
    addLog(`マンスリー遠征${done ? "実施済み" : "未実施へ戻す"}: ${expedition.id} ${expedition.name}`);
  }

  function resetMonthlyCompletions() {
    const ok = window.confirm(`${getMonthLabel(currentMonthKey)}のマンスリー遠征チェックをリセットする？`);
    if (!ok) return;
    setMonthlyCompletions((current) => ({ ...current, [currentMonthKey]: [] }));
    addLog(`${getMonthLabel(currentMonthKey)}のマンスリー遠征チェックをリセット`);
  }


  function recordFleetResult(fleet: FleetTimer, result: HistoryResult) {
    if (fleet.recordedAt) return;
    const expedition = findExpedition(fleet.expeditionId);
    const rewards = result === "great" ? multiplyResources(expedition.rewards, 1.5) : expedition.rewards;
    const record: ExpeditionHistory = {
      id: `${Date.now()}-${fleet.fleetNo}-${expedition.id}-${result}`,
      completedAt: Date.now(),
      fleetNo: fleet.fleetNo,
      expeditionId: expedition.id,
      expeditionName: expedition.name,
      result,
      rewards,
      itemReward: expedition.itemReward
    };

    setHistory((current) => [record, ...current].slice(0, 200));
    if (isMonthlyExpedition(expedition)) {
      setMonthlyCompletions((current) => {
        const monthItems = new Set(current[currentMonthKey] ?? []);
        monthItems.add(expedition.id);
        return { ...current, [currentMonthKey]: Array.from(monthItems).sort((a, b) => a.localeCompare(b, "ja", { numeric: true })) };
      });
    }
    updateFleet(fleet.fleetNo, { recordedAt: Date.now() });
    addLog(`帰投記録: 第${fleet.fleetNo}艦隊 ${expedition.name}（${result === "great" ? "大成功" : "成功"}）`);
  }

  function clearHistory() {
    const ok = window.confirm("遠征履歴をすべて削除しますか？");
    if (!ok) return;
    setHistory([]);
    addLog("遠征履歴を削除");
  }

  function handlePanelToggle(panel: CollapsibleKey, open: boolean) {
    setCollapsedPanels((current) => ({ ...current, [panel]: !open }));
  }

  function openAllPanels() {
    setCollapsedPanels({ account: false, pwa: false, notifications: false, presets: false, monthly: false, strategy: false, details: false, diagnostics: false, log: false });
  }

  function compactAssistPanels() {
    setCollapsedPanels({ account: false, pwa: true, notifications: true, presets: true, monthly: true, strategy: true, details: false, diagnostics: false, log: true });
  }

  async function installPwa() {
    if (!installPrompt) {
      addLog("インストール候補がまだ出ていないよ。HTTPS/localhostで開いているか確認してね");
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    addLog(choice.outcome === "accepted" ? "PWAインストールを開始" : "PWAインストールをキャンセル");
    setInstallPrompt(null);
  }

  function applyPwaUpdate() {
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
      window.setTimeout(() => window.location.reload(), 800);
      return;
    }

    window.location.reload();
  }

  function exportBackup() {
    const backup = {
      app: "kancolle-expedition-support",
      version: "2.7.0",
      exportedAt: new Date().toISOString(),
      localStorage: backupStorageKeys.reduce<Record<string, string | null>>((items, key) => {
        items[key] = window.localStorage.getItem(key);
        return items;
      }, {})
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kancolle-expedition-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    addLog("設定バックアップを書き出し");
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { localStorage?: Record<string, string | null> };
      if (!parsed.localStorage) throw new Error("バックアップ形式が違うかも");

      backupStorageKeys.forEach((key) => {
        const value = parsed.localStorage?.[key];
        if (typeof value === "string") {
          window.localStorage.setItem(key, value);
        }
      });

      addLog("設定バックアップを読み込み。画面を再読み込みするね");
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      const message = error instanceof Error ? error.message : "バックアップ読み込みに失敗";
      addLog(message);
    } finally {
      event.target.value = "";
    }
  }

  function createCloudSnapshot(): CloudSnapshot {
    return {
      fleets,
      settings: { ...settings, discordNotifyMode: "direct", serverNotificationMode: "supabase" },
      pinnedExpeditionIds,
      customPresets,
      history,
      monthlyCompletions,
      setupNotificationTestDone,
      collapsedPanels,
      savedAt: new Date().toISOString(),
      appVersion: "2.7.0"
    };
  }

  function mergeActiveTimerRows(baseFleets: FleetTimer[], rows: Awaited<ReturnType<typeof loadActiveTimers>>): FleetTimer[] {
    if (rows.length === 0) return baseFleets;
    return baseFleets.map((fleet) => {
      const row = rows.find((item) => item.fleet_no === fleet.fleetNo);
      if (!row) return fleet;
      const startAt = row.start_at ? new Date(row.start_at).getTime() : null;
      const endAt = row.end_at ? new Date(row.end_at).getTime() : null;
      return {
        ...fleet,
        expeditionId: row.expedition_id || fleet.expeditionId,
        startAt,
        endAt,
        notifiedAt: null,
        recordedAt: null,
        pcNotify: Boolean(row.pc_notify),
        discordNotify: row.discord_notify ?? fleet.discordNotify
      };
    });
  }

  async function applyCloudSnapshot(userId: string, ask = true) {
    const ok = !ask || window.confirm("クラウド保存データで現在のローカル設定を上書きしますか？");
    if (!ok) return false;

    const snapshot = await loadCloudSnapshot(userId);
    const activeRows = await loadActiveTimers(userId).catch(() => []);
    if (!snapshot && activeRows.length === 0) {
      setCloudSyncMessage("クラウド保存データはまだないよ");
      return false;
    }

    const nextFleets = mergeActiveTimerRows((snapshot?.fleets as FleetTimer[] | undefined) ?? initialFleets, activeRows);
    setFleets(nextFleets);
    setSettings({ ...initialSettings, ...((snapshot?.settings as AppSettings | undefined) ?? {}), discordNotifyMode: "direct", serverNotificationMode: "supabase" });
    setPinnedExpeditionIds(snapshot?.pinnedExpeditionIds ?? pinnedExpeditionIds);
    setCustomPresets((snapshot?.customPresets as ExpeditionPreset[] | undefined) ?? customPresets);
    setHistory((snapshot?.history as ExpeditionHistory[] | undefined) ?? history);
    setMonthlyCompletions((snapshot?.monthlyCompletions as MonthlyCompletionMap | undefined) ?? monthlyCompletions);
    setSetupNotificationTestDone(Boolean(snapshot?.setupNotificationTestDone ?? setupNotificationTestDone));
    setCollapsedPanels((snapshot?.collapsedPanels as CollapseState | undefined) ?? collapsedPanels);
    setCloudSyncMessage(snapshot ? `クラウドから読み込んだよ（${new Date(snapshot.savedAt).toLocaleString("ja-JP")}保存）` : "実行中タイマーをクラウドから読み込んだよ");
    addLog("クラウド読込完了");
    return true;
  }

  async function signUp() {
    if (!supabase) {
      setCloudSyncMessage("Supabase環境変数が未設定です");
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setCloudSyncMessage("メールアドレスとパスワードを入力してね");
      return;
    }
    setCloudSyncBusy(true);
    try {
      const { error } = await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword });
      if (error) throw error;
      setCloudSyncMessage("アカウント作成を受け付けたよ。メール確認が必要な設定ならメールも確認してね。");
      addLog("提督アカウント作成");
    } catch (error) {
      setCloudSyncMessage(error instanceof Error ? error.message : "アカウント作成に失敗");
    } finally {
      setCloudSyncBusy(false);
    }
  }

  async function signIn() {
    if (!supabase) {
      setCloudSyncMessage("Supabase環境変数が未設定です");
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setCloudSyncMessage("メールアドレスとパスワードを入力してね");
      return;
    }
    setCloudSyncBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
      if (error) throw error;
      setCloudSyncMessage("ログインしたよ");
      addLog("提督アカウントでログイン");
    } catch (error) {
      setCloudSyncMessage(error instanceof Error ? error.message : "ログインに失敗");
    } finally {
      setCloudSyncBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setCloudSyncMessage("ログアウトしたよ");
    addLog("ログアウト");
  }

  async function saveCloud() {
    if (!authState.user) {
      setCloudSyncMessage("クラウド保存はログイン後に使えるよ");
      return;
    }
    setCloudSyncBusy(true);
    try {
      await saveCloudSnapshot(authState.user.id, createCloudSnapshot());
      setCloudSyncMessage("クラウドへ保存したよ");
      addLog("クラウド保存完了");
    } catch (error) {
      setCloudSyncMessage(error instanceof Error ? error.message : "クラウド保存に失敗");
    } finally {
      setCloudSyncBusy(false);
    }
  }

  async function loadCloud() {
    if (!authState.user) {
      setCloudSyncMessage("クラウド読込はログイン後に使えるよ");
      return;
    }
    setCloudSyncBusy(true);
    try {
      await applyCloudSnapshot(authState.user.id, true);
    } catch (error) {
      setCloudSyncMessage(error instanceof Error ? error.message : "クラウド読込に失敗");
    } finally {
      setCloudSyncBusy(false);
    }
  }


  async function refreshNotificationHistory() {
    if (!authState.user) {
      setNotificationHistory([]);
      setNotificationHistoryMessage("通知履歴はログイン後に確認できるよ");
      return;
    }
    setNotificationHistoryBusy(true);
    try {
      const rows = await loadNotificationHistory(authState.user.id, 30);
      setNotificationHistory(rows);
      setNotificationHistoryMessage(rows.length ? `通知履歴を${rows.length}件読み込んだよ` : "通知履歴はまだないよ");
    } catch (error) {
      const message = error instanceof Error ? error.message : "通知履歴の読み込みに失敗";
      setNotificationHistoryMessage(message);
      addLog(message);
    } finally {
      setNotificationHistoryBusy(false);
    }
  }

  async function runSetupNotificationTest() {
    const pushOk = await testLocalNotification();
    const discordOk = await testDiscord();
    if (pushOk || discordOk) {
      setSetupNotificationTestDone(true);
    }
  }


  async function enableWebPush() {
    if (!authState.user) {
      setPushMessage("スマホ通知は提督ログイン後に有効化してね");
      return;
    }
    if (!vapidPublicKey) {
      setPushMessage("VITE_VAPID_PUBLIC_KEYが未設定です");
      return;
    }
    if (!isPushSupported()) {
      setPushMessage("このブラウザはWeb Push通知に未対応です");
      return;
    }

    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("通知が許可されませんでした");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource
        }));

      const json = subscription.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!json.endpoint || !p256dh || !auth) throw new Error("Push購読情報を取得できませんでした");

      await savePushSubscription(authState.user.id, {
        endpoint: json.endpoint,
        p256dh,
        auth,
        userAgent: navigator.userAgent
      });
      setPushMessage("スマホ/PWA通知を有効化したよ。通知予約の送信時にDiscordと一緒に届くよ");
      addLog("Web Push通知を有効化");
    } catch (error) {
      const message = error instanceof Error ? error.message : "スマホ通知の有効化に失敗";
      setPushMessage(message);
      addLog(message);
    } finally {
      setPushBusy(false);
    }
  }

  async function testLocalNotification(): Promise<boolean> {
    if (!isPushSupported()) {
      setPushMessage("このブラウザは通知テストに未対応です");
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("通知が許可されませんでした");
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("艦これ遠征サポート", {
        body: "スマホ/PWA通知テストだよ。遠征完了時はサーバー側通知予約から届くよ。",
        icon: `${import.meta.env.BASE_URL}icon-192.png`,
        badge: `${import.meta.env.BASE_URL}icon-192.png`,
        tag: "kancolle-test",
        data: { url: window.location.href }
      });
      setPushMessage("端末通知テストを表示したよ");
      setSetupNotificationTestDone(true);
      addLog("端末通知テストを表示");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "端末通知テストに失敗";
      setPushMessage(message);
      addLog(message);
      return false;
    }
  }

  async function testDiscord(): Promise<boolean> {
    const dummyFleet: FleetTimer = {
      fleetNo: 2,
      expeditionId: expeditions[0].id,
      startAt: getSyncedNow(),
      endAt: getSyncedNow(),
      notifiedAt: null,
      recordedAt: null,
      pcNotify: false,
      discordNotify: true
    };

    try {
      if (!settings.discordWebhookUrl.trim()) throw new Error("Discord Webhook URLが未設定です");
      await sendDiscordNotification(settings.discordWebhookUrl, dummyFleet, expeditions[0], "direct");
      setSetupNotificationTestDone(true);
      addLog("Discordテスト通知に成功");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discordテスト通知に失敗";
      addLog(message);
      return false;
    }
  }

  return (
    <main className={`app-shell mobile-tab-${mobileTab} ${compactFleetCards ? "compact-fleets" : ""}`}>
      <header className="hero">
        <div>
          <p className="eyebrow">KanColle Expedition Support v2.7</p>
          <h1>艦これ遠征サポート</h1>
          <p>
            艦これ本体は手動操作のまま、遠征の終了時刻・成功条件・通知予約・よく使う遠征セットをまとめて管理するサポートツール。
            v2.7ではマンスリー遠征管理と通知履歴・失敗診断を追加。現在の収録遠征は<strong>{totalExpeditionCount}件</strong>、お気に入りは<strong>{pinnedExpeditionIds.length}件</strong>。
            <br />
            遠征データ：<strong>{dataStatus === "external" ? "外部JSON" : dataStatus === "fallback" ? "内蔵フォールバック" : dataStatus === "error" ? "JSON読み込み失敗" : "読み込み中"}</strong>（{dataMessage}）
          </p>
        </div>
        <div className="hero-clock">
          <span>現在時刻</span>
          <strong>{formatClock(now)}</strong>
          <small>{timeSyncMessage}</small>
        </div>
        <div className="hero-actions">
          <button type="button" className="secondary small" onClick={compactAssistPanels}>補助機能を折りたたむ</button>
          <button type="button" className="ghost small" onClick={openAllPanels}>すべて開く</button>
          <button type="button" className="ghost small" onClick={() => setCompactFleetCards((value) => !value)}>
            {compactFleetCards ? "通常カード" : "簡易カード"}
          </button>
        </div>
      </header>

      <details
        id="account-cloud-section"
        className="account-card fold-card"
        open={!collapsedPanels.account}
        onToggle={(event) => handlePanelToggle("account", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Account / Cloud</small><strong>提督ログイン・クラウド同期</strong></span>
          <em>{collapsedPanels.account ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content account-grid">
          <div>
            <h2>提督アカウント</h2>
            <p>メールアドレスとパスワードでログインすると、お気に入り、カスタムプリセット、遠征履歴、実行中タイマーを提督アカウントごとに保存できるよ。PCで保存して、スマホで同じアカウントから読み込める。</p>
            <p className="helper-text">状態：{isSupabaseConfigured ? (authState.user ? `ログイン中：${authState.user.email}` : "Supabase設定済み / 未ログイン") : "Supabase未設定"}</p>
          </div>
          <div className="account-form">
            {!authState.user ? (
              <>
                <input value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="メールアドレス" type="email" />
                <input value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="パスワード" type="password" />
                <button type="button" onClick={signIn} disabled={!isSupabaseConfigured || cloudSyncBusy}>ログイン</button>
                <button type="button" className="secondary" onClick={signUp} disabled={!isSupabaseConfigured || cloudSyncBusy}>新規登録</button>
              </>
            ) : (
              <>
                <button type="button" onClick={saveCloud} disabled={cloudSyncBusy}>クラウドへ保存</button>
                <button type="button" className="secondary" onClick={loadCloud} disabled={cloudSyncBusy}>クラウドから読込</button>
                <button type="button" className="ghost" onClick={signOut}>ログアウト</button>
              </>
            )}
          </div>
          <div className="cloud-message">{cloudSyncMessage || "初めて使う場合は新規登録 → ログイン。ログイン後は「クラウドへ保存」「クラウドから読込」で端末間同期できるよ。"}</div>
        </div>
      </details>

      <InitialSetupGuide
        loggedIn={loggedIn}
        webhookRegistered={webhookRegistered}
        deviceRegistered={deviceRegistered}
        testNotificationDone={testNotificationDone}
        expeditionStarted={expeditionStarted}
        onJumpAccount={() => document.getElementById("account-cloud-section")?.scrollIntoView({ behavior: "smooth" })}
        onJumpNotification={() => document.getElementById("notification-section")?.scrollIntoView({ behavior: "smooth" })}
        onJumpTimer={() => document.getElementById("fleet-timer-section")?.scrollIntoView({ behavior: "smooth" })}
        onTestNotification={runSetupNotificationTest}
      />

      <details
        className="pwa-card fold-card"
        open={!collapsedPanels.pwa}
        onToggle={(event) => handlePanelToggle("pwa", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>PWA</small><strong>PWA実用設定・バックアップ</strong></span>
          <em>{collapsedPanels.pwa ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content pwa-grid">
          <div className="pwa-status">
            <span className={isStandalone ? "status-dot ok" : "status-dot"}>{isStandalone ? "インストール済み/スタンドアロン" : "ブラウザ表示"}</span>
            <span className={isOnline ? "status-dot ok" : "status-dot warn"}>{isOnline ? "オンライン" : "オフライン"}</span>
            <span className={updateReady ? "status-dot warn" : "status-dot ok"}>{updateReady ? "更新あり" : "最新状態"}</span>
          </div>
          <div className="pwa-actions">
            <button type="button" onClick={installPwa} disabled={!installPrompt || isStandalone}>アプリとしてインストール</button>
            <button type="button" className="secondary" onClick={applyPwaUpdate} disabled={!updateReady}>新しい版に更新</button>
            <button type="button" className="secondary" onClick={exportBackup}>設定を書き出し</button>
            <label className="file-button">
              設定を読み込み
              <input type="file" accept="application/json" onChange={importBackup} />
            </label>
          </div>
          <p className="helper-text">URLからそのまま使えるWebアプリ。ホーム画面に追加するとアプリっぽく起動できるよ。手元に控えを残したい時は「設定を書き出し」、別端末や再設定時は「設定を読み込み」を使ってね。</p>
        </div>
      </details>

      <details
        id="notification-section"
        className="settings-card fold-card"
        open={!collapsedPanels.notifications}
        onToggle={(event) => handlePanelToggle("notifications", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Notification</small><strong>通知設定</strong></span>
          <em>{collapsedPanels.notifications ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content settings-content">
        <div>
          <h2>通知設定</h2>
          <p>
            通知は「通知予約」に一本化。Discord Webhook URLを保存し、必要ならスマホ/PWA通知も有効化しておくと、遠征終了時にDiscordとスマホ通知の両方で受け取りやすくなるよ。
          </p>
        </div>
        <div className="settings-grid simplified">
          <input
            value={settings.discordWebhookUrl}
            onChange={(event) =>
              setSettings((current) => ({ ...current, discordWebhookUrl: event.target.value, discordNotifyMode: "direct", serverNotificationMode: "supabase" }))
            }
            placeholder="Discord Webhook URL（提督ごとにクラウド保存）"
            type="password"
          />
          <button className="secondary" onClick={testDiscord} disabled={!settings.discordWebhookUrl.trim()}>
            Discordテスト
          </button>
          <button className="secondary" type="button" onClick={enableWebPush} disabled={pushBusy || !authState.user || !vapidPublicKey}>
            スマホ通知を有効化
          </button>
          <button className="ghost" type="button" onClick={testLocalNotification} disabled={!isPushSupported()}>
            端末通知テスト
          </button>
        </div>
        <p className="helper-text">遠征開始時に、終了予定時刻・Discord通知先・スマホ通知先をクラウドへ保存する。実際の送信はcron-dispatchが定期実行された時に行うよ。</p>
        <p className="helper-text">{pushMessage || (vapidPublicKey ? "スマホ通知は、ホーム画面に追加したPWAや対応ブラウザで通知許可すると使えるよ。" : "スマホ通知を使うにはVAPIDキーの設定が必要です。")}</p>
        <NotificationDevicePanel
          supabase={supabase}
          userId={userId}
          vapidPublicKey={vapidPublicKey}
          onSendTestNotification={testLocalNotification}
          onStatusChange={setDeviceStatus}
        />
        </div>
      </details>

      <details
        className="preset-card fold-card"
        open={!collapsedPanels.presets}
        onToggle={(event) => handlePanelToggle("presets", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Preset</small><strong>おすすめ遠征セット</strong></span>
          <em>{collapsedPanels.presets ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content">
        <div className="section-head">
          <div>
            <p className="eyebrow">Preset</p>
            <h2>おすすめ遠征セット</h2>
            <p>目的別に第2〜第4艦隊へまとめてセット。開始は押さないので、補給確認後に手動で出せる。</p>
          </div>
          <div className="hourly-total">
            <span>現在選択中の合計時給目安</span>
            <strong>{formatResources(activeHourlyTotal)} / h</strong>
          </div>
        </div>
        <div className="preset-grid">
          {allPresets.map((preset) => {
            const rates = getPresetRatesFor(preset);
            const presetNames = [2, 3, 4]
              .map((fleetNo) => `${fleetNo}: ${findExpedition(preset.fleetExpeditionIds[fleetNo as 2 | 3 | 4]).name}`)
              .join(" / ");
            return (
              <div className={`preset-button-wrap ${preset.custom ? "custom" : ""}`} key={preset.id}>
                <button className="preset-button" type="button" onClick={() => applyPreset(preset)}>
                  <span>{preset.custom ? "自作：" : ""}{preset.name}</span>
                  <small>{preset.description}</small>
                  <em>{presetNames}</em>
                  <strong>{formatResources(rates)} / h</strong>
                </button>
                {preset.custom && (
                  <button className="delete-preset" type="button" onClick={() => deleteCustomPreset(preset.id)}>
                    削除
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="custom-preset-card">
          <div>
            <p className="eyebrow">Custom</p>
            <h3>今の第2〜第4艦隊でカスタムプリセットを作成</h3>
            <p>いつもの遠征ルーティンを名前付きで保存できる。保存後は上のプリセット欄からワンタップ適用。</p>
          </div>
          <div className="custom-preset-form">
            <input
              value={customPresetName}
              onChange={(event) => setCustomPresetName(event.target.value)}
              placeholder="例：平日夜の東急セット"
            />
            <input
              value={customPresetDescription}
              onChange={(event) => setCustomPresetDescription(event.target.value)}
              placeholder="メモ：燃料と鋼材を戻したい時用 など"
            />
            <button type="button" onClick={createCustomPreset}>現在の編成を保存</button>
          </div>
        </div>
        </div>
      </details>

      <details
        className="monthly-card fold-card"
        open={!collapsedPanels.monthly}
        onToggle={(event) => handlePanelToggle("monthly", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Monthly</small><strong>マンスリー遠征管理</strong></span>
          <em>{collapsedPanels.monthly ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content monthly-content">
          <div className="section-head">
            <div>
              <p className="eyebrow">Monthly Expedition</p>
              <h2>{getMonthLabel(currentMonthKey)}のマンスリー遠征</h2>
              <p>今月実施済みにしたマンスリー遠征は、艦隊カードの選択候補から選べないようにして誤出撃を防ぐよ。完了後に「成功/大成功で記録」しても自動で実施済みになる。</p>
            </div>
            <div className="monthly-score">
              <span>進捗</span>
              <strong>{monthlyDoneCount} / {monthlyExpeditions.length}</strong>
              <button type="button" className="ghost small" onClick={resetMonthlyCompletions} disabled={monthlyDoneCount === 0}>今月分をリセット</button>
            </div>
          </div>

          {monthlyExpeditions.length === 0 ? (
            <p className="empty-text">マンスリー遠征タグ付きの遠征データがまだありません。</p>
          ) : (
            <div className="monthly-grid">
              {monthlyExpeditions.map((expedition) => {
                const done = isMonthlyDone(expedition.id);
                return (
                  <article className={`monthly-item ${done ? "done" : ""}`} key={`monthly-${expedition.id}`}>
                    <div>
                      <div className="monthly-item-head">
                        <strong>{expedition.id}: {expedition.name}</strong>
                        <span>{done ? "今月実施済み" : "未実施"}</span>
                      </div>
                      <p>{minutesToLabel(expedition.durationMinutes)} / {expedition.purposeTags.join("・")}</p>
                      <small>{expedition.memo}</small>
                    </div>
                    <div className="monthly-actions">
                      <button type="button" className={done ? "secondary" : ""} onClick={() => setMonthlyDone(expedition.id, !done)}>
                        {done ? "未実施へ戻す" : "実施済みにする"}
                      </button>
                      <button type="button" className="ghost" onClick={() => setSelectedDetailId(expedition.id)}>詳細を見る</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </details>

      <details
        className="guide-card fold-card"
        open={!collapsedPanels.strategy}
        onToggle={(event) => handlePanelToggle("strategy", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Strategy Assist</small><strong>攻略支援・今日の獲得資材</strong></span>
          <em>{collapsedPanels.strategy ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content">
        <div className="section-head">
          <div>
            <p className="eyebrow">Strategy Assist</p>
            <h2>攻略支援</h2>
            <p>資材目的・生活時間から候補を出す簡易プランナー。ここから艦隊へ直接セットできる。</p>
          </div>
          <select value={guideMode} onChange={(event) => setGuideMode(event.target.value as GuideMode)}>
            {guideModes.map((mode) => <option key={mode}>{mode}</option>)}
          </select>
        </div>
        <p className="guide-description">{getGuideDescription(guideMode)}</p>
        <div className="guide-layout">
          <div className="guide-recommendations">
            {guideExpeditions.map((expedition) => {
              const rate = getResourceRate(expedition);
              return (
                <article className="guide-item" key={`guide-${guideMode}-${expedition.id}`}>
                  <div>
                    <strong>{expedition.id}: {expedition.name}</strong>
                    <small>{minutesToLabel(expedition.durationMinutes)} / {expedition.purposeTags.slice(0, 4).join("・")}</small>
                    <span>時給：{formatResources(rate)} / h</span>
                  </div>
                  <div className="guide-actions">
                    <button type="button" onClick={() => setSelectedDetailId(expedition.id)}>詳細</button>
                    <button type="button" onClick={() => setFleetExpedition(2, expedition.id)} disabled={isMonthlyDone(expedition.id)}>第2へ</button>
                    <button type="button" onClick={() => setFleetExpedition(3, expedition.id)} disabled={isMonthlyDone(expedition.id)}>第3へ</button>
                    <button type="button" onClick={() => setFleetExpedition(4, expedition.id)} disabled={isMonthlyDone(expedition.id)}>第4へ</button>
                  </div>
                </article>
              );
            })}
          </div>
          <aside className="daily-summary">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Today</p>
                <h3>今日の獲得資材</h3>
              </div>
              <button type="button" className="ghost small" onClick={clearHistory} disabled={history.length === 0}>履歴削除</button>
            </div>
            <div className="daily-total-grid">
              <div>燃料<strong>{todayTotal.fuel}</strong></div>
              <div>弾薬<strong>{todayTotal.ammo}</strong></div>
              <div>鋼材<strong>{todayTotal.steel}</strong></div>
              <div>ボーキ<strong>{todayTotal.bauxite}</strong></div>
            </div>
            <p className="helper-text">記録数：{todayHistory.length}件 / 大成功：{todayGreatCount}件。完了後カードの記録ボタンで集計される。</p>
            <div className="history-list compact-history">
              {todayHistory.length === 0 ? (
                <p className="empty-text">まだ今日の帰投記録はないよ。</p>
              ) : (
                todayHistory.slice(0, 5).map((item) => (
                  <p key={item.id}>
                    <span>{formatShortDateTime(item.completedAt)}</span>
                    第{item.fleetNo} {item.expeditionName} / {item.result === "great" ? "大成功" : "成功"} / {formatResources(item.rewards)}
                  </p>
                ))
              )}
            </div>
          </aside>
        </div>
        </div>
      </details>

      <section id="fleet-timer-section" className="fleet-grid">
        {fleets.map((fleet) => {
          const expedition = findExpedition(fleet.expeditionId);
          const running = fleet.endAt !== null && now < fleet.endAt;
          const completed = fleet.endAt !== null && now >= fleet.endAt;
          const remainingMs = fleet.endAt ? fleet.endAt - now : 0;
          const almostDone = running && remainingMs <= 5 * 60 * 1000;
          const remaining = fleet.endAt ? formatRemaining(remainingMs) : "--:--:--";
          const rate = getResourceRate(expedition);

          return (
            <article className={`fleet-card ${completed ? "completed" : almostDone ? "almost-done" : ""}`} key={fleet.fleetNo}>
              <div className="fleet-card-head">
                <div>
                  <p className="eyebrow">Fleet {fleet.fleetNo}</p>
                  <h2>第{fleet.fleetNo}艦隊</h2>
                </div>
                <span className={`status ${running ? "running" : completed ? "done" : "idle"}`}>
                  {running ? (almostDone ? "残り5分" : "遠征中") : completed ? "完了" : "待機"}
                </span>
              </div>

              <div className="label">
                <div className="field-head">
                  <span>遠征</span>
                  <button
                    type="button"
                    className={`favorite-toggle ${isPinned(fleet.expeditionId) ? "active" : ""}`}
                    onClick={() => togglePin(fleet.expeditionId)}
                  >
                    {isPinned(fleet.expeditionId) ? "★ お気に入り済み" : "☆ お気に入り追加"}
                  </button>
                </div>
                <select
                  value={fleet.expeditionId}
                  onChange={(event) => setFleetExpedition(fleet.fleetNo, event.target.value)}
                >
                  <optgroup label={`全遠征 ${totalExpeditionCount}件`}>
                    {expeditions.map((item) => {
                      const monthlyDone = isMonthlyDone(item.id);
                      return (
                        <option value={item.id} key={item.id} disabled={monthlyDone && item.id !== fleet.expeditionId}>
                          {isPinned(item.id) ? "★ " : ""}{monthlyDone ? "済 " : ""}{item.id}: {item.name}（{minutesToLabel(item.durationMinutes)}）
                        </option>
                      );
                    })}
                  </optgroup>
                </select>
                <p className="helper-text">全{totalExpeditionCount}件を収録。★はお気に入り、右上ボタンで追加・解除できる。</p>
                {pinnedExpeditions.length > 0 && (
                  <div className="fleet-pinned-shortcuts" aria-label="お気に入り遠征ショートカット">
                    {pinnedExpeditions.slice(0, 10).map((item) => (
                      <button
                        type="button"
                        key={`fleet-${fleet.fleetNo}-pin-${item.id}`}
                        className={`${fleet.expeditionId === item.id ? "active" : ""} ${isMonthlyDone(item.id) ? "done-disabled" : ""}`}
                        onClick={() => setFleetExpedition(fleet.fleetNo, item.id)}
                        disabled={isMonthlyDone(item.id) && item.id !== fleet.expeditionId}
                        title={isMonthlyDone(item.id) ? "今月実施済みのマンスリー遠征" : undefined}
                      >
                        ★ {isMonthlyDone(item.id) ? "済" : ""}{item.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="timer-box">
                <span>残り時間</span>
                <strong>{remaining}</strong>
              </div>

              <dl className="mini-info">
                <div>
                  <dt>終了予定</dt>
                  <dd>{formatDateTime(fleet.endAt)}</dd>
                </div>
                <div>
                  <dt>報酬</dt>
                  <dd>{formatResources(expedition.rewards)}</dd>
                </div>
                <div>
                  <dt>時給目安</dt>
                  <dd>{formatResources(rate)} / h</dd>
                </div>
              </dl>

              {completed && (
                <div className="next-actions">
                  <strong>次にやること</strong>
                  <ol>
                    {getNextActions(expedition).map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ol>
                  <div className="record-actions">
                    <button type="button" onClick={() => recordFleetResult(fleet, "success")} disabled={Boolean(fleet.recordedAt)}>
                      成功で記録
                    </button>
                    <button type="button" onClick={() => recordFleetResult(fleet, "great")} disabled={Boolean(fleet.recordedAt)}>
                      大成功で記録
                    </button>
                  </div>
                  {fleet.recordedAt && <p className="helper-text">今日の獲得資材に記録済み。</p>}
                </div>
              )}

              <div className="checkbox-row">
                <label>
                  <input
                    type="checkbox"
                    checked={fleet.discordNotify}
                    onChange={(event) => updateFleet(fleet.fleetNo, { discordNotify: event.target.checked })}
                  />
                  通知予約
                </label>
              </div>

              <div className="button-row">
                <button onClick={() => startFleet(fleet)}>開始</button>
                <button className="secondary" onClick={() => restartFleet(fleet)} disabled={!fleet.endAt}>
                  同じ遠征を再セット
                </button>
                <button className="ghost" onClick={() => clearFleet(fleet.fleetNo)}>
                  クリア
                </button>
              </div>

              <button className="detail-link" onClick={() => setSelectedDetailId(expedition.id)}>
                成功条件・大成功条件を見る
              </button>
            </article>
          );
        })}
      </section>

      <details
        className="detail-search-fold fold-card"
        open={!collapsedPanels.details}
        onToggle={(event) => handlePanelToggle("details", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Detail & Search</small><strong>遠征詳細・遠征一覧</strong></span>
          <em>{collapsedPanels.details ? "開く" : "閉じる"}</em>
        </summary>
        <section className="two-column fold-content">
        <article className="detail-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Expedition Detail</p>
              <h2>{selectedDetail.id}: {selectedDetail.name}</h2>
            </div>
            <div className="detail-actions">
              <span>{minutesToLabel(selectedDetail.durationMinutes)}</span>
              <button
                className={`pin-button ${isPinned(selectedDetail.id) ? "active" : ""}`}
                onClick={() => togglePin(selectedDetail.id)}
                title={isPinned(selectedDetail.id) ? "ピン留め解除" : "ピン留め"}
              >
                {isPinned(selectedDetail.id) ? "★" : "☆"}
              </button>
            </div>
          </div>

          <div className="resource-grid">
            <div>燃料<strong>{selectedDetail.rewards.fuel}</strong><small>{getResourceRate(selectedDetail).fuel}/h</small></div>
            <div>弾薬<strong>{selectedDetail.rewards.ammo}</strong><small>{getResourceRate(selectedDetail).ammo}/h</small></div>
            <div>鋼材<strong>{selectedDetail.rewards.steel}</strong><small>{getResourceRate(selectedDetail).steel}/h</small></div>
            <div>ボーキ<strong>{selectedDetail.rewards.bauxite}</strong><small>{getResourceRate(selectedDetail).bauxite}/h</small></div>
          </div>

          <div className="success-compare">
            <div>
              <span>通常成功</span>
              <strong>{formatResources(selectedDetail.rewards)}</strong>
            </div>
            <div>
              <span>大成功目安</span>
              <strong>{formatResources(selectedGreatRewards)}</strong>
              <small>資材1.5倍換算の目安</small>
            </div>
          </div>

          <dl className="detail-list">
            <div>
              <dt>海域</dt>
              <dd>{selectedDetail.area}</dd>
            </div>
            <div>
              <dt>成功条件</dt>
              <dd>
                旗艦：{selectedDetail.requirements.flagshipLevel}<br />
                隻数：{selectedDetail.requirements.ships}<br />
                編成：{selectedDetail.requirements.formation}<br />
                ステータス：{selectedDetail.requirements.stats}
              </dd>
            </div>
            <div>
              <dt>大成功条件</dt>
              <dd>{selectedDetail.greatSuccess.note}</dd>
            </div>
            <div>
              <dt>完了後メモ</dt>
              <dd>{getNextActions(selectedDetail).join(" / ")}</dd>
            </div>
            <div>
              <dt>アイテム</dt>
              <dd>{selectedDetail.itemReward}</dd>
            </div>
            <div>
              <dt>メモ</dt>
              <dd>{selectedDetail.memo}</dd>
            </div>
            <div>
              <dt>注意</dt>
              <dd>{selectedDetail.sourceNote}</dd>
            </div>
          </dl>
        </article>

        <aside className="list-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Search</p>
              <h2>遠征一覧 <small>全{totalExpeditionCount}件</small></h2>
            </div>
          </div>
          <section className="pinned-box">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Pinned</p>
                <h3>よく使う遠征</h3>
              </div>
              <small>{pinnedExpeditions.length}件</small>
            </div>
            {pinnedExpeditions.length === 0 ? (
              <p className="empty-text">☆ボタンでよく使う遠征をピン留めできるよ。</p>
            ) : (
              <div className="pinned-list pinned-list-editable">
                {pinnedExpeditions.map((expedition, index) => (
                  <div className={`pinned-edit-item ${selectedDetailId === expedition.id ? "selected" : ""}`} key={`quick-${expedition.id}`}>
                    <button
                      className="pinned-main"
                      type="button"
                      onClick={() => setSelectedDetailId(expedition.id)}
                    >
                      <span>{expedition.id}: {expedition.name}</span>
                      <small>{minutesToLabel(expedition.durationMinutes)} / {expedition.purposeTags.slice(0, 3).join("・")}</small>
                    </button>
                    <div className="pin-order-actions">
                      <button type="button" className="tiny" onClick={() => movePinned(expedition.id, -1)} disabled={index === 0}>↑</button>
                      <button type="button" className="tiny" onClick={() => movePinned(expedition.id, 1)} disabled={index === pinnedExpeditions.length - 1}>↓</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="search-row search-row-v04">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="遠征名・IDで検索"
            />
            <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option>すべて</option>
              <option>ピン留め</option>
              {expeditionTags.map((tag) => (
                <option key={tag}>{tag}</option>
              ))}
            </select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
              {sortModes.map((mode) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </div>
          <p className="result-count">表示中：{filteredExpeditions.length}件 / 全{totalExpeditionCount}件</p>
          <div className="expedition-list">
            {filteredExpeditions.map((expedition) => {
              const rate = getResourceRate(expedition);
              return (
                <div className={`expedition-item ${selectedDetailId === expedition.id ? "selected" : ""} ${isMonthlyDone(expedition.id) ? "monthly-done" : ""}`} key={expedition.id}>
                  <button className="expedition-main" onClick={() => setSelectedDetailId(expedition.id)}>
                    <span>{isMonthlyDone(expedition.id) ? "済 " : ""}{expedition.id}: {expedition.name}</span>
                    <small>{minutesToLabel(expedition.durationMinutes)} / {expedition.purposeTags.join("・")}</small>
                    <small>時給目安：{formatResources(rate)} / h</small>
                  </button>
                  <button
                    className={`pin-button ${isPinned(expedition.id) ? "active" : ""}`}
                    onClick={() => togglePin(expedition.id)}
                    title={isPinned(expedition.id) ? "ピン留め解除" : "ピン留め"}
                  >
                    {isPinned(expedition.id) ? "★" : "☆"}
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
        </section>
      </details>

      <details
        className="diagnostics-card fold-card"
        open={!collapsedPanels.diagnostics}
        onToggle={(event) => handlePanelToggle("diagnostics", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Notification History</small><strong>通知履歴・失敗診断</strong></span>
          <em>{collapsedPanels.diagnostics ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content diagnostics-content">
          <div className="section-head">
            <div>
              <p className="eyebrow">Diagnostics</p>
              <h2>通知履歴・失敗診断</h2>
              <p>Supabaseに保存された通知予約の状態を確認できるよ。通知が来ない時は、pending / sent / error / cancelled と診断メモを見る。</p>
            </div>
            <button type="button" className="secondary" onClick={refreshNotificationHistory} disabled={!authState.user || notificationHistoryBusy}>
              {notificationHistoryBusy ? "読込中..." : "履歴を更新"}
            </button>
          </div>
          <p className="helper-text">{notificationHistoryMessage || "遠征開始後に通知予約が作られると、ここに履歴が表示される。"}</p>
          <div className="notification-history-list">
            {notificationHistory.length === 0 ? (
              <p className="empty-text">通知履歴はまだないよ。</p>
            ) : (
              notificationHistory.map((row) => (
                <article className={`notification-history-item status-${row.status}`} key={row.id}>
                  <div className="notification-history-main">
                    <span className={`status ${row.status === "sent" ? "done" : row.status === "pending" ? "running" : row.status === "error" ? "error" : "idle"}`}>{row.status}</span>
                    <strong>第{row.fleet_no}艦隊 {row.expedition_name}</strong>
                    <small>終了予定：{row.end_at ? new Date(row.end_at).toLocaleString("ja-JP") : "未設定"}</small>
                    <small>送信日時：{row.sent_at ? new Date(row.sent_at).toLocaleString("ja-JP") : "未送信"}</small>
                  </div>
                  <div className="notification-diagnosis">
                    <b>診断</b>
                    <p>{diagnoseNotification(row)}</p>
                    {row.error_message ? <code>{row.error_message}</code> : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </details>

      <nav className="mobile-tabbar" aria-label="スマホ用ナビゲーション">
        <button type="button" className={mobileTab === "timers" ? "active" : ""} onClick={() => setMobileTab("timers")}>タイマー</button>
        <button type="button" className={mobileTab === "assist" ? "active" : ""} onClick={() => setMobileTab("assist")}>攻略</button>
        <button type="button" className={mobileTab === "search" ? "active" : ""} onClick={() => setMobileTab("search")}>一覧</button>
        <button type="button" className={mobileTab === "account" ? "active" : ""} onClick={() => setMobileTab("account")}>設定</button>
      </nav>

      <details
        className="log-card fold-card"
        open={!collapsedPanels.log}
        onToggle={(event) => handlePanelToggle("log", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Log</small><strong>ログ</strong></span>
          <em>{collapsedPanels.log ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content">
          {log.length === 0 ? <p>まだログはありません。</p> : log.map((item) => <p key={item}>{item}</p>)}
        </div>
      </details>
    </main>
  );
}

export default App;
