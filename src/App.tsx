import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { expeditionTags, expeditions } from "./data/expeditions";
import type { AppSettings, Expedition, FleetTimer, ResourceRewards } from "./types";
import { formatClock, formatDateTime, formatRemaining, minutesToLabel } from "./utils/time";
import { loadFromStorage, saveToStorage } from "./utils/storage";
import {
  requestPcNotificationPermission,
  sendDiscordNotification,
  sendPcNotification
} from "./utils/notify";

const FLEET_STORAGE_KEY = "kancolle-expedition-fleets-v1";
const SETTINGS_STORAGE_KEY = "kancolle-expedition-settings-v1";
const PINNED_STORAGE_KEY = "kancolle-expedition-pinned-v1";
const SORT_STORAGE_KEY = "kancolle-expedition-sort-v1";
const CUSTOM_PRESETS_STORAGE_KEY = "kancolle-expedition-custom-presets-v1";
const HISTORY_STORAGE_KEY = "kancolle-expedition-history-v1";
const COLLAPSE_STORAGE_KEY = "kancolle-expedition-collapse-v1";

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

type GuideMode =
  | "燃料"
  | "弾薬"
  | "鋼材"
  | "ボーキ"
  | "バケツ"
  | "寝る前"
  | "授業・バイト"
  | "短時間";

type CollapsibleKey = "pwa" | "notifications" | "presets" | "strategy" | "details" | "log";

type CollapseState = Record<CollapsibleKey, boolean>;

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
  pwa: false,
  notifications: true,
  presets: false,
  strategy: false,
  details: false,
  log: true
};

const backupStorageKeys = [
  FLEET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  PINNED_STORAGE_KEY,
  SORT_STORAGE_KEY,
  CUSTOM_PRESETS_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  COLLAPSE_STORAGE_KEY
] as const;

const initialFleets: FleetTimer[] = [2, 3, 4].map((fleetNo) => ({
  fleetNo: fleetNo as 2 | 3 | 4,
  expeditionId: expeditions[0]?.id ?? "",
  startAt: null,
  endAt: null,
  notifiedAt: null,
  recordedAt: null,
  pcNotify: true,
  discordNotify: false
}));

const initialSettings: AppSettings = {
  discordWebhookUrl: ""
};

const resourceKeyMap: Record<Exclude<GuideMode, "バケツ" | "寝る前" | "授業・バイト" | "短時間">, keyof ResourceRewards> = {
  燃料: "fuel",
  弾薬: "ammo",
  鋼材: "steel",
  ボーキ: "bauxite"
};

function getExpedition(expeditionId: string): Expedition {
  return expeditions.find((item) => item.id === expeditionId) ?? expeditions[0];
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
    (total, expeditionId) => addResources(total, getResourceRate(getExpedition(expeditionId))),
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

function getGuideDescription(mode: GuideMode): string {
  if (mode === "バケツ") return "高速修復材を狙える遠征を中心に表示。短時間周回にも向く。";
  if (mode === "寝る前") return "長めの遠征を優先。睡眠中や長時間放置で触りにくい時向け。";
  if (mode === "授業・バイト") return "2〜6時間程度の遠征を中心に表示。途中で触りにくい時向け。";
  if (mode === "短時間") return "1時間以内を中心に表示。こまめに触れる時の回転率重視。";
  return `${mode}の時給目安が高い遠征を優先表示。資材不足の時の候補探し向け。`;
}

function App() {
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
  const [history, setHistory] = useState<ExpeditionHistory[]>(() =>
    loadFromStorage(HISTORY_STORAGE_KEY, [])
  );
  const [selectedDetailId, setSelectedDetailId] = useState<string>(expeditions[0]?.id ?? "");
  const [tagFilter, setTagFilter] = useState<string>("すべて");
  const [keyword, setKeyword] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>(() => loadFromStorage(SORT_STORAGE_KEY, "ID順" as SortMode));
  const [guideMode, setGuideMode] = useState<GuideMode>("燃料");
  const [customPresetName, setCustomPresetName] = useState<string>("");
  const [customPresetDescription, setCustomPresetDescription] = useState<string>("");
  const [now, setNow] = useState<number>(Date.now());
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

  const allPresets = useMemo(() => [...defaultPresets, ...customPresets], [customPresets]);

  const pinnedExpeditions = useMemo(
    () => pinnedExpeditionIds.map(getExpedition).filter(Boolean),
    [pinnedExpeditionIds]
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

  const selectedDetail = getExpedition(selectedDetailId);
  const totalExpeditionCount = expeditions.length;
  const activeExpeditions = fleets.map((fleet) => getExpedition(fleet.expeditionId));
  const activeHourlyTotal = activeExpeditions.reduce<ResourceRewards>(
    (total, expedition) => addResources(total, getResourceRate(expedition)),
    { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  );
  const todayHistory = history.filter((item) => isSameDay(item.completedAt, now));
  const todayTotal = todayHistory.reduce<ResourceRewards>(
    (total, item) => addResources(total, item.rewards),
    { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  );
  const todayGreatCount = todayHistory.filter((item) => item.result === "great").length;
  const selectedGreatRewards = multiplyResources(selectedDetail.rewards, 1.5);

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
    saveToStorage(HISTORY_STORAGE_KEY, history);
  }, [history]);

  useEffect(() => {
    saveToStorage(COLLAPSE_STORAGE_KEY, collapsedPanels);
  }, [collapsedPanels]);

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
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const completedFleets = fleets.filter(
      (fleet) => fleet.endAt !== null && fleet.notifiedAt === null && now >= fleet.endAt
    );

    if (completedFleets.length === 0) return;

    completedFleets.forEach((fleet) => {
      const expedition = getExpedition(fleet.expeditionId);

      if (fleet.pcNotify) {
        sendPcNotification(fleet, expedition);
      }

      if (fleet.discordNotify) {
        sendDiscordNotification(settings.discordWebhookUrl, fleet, expedition)
          .then(() => addLog(`Discord通知: 第${fleet.fleetNo}艦隊 ${expedition.name}`))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : "Discord通知に失敗しました";
            addLog(message);
          });
      }
    });

    setFleets((current) =>
      current.map((fleet) => {
        if (fleet.endAt !== null && fleet.notifiedAt === null && now >= fleet.endAt) {
          return { ...fleet, notifiedAt: now };
        }
        return fleet;
      })
    );
  }, [now, fleets, settings.discordWebhookUrl]);

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
    const expedition = getExpedition(fleet.expeditionId);
    const startAt = Date.now();
    const endAt = startAt + expedition.durationMinutes * 60 * 1000;
    updateFleet(fleet.fleetNo, { startAt, endAt, notifiedAt: null, recordedAt: null });
    addLog(`開始: 第${fleet.fleetNo}艦隊 ${expedition.name}`);
  }

  function restartFleet(fleet: FleetTimer) {
    startFleet(fleet);
  }

  function clearFleet(fleetNo: FleetTimer["fleetNo"]) {
    updateFleet(fleetNo, { startAt: null, endAt: null, notifiedAt: null, recordedAt: null });
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

  function recordFleetResult(fleet: FleetTimer, result: HistoryResult) {
    if (fleet.recordedAt) return;
    const expedition = getExpedition(fleet.expeditionId);
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
    setCollapsedPanels({ pwa: false, notifications: false, presets: false, strategy: false, details: false, log: false });
  }

  function compactAssistPanels() {
    setCollapsedPanels({ pwa: false, notifications: true, presets: true, strategy: true, details: false, log: true });
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
      version: "1.1.0",
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

  async function testDiscord() {
    const dummyFleet: FleetTimer = {
      fleetNo: 2,
      expeditionId: expeditions[0].id,
      startAt: Date.now(),
      endAt: Date.now(),
      notifiedAt: null,
      recordedAt: null,
      pcNotify: false,
      discordNotify: true
    };

    try {
      await sendDiscordNotification(settings.discordWebhookUrl, dummyFleet, expeditions[0]);
      addLog("Discordテスト通知に成功");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discordテスト通知に失敗";
      addLog(message);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">KanColle Expedition Support v1.1</p>
          <h1>艦これ遠征サポート</h1>
          <p>
            遠征タイマー、終了予定時刻、PC通知、Discord通知、成功条件確認、攻略支援、帰投記録、PWA、Web公開対応、バックアップをまとめた手動操作前提ツール。
            現在の収録遠征は<strong>{totalExpeditionCount}件</strong>、お気に入りは<strong>{pinnedExpeditionIds.length}件</strong>。
          </p>
        </div>
        <div className="hero-clock">
          <span>現在時刻</span>
          <strong>{formatClock(now)}</strong>
        </div>
        <div className="hero-actions">
          <button type="button" className="secondary small" onClick={compactAssistPanels}>補助機能を折りたたむ</button>
          <button type="button" className="ghost small" onClick={openAllPanels}>すべて開く</button>
        </div>
      </header>

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
          <p className="helper-text">Web公開してURLから使う想定。Vercel / Cloudflare Pagesでは build: npm run build、output: dist。完全に閉じた後のスマホ通知は、現状はDiscord通知が一番安定。設定バックアップはお気に入り、プリセット、履歴、折りたたみ状態を保存する。</p>
        </div>
      </details>

      <details
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
            PC通知はブラウザの許可が必要。スマホ通知はDiscord Webhookを使うとDiscordアプリ経由で受け取れる。
          </p>
        </div>
        <div className="settings-grid">
          <button className="secondary" onClick={requestPcNotificationPermission}>
            PC通知を許可
          </button>
          <input
            value={settings.discordWebhookUrl}
            onChange={(event) =>
              setSettings((current) => ({ ...current, discordWebhookUrl: event.target.value }))
            }
            placeholder="Discord Webhook URL"
            type="password"
          />
          <button className="secondary" onClick={testDiscord} disabled={!settings.discordWebhookUrl.trim()}>
            Discordテスト
          </button>
        </div>
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
            const rates = getPresetRates(preset);
            const presetNames = [2, 3, 4]
              .map((fleetNo) => `${fleetNo}: ${getExpedition(preset.fleetExpeditionIds[fleetNo as 2 | 3 | 4]).name}`)
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
                    <button type="button" onClick={() => setFleetExpedition(2, expedition.id)}>第2へ</button>
                    <button type="button" onClick={() => setFleetExpedition(3, expedition.id)}>第3へ</button>
                    <button type="button" onClick={() => setFleetExpedition(4, expedition.id)}>第4へ</button>
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

      <section className="fleet-grid">
        {fleets.map((fleet) => {
          const expedition = getExpedition(fleet.expeditionId);
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
                    {expeditions.map((item) => (
                      <option value={item.id} key={item.id}>
                        {isPinned(item.id) ? "★ " : ""}{item.id}: {item.name}（{minutesToLabel(item.durationMinutes)}）
                      </option>
                    ))}
                  </optgroup>
                </select>
                <p className="helper-text">全{totalExpeditionCount}件を収録。★はお気に入り、右上ボタンで追加・解除できる。</p>
                {pinnedExpeditions.length > 0 && (
                  <div className="fleet-pinned-shortcuts" aria-label="お気に入り遠征ショートカット">
                    {pinnedExpeditions.slice(0, 10).map((item) => (
                      <button
                        type="button"
                        key={`fleet-${fleet.fleetNo}-pin-${item.id}`}
                        className={fleet.expeditionId === item.id ? "active" : ""}
                        onClick={() => setFleetExpedition(fleet.fleetNo, item.id)}
                      >
                        ★ {item.id}
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
                    checked={fleet.pcNotify}
                    onChange={(event) => updateFleet(fleet.fleetNo, { pcNotify: event.target.checked })}
                  />
                  PC通知
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={fleet.discordNotify}
                    onChange={(event) => updateFleet(fleet.fleetNo, { discordNotify: event.target.checked })}
                  />
                  Discord通知
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
                <div className={`expedition-item ${selectedDetailId === expedition.id ? "selected" : ""}`} key={expedition.id}>
                  <button className="expedition-main" onClick={() => setSelectedDetailId(expedition.id)}>
                    <span>{expedition.id}: {expedition.name}</span>
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
