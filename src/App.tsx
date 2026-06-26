import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { expeditions as fallbackExpeditions } from "./data/expeditions";
import type { AppSettings, Expedition, FleetTimer, ResourceRewards } from "./types";
import { formatClock, formatDateTime, formatRemaining, minutesToLabel } from "./utils/time";
import { loadFromStorage, saveToStorage } from "./utils/storage";
import {
  buildRewardSummary,
  cancelCloudNotification,
  clearActiveTimer,
  getCurrentAuthState,
  isSupabaseConfigured,
  loadActiveTimers,
  loadCloudSnapshot,
  loadNotificationHistory,
  saveActiveTimer,
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
const SETUP_GUIDE_DISMISSED_STORAGE_KEY = "kancolle-expedition-setup-guide-dismissed-v1";
const REWARD_MODIFIER_STORAGE_KEY = "kancolle-expedition-reward-modifier-v1";
const THEME_STORAGE_KEY = "kancolle-expedition-theme-v1";
const RESOURCE_STOCK_STORAGE_KEY = "kancolle-expedition-resource-stock-v1";
const RESOURCE_TARGET_STORAGE_KEY = "kancolle-expedition-resource-target-v1";
const HISTORY_CLEARED_AT_STORAGE_KEY = "kancolle-expedition-history-cleared-at-v1";
const RESOURCE_STOCK_CLEARED_AT_STORAGE_KEY = "kancolle-expedition-resource-stock-cleared-at-v1";

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

type LandingCraftTypeId =
  | "daihatsu"
  | "toku-daihatsu"
  | "armed-daihatsu"
  | "type89"
  | "soukoutei"
  | "panzer2"
  | "toku-honi"
  | "ka-mi"
  | "ka-tsu"
  | "ka-tsu-kai"
  | "toku-11th"
  | "m4a1-dd"
  | "toku-panzer3"
  | "toku-chiha"
  | "toku-chiha-kai";

type LandingCraftSlot = {
  id: string;
  type: LandingCraftTypeId;
  stars: number;
};

type LandingCraftDefinition = {
  id: LandingCraftTypeId;
  label: string;
  shortLabel: string;
  dlcMod: number;
  isPlainDaihatsu?: boolean;
  isTokuDaihatsu?: boolean;
};

type FleetRewardModifier = {
  /** v3.2互換：古い保存データの移行用。 */
  daihatsuCount?: number;
  kinuKaiNiBonus: boolean;
  landingCrafts?: LandingCraftSlot[];
};

type RewardBonusBreakdown = {
  craftCount: number;
  plainDaihatsuCount: number;
  tokuDaihatsuCount: number;
  cappedDlcBonus: number;
  avgStar: number;
  improvedDlcBonus: number;
  tokuBonus: number;
  totalBonus: number;
};

type RewardModifierSettings = {
  greatSuccessDefault: boolean;
  /** v3.2互換：既定値。古い保存データの移行・詳細画面の暫定計算に使う。 */
  daihatsuCount: number;
  kinuKaiNiBonus: boolean;
  landingCrafts?: LandingCraftSlot[];
  /** 第2〜第4艦隊ごとの大発系装備・鬼怒補正。 */
  perFleet?: Partial<Record<FleetTimer["fleetNo"], FleetRewardModifier>>;
};

type ManualTimerInputs = Record<FleetTimer["fleetNo"], string>;

type DailyResourcePoint = {
  key: string;
  label: string;
  resources: ResourceRewards;
  count: number;
};

type DailyChartMode = "合計" | "燃料" | "弾薬" | "鋼材" | "ボーキ";
type StockChartRange = "1日" | "1週間" | "1か月" | "全期間";
type ResourceStockInputs = Record<keyof ResourceRewards, string>;
type ResourceStockSnapshot = {
  id: string;
  recordedAt: number;
  resources: ResourceRewards;
};

type ResourceTargetInputs = ResourceStockInputs;

type GuideMode =
  | "燃料"
  | "弾薬"
  | "鋼材"
  | "ボーキ"
  | "バケツ"
  | "寝る前"
  | "授業・バイト"
  | "短時間";

type CollapsibleKey = "account" | "pwa" | "notifications" | "rewards" | "presets" | "monthly" | "strategy" | "details" | "diagnostics" | "log";

type CollapseState = Record<CollapsibleKey, boolean>;

type MobileTab = "timers" | "assist" | "search" | "records" | "account";
type ThemeMode = "dark" | "light";

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
  rewards: false,
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
  COLLAPSE_STORAGE_KEY,
  SETUP_TEST_STORAGE_KEY,
  SETUP_GUIDE_DISMISSED_STORAGE_KEY,
  REWARD_MODIFIER_STORAGE_KEY,
  THEME_STORAGE_KEY,
  RESOURCE_STOCK_STORAGE_KEY,
  RESOURCE_TARGET_STORAGE_KEY,
  HISTORY_CLEARED_AT_STORAGE_KEY,
  RESOURCE_STOCK_CLEARED_AT_STORAGE_KEY
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

const initialRewardModifierSettings: RewardModifierSettings = {
  greatSuccessDefault: true,
  daihatsuCount: 0,
  kinuKaiNiBonus: false,
  landingCrafts: [],
  perFleet: {
    2: { daihatsuCount: 0, kinuKaiNiBonus: false, landingCrafts: [] },
    3: { daihatsuCount: 0, kinuKaiNiBonus: false, landingCrafts: [] },
    4: { daihatsuCount: 0, kinuKaiNiBonus: false, landingCrafts: [] }
  }
};

const resourceKeyMap: Record<Exclude<GuideMode, "バケツ" | "寝る前" | "授業・バイト" | "短時間">, keyof ResourceRewards> = {
  燃料: "fuel",
  弾薬: "ammo",
  鋼材: "steel",
  ボーキ: "bauxite"
};

const dailyChartModes: DailyChartMode[] = ["合計", "燃料", "弾薬", "鋼材", "ボーキ"];
const stockChartRanges: StockChartRange[] = ["1日", "1週間", "1か月", "全期間"];
const stockYAxisTickCount = 4;

const dailyChartResourceKeyMap: Record<Exclude<DailyChartMode, "合計">, keyof ResourceRewards> = {
  燃料: "fuel",
  弾薬: "ammo",
  鋼材: "steel",
  ボーキ: "bauxite"
};

const resourceShortLabels: Record<keyof ResourceRewards, string> = {
  fuel: "燃",
  ammo: "弾",
  steel: "鋼",
  bauxite: "ボ"
};

const resourceFullLabels: Record<keyof ResourceRewards, string> = {
  fuel: "燃料",
  ammo: "弾薬",
  steel: "鋼材",
  bauxite: "ボーキ"
};

const resourceKeys = ["fuel", "ammo", "steel", "bauxite"] as const;
/** ゲーム画面と同じ並び：燃料 / 鋼材、弾薬 / ボーキ。 */
const resourceGameGridKeys = ["fuel", "steel", "ammo", "bauxite"] as const;

const MAX_LANDING_CRAFT_SLOTS = 8;

const landingCraftDefinitions: LandingCraftDefinition[] = [
  { id: "daihatsu", label: "大発動艇", shortLabel: "大発", dlcMod: 0.05, isPlainDaihatsu: true },
  { id: "toku-daihatsu", label: "特大発動艇", shortLabel: "特大発", dlcMod: 0.05, isTokuDaihatsu: true },
  { id: "ka-tsu-kai", label: "特四式内火艇改", shortLabel: "特四改", dlcMod: 0.04 },
  { id: "ka-tsu", label: "特四式内火艇", shortLabel: "特四", dlcMod: 0.04 },
  { id: "armed-daihatsu", label: "武装大発", shortLabel: "武装大発", dlcMod: 0.03 },
  { id: "type89", label: "大発動艇(八九式中戦車＆陸戦隊)", shortLabel: "陸戦隊", dlcMod: 0.02 },
  { id: "soukoutei", label: "装甲艇(AB艇)", shortLabel: "AB艇", dlcMod: 0.02 },
  { id: "panzer2", label: "大発動艇(II号戦車/北アフリカ仕様)", shortLabel: "II号戦車", dlcMod: 0.02 },
  { id: "toku-honi", label: "特大発動艇＋一式砲戦車", shortLabel: "一式砲戦車", dlcMod: 0.02 },
  { id: "ka-mi", label: "特二式内火艇", shortLabel: "内火艇", dlcMod: 0.01 },
  { id: "toku-11th", label: "特大発動艇＋戦車第11連隊", shortLabel: "11連隊", dlcMod: 0 },
  { id: "m4a1-dd", label: "M4A1 DD", shortLabel: "M4A1", dlcMod: 0 },
  { id: "toku-panzer3", label: "特大発動艇＋III号戦車(北アフリカ仕様)", shortLabel: "III号北ア", dlcMod: 0 },
  { id: "toku-chiha", label: "特大発動艇＋チハ", shortLabel: "チハ", dlcMod: 0 },
  { id: "toku-chiha-kai", label: "特大発動艇＋チハ改", shortLabel: "チハ改", dlcMod: 0 }
];

const landingCraftDefinitionMap = Object.fromEntries(
  landingCraftDefinitions.map((definition) => [definition.id, definition])
) as Record<LandingCraftTypeId, LandingCraftDefinition>;

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

function getDailyChartValue(resources: ResourceRewards, mode: DailyChartMode): number {
  if (mode === "合計") return getTotalResources(resources);
  return resources[dailyChartResourceKeyMap[mode]];
}

function getDailyChartModeUnit(mode: DailyChartMode): string {
  return mode === "合計" ? "合計" : `${mode}`;
}

function getInitialResourceStockInputs(): ResourceStockInputs {
  return { fuel: "", ammo: "", steel: "", bauxite: "" };
}

function resourceStockSnapshotToInputs(snapshot?: ResourceStockSnapshot | null): ResourceStockInputs {
  if (!snapshot) return getInitialResourceStockInputs();
  return {
    fuel: String(snapshot.resources.fuel),
    ammo: String(snapshot.resources.ammo),
    steel: String(snapshot.resources.steel),
    bauxite: String(snapshot.resources.bauxite)
  };
}

function parseResourceStockInput(value: string): number {
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return clampNumber(Math.floor(parsed), 0, 999999);
}

function getResourceStockValue(resources: ResourceRewards, mode: DailyChartMode): number {
  return getDailyChartValue(resources, mode);
}

function getStockRangeStart(range: StockChartRange, base = Date.now()): number {
  if (range === "全期間") return 0;
  const date = new Date(base);
  if (range === "1日") date.setHours(date.getHours() - 24);
  if (range === "1週間") date.setDate(date.getDate() - 7);
  if (range === "1か月") date.setMonth(date.getMonth() - 1);
  return date.getTime();
}

function formatStockSnapshotLabel(timestamp: number, range: StockChartRange): string {
  const date = new Date(timestamp);
  if (range === "1日") {
    return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function formatStockAxisDate(timestamp: number, range: StockChartRange): string {
  const date = new Date(timestamp);
  if (range === "1日") return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (range === "全期間") return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
}

function formatAxisNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) return `${Math.round(value / 1000).toLocaleString("ja-JP")}k`;
  return value.toLocaleString("ja-JP");
}

function getDaysBetween(start: number, end: number): number {
  return Math.max(1 / 24, (end - start) / (24 * 60 * 60 * 1000));
}

function getResourceTargetInputDefaults(): ResourceTargetInputs {
  return { fuel: "300000", ammo: "300000", steel: "300000", bauxite: "300000" };
}

function subtractResources(a: ResourceRewards, b: ResourceRewards): ResourceRewards {
  return {
    fuel: a.fuel - b.fuel,
    ammo: a.ammo - b.ammo,
    steel: a.steel - b.steel,
    bauxite: a.bauxite - b.bauxite
  };
}

function formatSignedNumber(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("ja-JP")}`;
}

function formatSignedResources(resources: ResourceRewards): string {
  return `燃${formatSignedNumber(resources.fuel)} / 弾${formatSignedNumber(resources.ammo)} / 鋼${formatSignedNumber(resources.steel)} / ボ${formatSignedNumber(resources.bauxite)}`;
}

function formatResourceBreakdown(resources: ResourceRewards): string {
  return (["fuel", "ammo", "steel", "bauxite"] as (keyof ResourceRewards)[])
    .map((key) => `${resourceShortLabels[key]}${resources[key]}`)
    .join(" / ");
}

function multiplyResources(resources: ResourceRewards, multiplier: number): ResourceRewards {
  return {
    fuel: Math.floor(resources.fuel * multiplier),
    ammo: Math.floor(resources.ammo * multiplier),
    steel: Math.floor(resources.steel * multiplier),
    bauxite: Math.floor(resources.bauxite * multiplier)
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getLandingCraftDefinition(type: LandingCraftTypeId): LandingCraftDefinition {
  return landingCraftDefinitionMap[type] ?? landingCraftDefinitionMap.daihatsu;
}

function createLandingCraftSlot(type: LandingCraftTypeId = "daihatsu", stars = 0): LandingCraftSlot {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    stars: clampNumber(Math.round(stars), 0, 10)
  };
}

function migrateLegacyDaihatsuSlots(count = 0): LandingCraftSlot[] {
  return Array.from({ length: clampNumber(Math.round(count), 0, MAX_LANDING_CRAFT_SLOTS) }, () =>
    createLandingCraftSlot("daihatsu", 0)
  );
}

function normalizeLandingCraftSlots(slots?: LandingCraftSlot[], legacyDaihatsuCount = 0): LandingCraftSlot[] {
  const source = slots && slots.length > 0 ? slots : migrateLegacyDaihatsuSlots(legacyDaihatsuCount);
  return source
    .slice(0, MAX_LANDING_CRAFT_SLOTS)
    .map((slot, index) => {
      const type = landingCraftDefinitionMap[slot.type] ? slot.type : "daihatsu";
      return {
        id: slot.id || `${type}-${index}`,
        type,
        stars: clampNumber(Math.round(Number(slot.stars) || 0), 0, 10)
      };
    });
}

function getFleetRewardModifier(settings: RewardModifierSettings, fleetNo?: FleetTimer["fleetNo"]): FleetRewardModifier {
  const fleetSetting = fleetNo ? settings.perFleet?.[fleetNo] : undefined;
  const legacyDaihatsuCount = fleetSetting?.daihatsuCount ?? settings.daihatsuCount ?? 0;
  const landingCrafts = normalizeLandingCraftSlots(fleetSetting?.landingCrafts ?? settings.landingCrafts, legacyDaihatsuCount);
  return {
    daihatsuCount: landingCrafts.length,
    kinuKaiNiBonus: Boolean(fleetSetting?.kinuKaiNiBonus ?? settings.kinuKaiNiBonus),
    landingCrafts
  };
}

function getTokuDaihatsuExtraBonus(tokuDaihatsuCount: number, plainDaihatsuCount: number): number {
  const toku = clampNumber(Math.floor(tokuDaihatsuCount), 0, MAX_LANDING_CRAFT_SLOTS);
  const plain = clampNumber(Math.floor(plainDaihatsuCount), 0, 4);
  if (toku <= 0) return 0;
  if (toku === 1) return 0.02;
  if (toku === 2) return 0.04;
  if (toku === 3) return [0.05, 0.052, 0.054, 0.054, 0.054][plain];
  return [0.054, 0.056, 0.058, 0.059, 0.06][plain];
}

function getRewardBonusBreakdown(settings: RewardModifierSettings, fleetNo?: FleetTimer["fleetNo"]): RewardBonusBreakdown {
  const modifier = getFleetRewardModifier(settings, fleetNo);
  const landingCrafts = modifier.landingCrafts ?? [];
  const craftBonuses = landingCrafts.map((slot) => ({ slot, definition: getLandingCraftDefinition(slot.type) }));
  const dlcBonusRaw =
    craftBonuses.reduce((total, item) => total + item.definition.dlcMod, 0) +
    (modifier.kinuKaiNiBonus ? 0.05 : 0);
  const cappedDlcBonus = Math.min(0.2, dlcBonusRaw);
  const improvedCrafts = craftBonuses.filter((item) => item.definition.dlcMod > 0);
  const avgStar = improvedCrafts.length > 0
    ? improvedCrafts.reduce((total, item) => total + item.slot.stars, 0) / improvedCrafts.length
    : 0;
  const improvedDlcBonus = cappedDlcBonus * (1 + avgStar / 100);
  const tokuDaihatsuCount = craftBonuses.filter((item) => item.definition.isTokuDaihatsu).length;
  const plainDaihatsuCount = craftBonuses.filter((item) => item.definition.isPlainDaihatsu).length;
  const tokuBonus = getTokuDaihatsuExtraBonus(tokuDaihatsuCount, plainDaihatsuCount);

  return {
    craftCount: landingCrafts.length,
    plainDaihatsuCount,
    tokuDaihatsuCount,
    cappedDlcBonus,
    avgStar,
    improvedDlcBonus,
    tokuBonus,
    totalBonus: improvedDlcBonus + tokuBonus
  };
}

function getDaihatsuBonusRate(settings: RewardModifierSettings, fleetNo?: FleetTimer["fleetNo"]): number {
  return getRewardBonusBreakdown(settings, fleetNo).totalBonus;
}

function calculateAdjustedResourceValue(baseValue: number, greatMultiplier: number, breakdown: RewardBonusBreakdown): number {
  if (baseValue <= 0) return 0;
  const landingCraftPart = Math.floor(baseValue * greatMultiplier * (1 + breakdown.improvedDlcBonus));
  const tokuPart = Math.floor(baseValue * greatMultiplier * breakdown.tokuBonus);
  return landingCraftPart + tokuPart;
}

function calculateAdjustedRewards(
  expedition: Expedition,
  settings: RewardModifierSettings,
  forceGreatSuccess?: boolean,
  fleetNo?: FleetTimer["fleetNo"]
): ResourceRewards {
  const greatSuccess = forceGreatSuccess ?? settings.greatSuccessDefault;
  const greatMultiplier = greatSuccess ? 1.5 : 1;
  const breakdown = getRewardBonusBreakdown(settings, fleetNo);
  return {
    fuel: calculateAdjustedResourceValue(expedition.rewards.fuel, greatMultiplier, breakdown),
    ammo: calculateAdjustedResourceValue(expedition.rewards.ammo, greatMultiplier, breakdown),
    steel: calculateAdjustedResourceValue(expedition.rewards.steel, greatMultiplier, breakdown),
    bauxite: calculateAdjustedResourceValue(expedition.rewards.bauxite, greatMultiplier, breakdown)
  };
}

function getAdjustedResourceRate(expedition: Expedition, settings: RewardModifierSettings, fleetNo?: FleetTimer["fleetNo"]): ResourceRewards {
  const adjusted = calculateAdjustedRewards(expedition, settings, undefined, fleetNo);
  const hourFactor = 60 / expedition.durationMinutes;
  return {
    fuel: Math.round(adjusted.fuel * hourFactor),
    ammo: Math.round(adjusted.ammo * hourFactor),
    steel: Math.round(adjusted.steel * hourFactor),
    bauxite: Math.round(adjusted.bauxite * hourFactor)
  };
}

function formatBonusPercent(rate: number): string {
  const value = rate * 100;
  return Number.isInteger(value) ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
}

function getRewardModifierLabel(settings: RewardModifierSettings, fleetNo?: FleetTimer["fleetNo"]): string {
  const breakdown = getRewardBonusBreakdown(settings, fleetNo);
  const fleetLabel = fleetNo ? `第${fleetNo}艦隊` : "既定";
  return `${fleetLabel}: ${settings.greatSuccessDefault ? "大成功" : "通常成功"} / 大発系+${formatBonusPercent(breakdown.totalBonus)}`;
}

function getLandingCraftSummary(settings: RewardModifierSettings, fleetNo?: FleetTimer["fleetNo"]): string {
  const modifier = getFleetRewardModifier(settings, fleetNo);
  const breakdown = getRewardBonusBreakdown(settings, fleetNo);
  const craftNames = (modifier.landingCrafts ?? [])
    .slice(0, 3)
    .map((slot) => `${getLandingCraftDefinition(slot.type).shortLabel}★${slot.stars}`)
    .join(" / ");
  const more = (modifier.landingCrafts?.length ?? 0) > 3 ? ` ほか${(modifier.landingCrafts?.length ?? 0) - 3}` : "";
  const craftLabel = craftNames ? `${craftNames}${more}` : "大発系なし";
  return `${craftLabel}｜基礎${formatBonusPercent(breakdown.cappedDlcBonus)}・改修平均★${breakdown.avgStar.toFixed(1)}・特大発${formatBonusPercent(breakdown.tokuBonus)}`;
}

function getCombinedFleetRate(
  fleetExpeditionIds: Record<FleetTimer["fleetNo"], string>,
  settings: RewardModifierSettings,
  findExpedition: (expeditionId: string) => Expedition
): ResourceRewards {
  return ([2, 3, 4] as FleetTimer["fleetNo"][]).reduce<ResourceRewards>(
    (total, fleetNo) => addResources(total, getAdjustedResourceRate(findExpedition(fleetExpeditionIds[fleetNo]), settings, fleetNo)),
    { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  );
}

function getResourceMax(resources: ResourceRewards): number {
  return Math.max(resources.fuel, resources.ammo, resources.steel, resources.bauxite, 1);
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


type FormationPattern = {
  label: string;
  requirement: string;
  example: string;
  note?: string;
};

const COMPOSITION_NAME_MAP: Array<[RegExp, string]> = [
  [/護衛空母/g, "護衛空母"],
  [/軽空母/g, "軽空母"],
  [/軽巡洋艦/g, "軽巡洋艦"],
  [/軽巡/g, "軽巡洋艦"],
  [/練巡/g, "練習巡洋艦"],
  [/駆逐艦/g, "駆逐艦"],
  [/駆逐/g, "駆逐艦"],
  [/海防艦/g, "海防艦"],
  [/海防/g, "海防艦"],
  [/正規空母/g, "正規空母"],
  [/装甲空母/g, "装甲空母"],
  [/空母系/g, "空母系"],
  [/航空戦艦/g, "航空戦艦"],
  [/戦艦/g, "戦艦"],
  [/重巡/g, "重巡洋艦"],
  [/水母/g, "水上機母艦"],
  [/潜水母艦/g, "潜水母艦"],
  [/潜水空母/g, "潜水空母"],
  [/潜水艦/g, "潜水艦"],
  [/自由枠/g, "自由枠"],
  [/自由/g, "自由枠"]
];

function normalizeCompositionText(value: string): string {
  let text = value
    .replace(/\s+/g, "")
    .replace(/旗艦([0-9]+)/g, "(旗艦)×$1")
    .replace(/([\u4e00-\u9fffA-Za-z/・]+)([0-9]+)/g, "$1×$2")
    .replace(/\+/g, "＋")
    .replace(/\//g, "または")
    .replace(/or/g, "または")
    .replace(/駆逐艦または海防艦/g, "駆逐艦または海防艦")
    .replace(/駆逐または海防/g, "駆逐艦または海防艦");

  for (const [pattern, replacement] of COMPOSITION_NAME_MAP) {
    text = text.replace(pattern, replacement);
  }

  return text
    .replace(/＋/g, " / ")
    .replace(/または/g, " または ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildCompositionExample(value: string): string {
  let text = value
    .replace(/\s+/g, "")
    .replace(/護衛空母\/軽巡/g, "護衛空母")
    .replace(/練巡\/軽巡/g, "軽巡")
    .replace(/練巡\/護衛空母/g, "練巡")
    .replace(/駆逐\/海防/g, "駆逐")
    .replace(/空母系\/水母/g, "軽空母")
    .replace(/潜水艦\/潜水空母/g, "潜水艦")
    .replace(/潜水艦\/潜水空母/g, "潜水艦")
    .replace(/潜水艦\/潜水空母/g, "潜水艦")
    .replace(/潜水空母/g, "潜水艦")
    .replace(/\//g, "")
    .replace(/旗艦/g, "")
    .replace(/。.*$/, "")
    .replace(/、.*$/, "")
    .replace(/または.*$/, "");

  text = normalizeCompositionText(text)
    .replace(/\(旗艦\)/g, "")
    .replace(/ または .+?(?=×|\/|$)/g, "")
    .replace(/空母系×/g, "軽空母×")
    .replace(/自由枠×/g, "自由枠×");

  return text ? `${text} の例` : "この条件を満たす最小編成を使用";
}

function getFormationPatterns(expedition: Expedition): FormationPattern[] {
  if (expedition.id === "43") {
    return [
      {
        label: "パターン1：護衛空母ルート",
        requirement: "護衛空母(旗艦)×1 / 駆逐艦×2 または 海防艦×2 / 自由枠×3",
        example: "護衛空母×1＋駆逐艦×2＋重巡洋艦×1＋軽巡洋艦×1＋駆逐艦×1",
        note: "駆逐艦1＋海防艦1の混在は不可。護衛空母が旗艦。自由枠で火力・対空・対潜・索敵を調整。"
      },
      {
        label: "パターン2：軽空母ルート",
        requirement: "軽空母(旗艦)×1 / 軽巡洋艦×1 / 駆逐艦×4",
        example: "軽空母×1＋軽巡洋艦×1＋駆逐艦×4",
        note: "軽空母が旗艦。自由枠がないため、要求ステータスを満たせる艦・装備で調整。"
      }
    ];
  }

  const rawParts = expedition.requirements.formation
    .split(/、または|または|。例：|。/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !item.includes("旗艦固定") && !item.includes("実際の支援威力"));

  const parts = rawParts.length > 0 ? rawParts : [expedition.requirements.formation];
  return parts.slice(0, 8).map((part, index) => ({
    label: parts.length > 1 ? `パターン${index + 1}` : "編成条件",
    requirement: normalizeCompositionText(part),
    example: buildCompositionExample(part),
    note: expedition.requirements.formation.includes("旗艦固定") || part.includes("旗艦") ? "指定艦が旗艦。" : undefined
  }));
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

function getDayKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDayLabel(dayKey: string): string {
  const [, month, day] = dayKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function getRecentDayKeys(days = 7, base = Date.now()): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(base);
    date.setDate(date.getDate() - (days - 1 - index));
    return getDayKey(date.getTime());
  });
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

function buildDiscordContent(fleet: FleetTimer, expedition: Expedition, endAt: number, rewardSummary?: string): string {
  return [
    `⏰ **第${fleet.fleetNo}艦隊 遠征完了**`,
    `遠征：${expedition.name}`,
    `終了予定：${formatDateTime(endAt)}`,
    `報酬目安：${rewardSummary ?? buildRewardSummary(expedition.rewards)}`,
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
  const [rewardSettings, setRewardSettings] = useState<RewardModifierSettings>(() => {
    const loaded = loadFromStorage(REWARD_MODIFIER_STORAGE_KEY, initialRewardModifierSettings);
    return {
      ...initialRewardModifierSettings,
      ...loaded,
      perFleet: {
        ...initialRewardModifierSettings.perFleet,
        ...(loaded.perFleet ?? {})
      }
    };
  });
  const [manualTimerInputs, setManualTimerInputs] = useState<ManualTimerInputs>({ 2: "", 3: "", 4: "" });
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
  const [setupGuideDismissed, setSetupGuideDismissed] = useState<boolean>(() =>
    loadFromStorage(SETUP_GUIDE_DISMISSED_STORAGE_KEY, false)
  );
  const [history, setHistory] = useState<ExpeditionHistory[]>(() =>
    loadFromStorage(HISTORY_STORAGE_KEY, [])
  );
  const [selectedDetailId, setSelectedDetailId] = useState<string>(fallbackExpeditions[0]?.id ?? "");
  const [tagFilter, setTagFilter] = useState<string>("すべて");
  const [keyword, setKeyword] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>(() => loadFromStorage(SORT_STORAGE_KEY, "ID順" as SortMode));
  const [guideMode, setGuideMode] = useState<GuideMode>("燃料");
  const [dailyChartMode, setDailyChartMode] = useState<DailyChartMode>("合計");
  const [selectedDailyKey, setSelectedDailyKey] = useState<string>(() => getDayKey());
  const [stockChartMode, setStockChartMode] = useState<DailyChartMode>("合計");
  const [stockChartRange, setStockChartRange] = useState<StockChartRange>("1週間");
  const [resourceStockSnapshots, setResourceStockSnapshots] = useState<ResourceStockSnapshot[]>(() =>
    loadFromStorage(RESOURCE_STOCK_STORAGE_KEY, [])
  );
  const [resourceStockInputs, setResourceStockInputs] = useState<ResourceStockInputs>(() => {
    const snapshots = loadFromStorage<ResourceStockSnapshot[]>(RESOURCE_STOCK_STORAGE_KEY, []);
    return resourceStockSnapshotToInputs([...snapshots].sort((a, b) => b.recordedAt - a.recordedAt)[0]);
  });
  const [selectedStockSnapshotId, setSelectedStockSnapshotId] = useState<string | null>(null);
  const [resourceTargetInputs, setResourceTargetInputs] = useState<ResourceTargetInputs>(() => ({
    ...getResourceTargetInputDefaults(),
    ...loadFromStorage<ResourceTargetInputs>(RESOURCE_TARGET_STORAGE_KEY, getResourceTargetInputDefaults())
  }));
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadFromStorage(THEME_STORAGE_KEY, "dark" as ThemeMode));
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
  const cloudRefreshTimerRef = useRef<number | null>(null);
  const skipNextAutoSaveRef = useRef<boolean>(false);
  const latestCloudSavedAtRef = useRef<number>(0);
  const historyClearedAtRef = useRef<number>(loadFromStorage<number>(HISTORY_CLEARED_AT_STORAGE_KEY, 0));
  const resourceStockClearedAtRef = useRef<number>(loadFromStorage<number>(RESOURCE_STOCK_CLEARED_AT_STORAGE_KEY, 0));

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
    return getCombinedFleetRate(preset.fleetExpeditionIds, rewardSettings, findExpedition);
  }

  function updateFleetRewardModifier(fleetNo: FleetTimer["fleetNo"], patch: Partial<FleetRewardModifier>) {
    setRewardSettings((current) => {
      const previous = getFleetRewardModifier(current, fleetNo);
      return {
        ...current,
        perFleet: {
          ...(current.perFleet ?? {}),
          [fleetNo]: { ...previous, ...patch }
        }
      };
    });
  }

  function updateDefaultLandingCraft(index: number, patch: Partial<LandingCraftSlot>) {
    setRewardSettings((current) => {
      const slots = normalizeLandingCraftSlots(current.landingCrafts, current.daihatsuCount);
      const nextSlots = slots.map((slot, slotIndex) =>
        slotIndex === index
          ? {
              ...slot,
              ...patch,
              stars: patch.stars !== undefined ? clampNumber(Math.round(Number(patch.stars)), 0, 10) : slot.stars
            }
          : slot
      );
      return { ...current, daihatsuCount: nextSlots.length, landingCrafts: nextSlots };
    });
  }

  function addDefaultLandingCraft() {
    setRewardSettings((current) => {
      const slots = normalizeLandingCraftSlots(current.landingCrafts, current.daihatsuCount);
      if (slots.length >= MAX_LANDING_CRAFT_SLOTS) return current;
      const nextSlots = [...slots, createLandingCraftSlot("daihatsu", 0)];
      return { ...current, daihatsuCount: nextSlots.length, landingCrafts: nextSlots };
    });
  }

  function removeDefaultLandingCraft(index: number) {
    setRewardSettings((current) => {
      const nextSlots = normalizeLandingCraftSlots(current.landingCrafts, current.daihatsuCount).filter((_, slotIndex) => slotIndex !== index);
      return { ...current, daihatsuCount: nextSlots.length, landingCrafts: nextSlots };
    });
  }

  function updateFleetLandingCraft(fleetNo: FleetTimer["fleetNo"], index: number, patch: Partial<LandingCraftSlot>) {
    setRewardSettings((current) => {
      const previous = getFleetRewardModifier(current, fleetNo);
      const slots = normalizeLandingCraftSlots(previous.landingCrafts, previous.daihatsuCount ?? 0);
      const nextSlots = slots.map((slot, slotIndex) =>
        slotIndex === index
          ? {
              ...slot,
              ...patch,
              stars: patch.stars !== undefined ? clampNumber(Math.round(Number(patch.stars)), 0, 10) : slot.stars
            }
          : slot
      );
      return {
        ...current,
        perFleet: {
          ...(current.perFleet ?? {}),
          [fleetNo]: { ...previous, daihatsuCount: nextSlots.length, landingCrafts: nextSlots }
        }
      };
    });
  }

  function addFleetLandingCraft(fleetNo: FleetTimer["fleetNo"]) {
    setRewardSettings((current) => {
      const previous = getFleetRewardModifier(current, fleetNo);
      const slots = normalizeLandingCraftSlots(previous.landingCrafts, previous.daihatsuCount ?? 0);
      if (slots.length >= MAX_LANDING_CRAFT_SLOTS) return current;
      const nextSlots = [...slots, createLandingCraftSlot("daihatsu", 0)];
      return {
        ...current,
        perFleet: {
          ...(current.perFleet ?? {}),
          [fleetNo]: { ...previous, daihatsuCount: nextSlots.length, landingCrafts: nextSlots }
        }
      };
    });
  }

  function removeFleetLandingCraft(fleetNo: FleetTimer["fleetNo"], index: number) {
    setRewardSettings((current) => {
      const previous = getFleetRewardModifier(current, fleetNo);
      const nextSlots = normalizeLandingCraftSlots(previous.landingCrafts, previous.daihatsuCount ?? 0).filter((_, slotIndex) => slotIndex !== index);
      return {
        ...current,
        perFleet: {
          ...(current.perFleet ?? {}),
          [fleetNo]: { ...previous, daihatsuCount: nextSlots.length, landingCrafts: nextSlots }
        }
      };
    });
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
      if (sortMode === "燃料時給順") return getAdjustedResourceRate(b, rewardSettings).fuel - getAdjustedResourceRate(a, rewardSettings).fuel;
      if (sortMode === "弾薬時給順") return getAdjustedResourceRate(b, rewardSettings).ammo - getAdjustedResourceRate(a, rewardSettings).ammo;
      if (sortMode === "鋼材時給順") return getAdjustedResourceRate(b, rewardSettings).steel - getAdjustedResourceRate(a, rewardSettings).steel;
      if (sortMode === "ボーキ時給順") return getAdjustedResourceRate(b, rewardSettings).bauxite - getAdjustedResourceRate(a, rewardSettings).bauxite;
      return a.id.localeCompare(b.id, "ja", { numeric: true });
    });
  }, [keyword, tagFilter, pinnedExpeditionIds, sortMode, rewardSettings]);

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
        .sort((a, b) => getTotalResources(getAdjustedResourceRate(b, rewardSettings)) - getTotalResources(getAdjustedResourceRate(a, rewardSettings)))
        .slice(0, 6);
    }

    if (guideMode === "授業・バイト") {
      return expeditions
        .filter((expedition) => expedition.durationMinutes >= 120 && expedition.durationMinutes <= 360)
        .sort((a, b) => getTotalResources(getAdjustedResourceRate(b, rewardSettings)) - getTotalResources(getAdjustedResourceRate(a, rewardSettings)))
        .slice(0, 6);
    }

    if (guideMode === "短時間") {
      return expeditions
        .filter((expedition) => expedition.durationMinutes <= 60)
        .sort((a, b) => getTotalResources(getAdjustedResourceRate(b, rewardSettings)) - getTotalResources(getAdjustedResourceRate(a, rewardSettings)))
        .slice(0, 6);
    }

    const key = resourceKeyMap[guideMode];
    return expeditions
      .filter((expedition) => getAdjustedResourceRate(expedition, rewardSettings)[key] > 0)
      .sort((a, b) => getAdjustedResourceRate(b, rewardSettings)[key] - getAdjustedResourceRate(a, rewardSettings)[key])
      .slice(0, 6);
  }, [guideMode, rewardSettings, expeditions]);

  const selectedDetail = findExpedition(selectedDetailId);
  const totalExpeditionCount = expeditions.length;
  const activeExpeditions = fleets.map((fleet) => findExpedition(fleet.expeditionId));
  const activeHourlyTotal = fleets.reduce<ResourceRewards>(
    (total, fleet) => addResources(total, getAdjustedResourceRate(findExpedition(fleet.expeditionId), rewardSettings, fleet.fleetNo)),
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
  const dailyResourceSeries = useMemo<DailyResourcePoint[]>(() => {
    const keys = getRecentDayKeys(7, now);
    return keys.map((key) => {
      const entries = history.filter((item) => getDayKey(item.completedAt) === key);
      return {
        key,
        label: getDayLabel(key),
        count: entries.length,
        resources: entries.reduce<ResourceRewards>(
          (total, item) => addResources(total, item.rewards),
          { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
        )
      };
    });
  }, [history, now]);
  const dailyResourceMax = dailyResourceSeries.reduce((max, item) => Math.max(max, getDailyChartValue(item.resources, dailyChartMode)), 1);
  const selectedDailyPoint = dailyResourceSeries.find((item) => item.key === selectedDailyKey) ?? dailyResourceSeries[dailyResourceSeries.length - 1];
  const selectedDailyEntries = useMemo(() => {
    if (!selectedDailyPoint) return [];
    return history
      .filter((item) => getDayKey(item.completedAt) === selectedDailyPoint.key)
      .sort((a, b) => b.completedAt - a.completedAt);
  }, [history, selectedDailyPoint]);

  const stockChartSeries = useMemo(() => {
    const start = getStockRangeStart(stockChartRange, now);
    return [...resourceStockSnapshots]
      .filter((snapshot) => snapshot.recordedAt >= start)
      .sort((a, b) => a.recordedAt - b.recordedAt);
  }, [resourceStockSnapshots, stockChartRange, now]);
  const stockChartDisplaySeries = stockChartSeries.length > 0
    ? stockChartSeries
    : [...resourceStockSnapshots].sort((a, b) => a.recordedAt - b.recordedAt).slice(-1);
  const latestStockSnapshot = [...resourceStockSnapshots].sort((a, b) => b.recordedAt - a.recordedAt)[0] ?? null;
  const firstStockSnapshot = stockChartDisplaySeries[0] ?? null;
  const lastStockSnapshot = stockChartDisplaySeries[stockChartDisplaySeries.length - 1] ?? null;
  const stockChartValues = stockChartDisplaySeries.map((snapshot) => getResourceStockValue(snapshot.resources, stockChartMode));
  const stockChartMin = stockChartValues.length ? Math.min(...stockChartValues) : 0;
  const stockChartMax = stockChartValues.length ? Math.max(...stockChartValues) : 1;
  const stockChartRangeValue = Math.max(1, stockChartMax - stockChartMin);
  const stockDelta = firstStockSnapshot && lastStockSnapshot
    ? subtractResources(lastStockSnapshot.resources, firstStockSnapshot.resources)
    : { fuel: 0, ammo: 0, steel: 0, bauxite: 0 };
  const selectedStockSnapshot = stockChartDisplaySeries.find((snapshot) => snapshot.id === selectedStockSnapshotId)
    ?? lastStockSnapshot
    ?? latestStockSnapshot
    ?? null;
  const stockYAxisTicks = Array.from({ length: stockYAxisTickCount }, (_, index) => {
    const ratio = index / Math.max(1, stockYAxisTickCount - 1);
    return Math.round(stockChartMax - stockChartRangeValue * ratio);
  });
  const stockXAxisTicks = stockChartDisplaySeries
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(({ index }) => {
      const lastIndex = stockChartDisplaySeries.length - 1;
      if (lastIndex <= 2) return true;
      return index === 0 || index === Math.round(lastIndex / 2) || index === lastIndex;
    });
  const targetResources: ResourceRewards = {
    fuel: parseResourceStockInput(resourceTargetInputs.fuel),
    ammo: parseResourceStockInput(resourceTargetInputs.ammo),
    steel: parseResourceStockInput(resourceTargetInputs.steel),
    bauxite: parseResourceStockInput(resourceTargetInputs.bauxite)
  };
  const targetBasisStart = now - 7 * 24 * 60 * 60 * 1000;
  const targetBasisSeries = [...resourceStockSnapshots]
    .filter((snapshot) => snapshot.recordedAt >= targetBasisStart)
    .sort((a, b) => a.recordedAt - b.recordedAt);
  const targetFallbackSeries = [...resourceStockSnapshots].sort((a, b) => a.recordedAt - b.recordedAt);
  const targetTrendSeries = targetBasisSeries.length >= 2 ? targetBasisSeries : targetFallbackSeries;
  const targetTrendFirst = targetTrendSeries[0] ?? null;
  const targetTrendLast = targetTrendSeries[targetTrendSeries.length - 1] ?? null;
  const targetTrendDays = targetTrendFirst && targetTrendLast ? getDaysBetween(targetTrendFirst.recordedAt, targetTrendLast.recordedAt) : 1;
  const targetDailyAverage: ResourceRewards = targetTrendFirst && targetTrendLast
    ? {
        fuel: Math.round((targetTrendLast.resources.fuel - targetTrendFirst.resources.fuel) / targetTrendDays),
        ammo: Math.round((targetTrendLast.resources.ammo - targetTrendFirst.resources.ammo) / targetTrendDays),
        steel: Math.round((targetTrendLast.resources.steel - targetTrendFirst.resources.steel) / targetTrendDays),
        bauxite: Math.round((targetTrendLast.resources.bauxite - targetTrendFirst.resources.bauxite) / targetTrendDays)
      }
    : { fuel: 0, ammo: 0, steel: 0, bauxite: 0 };
  const targetPlanRows = resourceKeys.map((key) => {
    const currentValue = latestStockSnapshot?.resources[key] ?? 0;
    const targetValue = targetResources[key];
    const remaining = targetValue - currentValue;
    const dailyAverage = targetDailyAverage[key];
    const days = remaining <= 0 ? 0 : dailyAverage > 0 ? Math.ceil(remaining / dailyAverage) : null;
    return { key, label: resourceFullLabels[key], currentValue, targetValue, remaining, dailyAverage, days };
  });
  const targetTotalCurrent = latestStockSnapshot ? getTotalResources(latestStockSnapshot.resources) : 0;
  const targetTotalGoal = getTotalResources(targetResources);
  const targetTotalRemaining = targetTotalGoal - targetTotalCurrent;
  const targetTotalDailyAverage = getTotalResources(targetDailyAverage);
  const targetTotalDays = targetTotalRemaining <= 0 ? 0 : targetTotalDailyAverage > 0 ? Math.ceil(targetTotalRemaining / targetTotalDailyAverage) : null;
  const pendingReturnFleets = fleets.filter((fleet) => fleet.endAt !== null && now >= fleet.endAt && !fleet.recordedAt);
  const selectedFormationPatterns = getFormationPatterns(selectedDetail);
  const selectedGreatRewards = multiplyResources(selectedDetail.rewards, 1.5);
  const selectedAdjustedRewards = calculateAdjustedRewards(selectedDetail, rewardSettings);
  const selectedAdjustedRate = getAdjustedResourceRate(selectedDetail, rewardSettings);
  const defaultRewardModifier = getFleetRewardModifier(rewardSettings);
  const defaultRewardBreakdown = getRewardBonusBreakdown(rewardSettings);
  const userId = authState.user?.id ?? null;
  const loggedIn = Boolean(userId);
  const webhookRegistered = Boolean(settings.discordWebhookUrl.trim());
  const deviceRegistered = Boolean(deviceStatus?.currentDevice);
  const testNotificationDone = Boolean(setupNotificationTestDone || deviceStatus?.currentDevice?.last_tested_at || log.some((item) => item.includes("通知テスト")));
  const expeditionStarted = fleets.some((fleet) => fleet.startAt !== null) || log.some((item) => item.includes("開始:") || item.includes("通知予約"));
  const setupGuideDone = loggedIn && webhookRegistered && deviceRegistered && testNotificationDone && expeditionStarted;
  const showSetupGuide = !setupGuideDismissed || !setupGuideDone;

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
    if (dailyResourceSeries.length === 0) return;
    if (!dailyResourceSeries.some((item) => item.key === selectedDailyKey)) {
      setSelectedDailyKey(dailyResourceSeries[dailyResourceSeries.length - 1].key);
    }
  }, [dailyResourceSeries, selectedDailyKey]);

  useEffect(() => {
    saveToStorage(FLEET_STORAGE_KEY, fleets);
  }, [fleets]);

  useEffect(() => {
    saveToStorage(SETTINGS_STORAGE_KEY, settings);
  }, [settings]);

  useEffect(() => {
    saveToStorage(REWARD_MODIFIER_STORAGE_KEY, rewardSettings);
  }, [rewardSettings]);

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
    saveToStorage(SETUP_GUIDE_DISMISSED_STORAGE_KEY, setupGuideDismissed);
  }, [setupGuideDismissed]);

  useEffect(() => {
    if (!setupGuideDone || setupGuideDismissed) return;
    const timer = window.setTimeout(() => {
      setSetupGuideDismissed(true);
      addLog("初回設定ガイドを完了したので自動で収納");
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [setupGuideDone, setupGuideDismissed]);

  useEffect(() => {
    saveToStorage(HISTORY_STORAGE_KEY, history);
  }, [history]);

  useEffect(() => {
    saveToStorage(RESOURCE_STOCK_STORAGE_KEY, resourceStockSnapshots);
  }, [resourceStockSnapshots]);

  useEffect(() => {
    saveToStorage(RESOURCE_TARGET_STORAGE_KEY, resourceTargetInputs);
  }, [resourceTargetInputs]);

  useEffect(() => {
    saveToStorage(COLLAPSE_STORAGE_KEY, collapsedPanels);
  }, [collapsedPanels]);

  useEffect(() => {
    saveToStorage("kancolle-expedition-compact-fleet-v1", compactFleetCards);
  }, [compactFleetCards]);

  useEffect(() => {
    saveToStorage(THEME_STORAGE_KEY, themeMode);
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

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

    applyCloudSnapshot(userId, false, { silent: false, reason: "ログイン時の自動読込" }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "クラウド自動読込に失敗";
      setCloudSyncMessage(message);
    });
  }, [authState.user?.id]);

  useEffect(() => {
    const userId = authState.user?.id;
    const client = supabase;
    if (!userId || !client) return;

    const channel = client
      .channel(`active-timers-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_timers", filter: `user_id=eq.${userId}` },
        () => {
          loadActiveTimers(userId)
            .then((rows) => {
              setFleets((current) => mergeActiveTimerRows(current, rows));
              addLog("実行中タイマーをクラウド同期");
            })
            .catch(() => undefined);
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [authState.user?.id]);

  useEffect(() => {
    const userId = authState.user?.id;
    const client = supabase;
    if (!userId || !client) return;

    const channel = client
      .channel(`user-settings-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_settings", filter: `user_id=eq.${userId}` },
        () => {
          scheduleCloudRefresh(userId, "設定・記録データのRealtime更新");
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [authState.user?.id]);

  useEffect(() => {
    const userId = authState.user?.id;
    if (!userId) return;

    const refresh = () => {
      if (document.visibilityState === "visible") {
        scheduleCloudRefresh(userId, "画面復帰時の最新化");
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authState.user?.id]);

  useEffect(() => {
    const userId = authState.user?.id;
    if (!userId) return;

    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      const snapshot = createCloudSnapshot();
      saveCloudSnapshotSafely(userId, snapshot)
        .then(() => saveActiveTimers(userId, fleets))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "クラウド自動保存に失敗";
          addLog(message);
        });
    }, 900);

    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [authState.user?.id, fleets, settings, rewardSettings, pinnedExpeditionIds, customPresets, history, resourceStockSnapshots, resourceTargetInputs, monthlyCompletions, setupNotificationTestDone, setupGuideDismissed, collapsedPanels]);

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
    if (authState.user) {
      clearActiveTimer(authState.user.id, fleetNo, expeditionId).catch(() => undefined);
    }
    updateFleet(fleetNo, {
      expeditionId,
      startAt: null,
      endAt: null,
      notifiedAt: null,
      recordedAt: null
    });
    setSelectedDetailId(expeditionId);
  }

  function startFleet(fleet: FleetTimer, manualRemainingMinutes?: number) {
    const expedition = findExpedition(fleet.expeditionId);
    const syncedNow = getSyncedNow();
    const totalMinutes = expedition.durationMinutes;
    const remainingMinutes =
      typeof manualRemainingMinutes === "number"
        ? clampNumber(manualRemainingMinutes, 1, totalMinutes)
        : totalMinutes;
    const endAt = syncedNow + remainingMinutes * 60 * 1000;
    const startAt = endAt - totalMinutes * 60 * 1000;
    const nextFleet = { ...fleet, startAt, endAt, notifiedAt: null, recordedAt: null };
    updateFleet(fleet.fleetNo, nextFleet);
    if (authState.user) {
      saveActiveTimer(authState.user.id, nextFleet).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "実行中タイマーのクラウド保存に失敗";
        addLog(message);
      });
    }
    addLog(
      typeof manualRemainingMinutes === "number"
        ? `手動セット: 第${fleet.fleetNo}艦隊 ${expedition.name} 残り${remainingMinutes}分`
        : `開始: 第${fleet.fleetNo}艦隊 ${expedition.name}`
    );

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
        content: buildDiscordContent(
          fleet,
          expedition,
          endAt,
          `${formatResources(calculateAdjustedRewards(expedition, rewardSettings, undefined, fleet.fleetNo))}（${getRewardModifierLabel(rewardSettings, fleet.fleetNo)}）`
        ),
        webhookUrl: settings.discordWebhookUrl
      })
        .then(() => addLog(`サーバー側通知を予約: 第${fleet.fleetNo}艦隊 ${expedition.name}`))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "サーバー側通知予約に失敗";
          addLog(message);
        });
    }
  }

  function startFleetWithManualRemaining(fleet: FleetTimer) {
    const rawValue = manualTimerInputs[fleet.fleetNo];
    const minutes = Number(rawValue);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      addLog("残り時間は1分以上で入力してね");
      return;
    }
    startFleet(fleet, minutes);
    setManualTimerInputs((current) => ({ ...current, [fleet.fleetNo]: "" }));
  }

  function restartFleet(fleet: FleetTimer) {
    startFleet(fleet);
  }

  function clearFleet(fleetNo: FleetTimer["fleetNo"]) {
    updateFleet(fleetNo, { startAt: null, endAt: null, notifiedAt: null, recordedAt: null });
    if (authState.user) {
      cancelCloudNotification(authState.user.id, fleetNo).catch(() => undefined);
      clearActiveTimer(authState.user.id, fleetNo, fleets.find((fleet) => fleet.fleetNo === fleetNo)?.expeditionId ?? "").catch(() => undefined);
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
    const rewards = calculateAdjustedRewards(expedition, rewardSettings, result === "great", fleet.fleetNo);
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

    const nextHistory = mergeExpeditionHistories([record, ...history], [], historyClearedAtRef.current);
    setHistory((current) => mergeExpeditionHistories([record, ...current], [], historyClearedAtRef.current));

    let nextMonthlyCompletions = monthlyCompletions;
    if (isMonthlyExpedition(expedition)) {
      const monthItems = new Set(monthlyCompletions[currentMonthKey] ?? []);
      monthItems.add(expedition.id);
      nextMonthlyCompletions = {
        ...monthlyCompletions,
        [currentMonthKey]: Array.from(monthItems).sort((a, b) => a.localeCompare(b, "ja", { numeric: true }))
      };
      setMonthlyCompletions(nextMonthlyCompletions);
    }
    updateFleet(fleet.fleetNo, { recordedAt: Date.now() });
    if (authState.user) {
      clearActiveTimer(authState.user.id, fleet.fleetNo, expedition.id).catch(() => undefined);
      saveImportantCloudChange({ history: nextHistory, monthlyCompletions: nextMonthlyCompletions });
    }
    addLog(`帰投記録: 第${fleet.fleetNo}艦隊 ${expedition.name}（${result === "great" ? "大成功" : "成功"}）`);
  }

  function clearHistory() {
    const ok = window.confirm("遠征履歴をすべて削除しますか？");
    if (!ok) return;
    const clearedAt = getSyncedNow();
    historyClearedAtRef.current = clearedAt;
    saveToStorage(HISTORY_CLEARED_AT_STORAGE_KEY, clearedAt);
    setHistory([]);
    saveImportantCloudChange({ history: [], historyClearedAt: clearedAt });
    addLog("遠征履歴を削除");
  }

  function updateResourceStockInput(key: keyof ResourceRewards, value: string) {
    setResourceStockInputs((current) => ({ ...current, [key]: value }));
  }

  function updateResourceTargetInput(key: keyof ResourceRewards, value: string) {
    setResourceTargetInputs((current) => ({ ...current, [key]: value }));
  }

  function fillResourceTargetsFromLatest(addAmount = 50000) {
    if (!latestStockSnapshot) return;
    setResourceTargetInputs({
      fuel: String(Math.min(999999, latestStockSnapshot.resources.fuel + addAmount)),
      ammo: String(Math.min(999999, latestStockSnapshot.resources.ammo + addAmount)),
      steel: String(Math.min(999999, latestStockSnapshot.resources.steel + addAmount)),
      bauxite: String(Math.min(999999, latestStockSnapshot.resources.bauxite + addAmount))
    });
  }

  function recordResourceStockSnapshot() {
    const resources: ResourceRewards = {
      fuel: parseResourceStockInput(resourceStockInputs.fuel),
      ammo: parseResourceStockInput(resourceStockInputs.ammo),
      steel: parseResourceStockInput(resourceStockInputs.steel),
      bauxite: parseResourceStockInput(resourceStockInputs.bauxite)
    };
    const snapshot: ResourceStockSnapshot = {
      id: `${Date.now()}-stock`,
      recordedAt: getSyncedNow(),
      resources
    };
    const nextSnapshots = mergeResourceStockSnapshots([snapshot, ...resourceStockSnapshots], [], resourceStockClearedAtRef.current);
    setResourceStockSnapshots((current) => mergeResourceStockSnapshots([snapshot, ...current], [], resourceStockClearedAtRef.current));
    saveImportantCloudChange({ resourceStockSnapshots: nextSnapshots });
    addLog(`所持資源を記録: ${formatResources(resources)}`);
  }

  function fillResourceStockInputsFromLatest() {
    setResourceStockInputs(resourceStockSnapshotToInputs(latestStockSnapshot));
  }

  function clearResourceStockSnapshots() {
    const ok = window.confirm("所持資源の推移記録をすべて削除しますか？遠征の帰投履歴は残ります。");
    if (!ok) return;
    const clearedAt = getSyncedNow();
    resourceStockClearedAtRef.current = clearedAt;
    saveToStorage(RESOURCE_STOCK_CLEARED_AT_STORAGE_KEY, clearedAt);
    setResourceStockSnapshots([]);
    setResourceStockInputs(getInitialResourceStockInputs());
    saveImportantCloudChange({ resourceStockSnapshots: [], resourceStockClearedAt: clearedAt });
    addLog("所持資源の推移記録を削除");
  }

  function handlePanelToggle(panel: CollapsibleKey, open: boolean) {
    setCollapsedPanels((current) => ({ ...current, [panel]: !open }));
  }

  function openAllPanels() {
    setCollapsedPanels({ account: false, pwa: false, notifications: false, rewards: false, presets: false, monthly: false, strategy: false, details: false, diagnostics: false, log: false });
  }

  function compactAssistPanels() {
    setCollapsedPanels({ account: false, pwa: true, notifications: true, rewards: true, presets: true, monthly: true, strategy: true, details: false, diagnostics: false, log: true });
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
      version: "3.9.0",
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

  function sanitizeFleetsForSnapshot(items: FleetTimer[]): FleetTimer[] {
    return items.map((fleet) => ({
      ...fleet,
      startAt: null,
      endAt: null,
      notifiedAt: null,
      recordedAt: null
    }));
  }

  function createCloudSnapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
    return {
      fleets: sanitizeFleetsForSnapshot(fleets),
      settings: { ...settings, discordNotifyMode: "direct", serverNotificationMode: "supabase" },
      rewardSettings,
      pinnedExpeditionIds,
      customPresets,
      history,
      resourceStockSnapshots,
      resourceTargetInputs,
      historyClearedAt: historyClearedAtRef.current,
      resourceStockClearedAt: resourceStockClearedAtRef.current,
      monthlyCompletions,
      setupNotificationTestDone,
      setupGuideDismissed,
      collapsedPanels,
      savedAt: new Date().toISOString(),
      appVersion: "3.9.0",
      ...overrides
    };
  }

  function getCloudSavedAtMs(snapshot: CloudSnapshot | null | undefined): number {
    const value = snapshot?.savedAt ? new Date(snapshot.savedAt).getTime() : 0;
    return Number.isFinite(value) ? value : 0;
  }

  function getEffectiveClearedAt(localClearedAt: number, remoteClearedAt?: number): number {
    const remote = typeof remoteClearedAt === "number" && Number.isFinite(remoteClearedAt) ? remoteClearedAt : 0;
    return Math.max(localClearedAt || 0, remote || 0);
  }

  function expeditionHistoryKey(item: ExpeditionHistory): string {
    return item.id || `${item.completedAt}-${item.fleetNo}-${item.expeditionId}-${item.result}`;
  }

  function resourceStockSnapshotKey(item: ResourceStockSnapshot): string {
    return item.id || `${item.recordedAt}-${item.resources.fuel}-${item.resources.ammo}-${item.resources.steel}-${item.resources.bauxite}`;
  }

  function mergeExpeditionHistories(
    localItems: ExpeditionHistory[],
    remoteItems: ExpeditionHistory[],
    clearedAt = 0
  ): ExpeditionHistory[] {
    const map = new Map<string, ExpeditionHistory>();
    [...remoteItems, ...localItems]
      .filter((item) => item && typeof item.completedAt === "number" && item.completedAt > clearedAt)
      .forEach((item) => {
        map.set(expeditionHistoryKey(item), item);
      });
    return Array.from(map.values()).sort((a, b) => b.completedAt - a.completedAt).slice(0, 200);
  }

  function mergeResourceStockSnapshots(
    localItems: ResourceStockSnapshot[],
    remoteItems: ResourceStockSnapshot[],
    clearedAt = 0
  ): ResourceStockSnapshot[] {
    const map = new Map<string, ResourceStockSnapshot>();
    [...remoteItems, ...localItems]
      .filter((item) => item && typeof item.recordedAt === "number" && item.recordedAt > clearedAt)
      .forEach((item) => {
        map.set(resourceStockSnapshotKey(item), item);
      });
    return Array.from(map.values()).sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 500);
  }

  function createMergedSnapshotForSave(localSnapshot: CloudSnapshot, remoteSnapshot: CloudSnapshot | null): CloudSnapshot {
    if (!remoteSnapshot) return localSnapshot;

    const historyClearedAt = getEffectiveClearedAt(
      typeof localSnapshot.historyClearedAt === "number" ? localSnapshot.historyClearedAt : historyClearedAtRef.current,
      remoteSnapshot.historyClearedAt
    );
    const resourceStockClearedAt = getEffectiveClearedAt(
      typeof localSnapshot.resourceStockClearedAt === "number" ? localSnapshot.resourceStockClearedAt : resourceStockClearedAtRef.current,
      remoteSnapshot.resourceStockClearedAt
    );

    const mergedHistory = mergeExpeditionHistories(
      (localSnapshot.history as ExpeditionHistory[] | undefined) ?? [],
      (remoteSnapshot.history as ExpeditionHistory[] | undefined) ?? [],
      historyClearedAt
    );
    const mergedStockSnapshots = mergeResourceStockSnapshots(
      (localSnapshot.resourceStockSnapshots as ResourceStockSnapshot[] | undefined) ?? [],
      (remoteSnapshot.resourceStockSnapshots as ResourceStockSnapshot[] | undefined) ?? [],
      resourceStockClearedAt
    );

    return {
      ...localSnapshot,
      history: mergedHistory,
      resourceStockSnapshots: mergedStockSnapshots,
      historyClearedAt,
      resourceStockClearedAt,
      savedAt: new Date().toISOString()
    };
  }

  async function saveCloudSnapshotSafely(userId: string, localSnapshot: CloudSnapshot): Promise<CloudSnapshot> {
    const remoteSnapshot = await loadCloudSnapshot(userId).catch(() => null);
    const mergedSnapshot = createMergedSnapshotForSave(localSnapshot, remoteSnapshot);
    await saveCloudSnapshot(userId, mergedSnapshot);
    latestCloudSavedAtRef.current = getCloudSavedAtMs(mergedSnapshot);
    return mergedSnapshot;
  }

  function saveImportantCloudChange(overrides: Partial<CloudSnapshot> = {}) {
    const userId = authState.user?.id;
    if (!userId) return;
    const snapshot = createCloudSnapshot(overrides);
    saveCloudSnapshotSafely(userId, snapshot)
      .then((savedSnapshot) => {
        if (savedSnapshot.history) setHistory(savedSnapshot.history as ExpeditionHistory[]);
        if (savedSnapshot.resourceStockSnapshots) setResourceStockSnapshots(savedSnapshot.resourceStockSnapshots as ResourceStockSnapshot[]);
        addLog("記録系データを即時クラウド保存");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "記録系データの即時クラウド保存に失敗";
        addLog(message);
      });
  }

  function parseRemoteTimerTimes(row: Awaited<ReturnType<typeof loadActiveTimers>>[number]) {
    const startAt = row.start_at ? new Date(row.start_at).getTime() : null;
    const endAt = row.end_at ? new Date(row.end_at).getTime() : null;
    return {
      startAt: startAt && Number.isFinite(startAt) ? startAt : null,
      endAt: endAt && Number.isFinite(endAt) ? endAt : null
    };
  }

  function mergeActiveTimerRows(baseFleets: FleetTimer[], rows: Awaited<ReturnType<typeof loadActiveTimers>>): FleetTimer[] {
    if (rows.length === 0) return baseFleets;

    return baseFleets.map((fleet) => {
      const row = rows.find((item) => item.fleet_no === fleet.fleetNo);
      if (!row) return fleet;

      const rowUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const localStartAt = fleet.startAt ?? 0;
      const syncedNow = getSyncedNow();
      const { startAt: remoteStartAt, endAt: remoteEndAt } = parseRemoteTimerTimes(row);
      const localIsRunning = fleet.endAt !== null && fleet.endAt > syncedNow;

      if (row.status === "cleared") {
        // クリア・記録済みの墓標より新しくこの端末で開始したタイマーは消さない。
        if (fleet.endAt && fleet.endAt > syncedNow && localStartAt > rowUpdatedAt) return fleet;
        return {
          ...fleet,
          expeditionId: row.expedition_id || fleet.expeditionId,
          startAt: null,
          endAt: null,
          notifiedAt: null,
          recordedAt: null
        };
      }

      if (row.status !== "running" || !remoteEndAt) return fleet;

      // 別端末の古い行で、新しいローカル実行中タイマーを壊さない。
      if (localIsRunning && localStartAt > rowUpdatedAt && fleet.endAt && fleet.endAt > remoteEndAt) return fleet;

      // v3.6: 通知送信後にアプリを開いた時、active_timersには「過去に終了したrunning行」が残る。
      // 以前はこれを無視していたため、帰投済みカードが復元されず「成功/大成功で記録」ボタンが出ないことがあった。
      // 終了時刻を過ぎたrunning行は「完了待ち」として復元する。
      if (remoteEndAt <= syncedNow + 1000) {
        if (fleet.recordedAt && fleet.endAt === remoteEndAt) return fleet;
        return {
          ...fleet,
          expeditionId: row.expedition_id || fleet.expeditionId,
          startAt: remoteStartAt,
          endAt: remoteEndAt,
          notifiedAt: fleet.notifiedAt ?? syncedNow,
          recordedAt: fleet.recordedAt ?? null,
          pcNotify: Boolean(row.pc_notify),
          discordNotify: row.discord_notify ?? fleet.discordNotify
        };
      }

      return {
        ...fleet,
        expeditionId: row.expedition_id || fleet.expeditionId,
        startAt: remoteStartAt,
        endAt: remoteEndAt,
        notifiedAt: null,
        recordedAt: null,
        pcNotify: Boolean(row.pc_notify),
        discordNotify: row.discord_notify ?? fleet.discordNotify
      };
    });
  }


  async function applyCloudSnapshot(
    userId: string,
    ask = true,
    options: { silent?: boolean; reason?: string } = {}
  ) {
    const ok = !ask || window.confirm("クラウド保存データを読み込みます。遠征履歴と所持資源推移は端末間でマージします。続行しますか？");
    if (!ok) return false;

    const snapshot = await loadCloudSnapshot(userId);
    const activeRows = await loadActiveTimers(userId).catch(() => []);
    if (!snapshot && activeRows.length === 0) {
      if (!options.silent) setCloudSyncMessage("クラウド保存データはまだないよ");
      return false;
    }

    const remoteSavedAt = getCloudSavedAtMs(snapshot);
    latestCloudSavedAtRef.current = Math.max(latestCloudSavedAtRef.current, remoteSavedAt);

    const snapshotFleets = (snapshot?.fleets as FleetTimer[] | undefined) ?? initialFleets;
    const baseFleets = snapshotFleets.map((snapshotFleet) => {
      const localFleet = fleets.find((item) => item.fleetNo === snapshotFleet.fleetNo);
      const localRunning = localFleet?.endAt !== null && typeof localFleet?.endAt === "number" && localFleet.endAt > getSyncedNow();
      // v3.2: クラウドスナップショットは実行中タイマーを持たないため、
      // ローカル実行中タイマーを空状態で上書きしない。
      return localRunning ? localFleet : snapshotFleet;
    });
    const nextFleets = mergeActiveTimerRows(baseFleets, activeRows);

    const nextHistoryClearedAt = getEffectiveClearedAt(historyClearedAtRef.current, snapshot?.historyClearedAt);
    const nextResourceStockClearedAt = getEffectiveClearedAt(resourceStockClearedAtRef.current, snapshot?.resourceStockClearedAt);
    historyClearedAtRef.current = nextHistoryClearedAt;
    resourceStockClearedAtRef.current = nextResourceStockClearedAt;
    saveToStorage(HISTORY_CLEARED_AT_STORAGE_KEY, nextHistoryClearedAt);
    saveToStorage(RESOURCE_STOCK_CLEARED_AT_STORAGE_KEY, nextResourceStockClearedAt);

    const nextHistory = mergeExpeditionHistories(
      history,
      (snapshot?.history as ExpeditionHistory[] | undefined) ?? [],
      nextHistoryClearedAt
    );
    const nextResourceStockSnapshots = mergeResourceStockSnapshots(
      resourceStockSnapshots,
      (snapshot?.resourceStockSnapshots as ResourceStockSnapshot[] | undefined) ?? [],
      nextResourceStockClearedAt
    );

    skipNextAutoSaveRef.current = true;
    setFleets(nextFleets);
    setSettings({ ...initialSettings, ...((snapshot?.settings as AppSettings | undefined) ?? {}), discordNotifyMode: "direct", serverNotificationMode: "supabase" });
    const snapshotRewardSettings = ((snapshot?.rewardSettings ?? {}) as Partial<RewardModifierSettings>);
    setRewardSettings({
      ...initialRewardModifierSettings,
      ...snapshotRewardSettings,
      perFleet: {
        ...initialRewardModifierSettings.perFleet,
        ...(snapshotRewardSettings.perFleet ?? {})
      }
    });
    setPinnedExpeditionIds(snapshot?.pinnedExpeditionIds ?? pinnedExpeditionIds);
    setCustomPresets((snapshot?.customPresets as ExpeditionPreset[] | undefined) ?? customPresets);
    setHistory(nextHistory);
    setResourceStockSnapshots(nextResourceStockSnapshots);
    setResourceTargetInputs({
      ...getResourceTargetInputDefaults(),
      ...((snapshot?.resourceTargetInputs as ResourceTargetInputs | undefined) ?? resourceTargetInputs)
    });
    setMonthlyCompletions((snapshot?.monthlyCompletions as MonthlyCompletionMap | undefined) ?? monthlyCompletions);
    setSetupNotificationTestDone(Boolean(snapshot?.setupNotificationTestDone ?? setupNotificationTestDone));
    setSetupGuideDismissed(Boolean(snapshot?.setupGuideDismissed ?? setupGuideDismissed));
    setCollapsedPanels((snapshot?.collapsedPanels as CollapseState | undefined) ?? collapsedPanels);

    if (!options.silent) {
      setCloudSyncMessage(snapshot ? `クラウドから読み込んだよ（${new Date(snapshot.savedAt).toLocaleString("ja-JP")}保存）` : "実行中タイマーをクラウドから読み込んだよ");
    }
    addLog(options.reason ? `クラウド同期: ${options.reason}` : "クラウド読込完了");
    return true;
  }

  function scheduleCloudRefresh(userId: string, reason: string) {
    if (cloudRefreshTimerRef.current) window.clearTimeout(cloudRefreshTimerRef.current);
    cloudRefreshTimerRef.current = window.setTimeout(() => {
      applyCloudSnapshot(userId, false, { silent: true, reason }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "クラウド自動更新に失敗";
        addLog(message);
      });
    }, 350);
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
      const savedSnapshot = await saveCloudSnapshotSafely(authState.user.id, createCloudSnapshot());
      await saveActiveTimers(authState.user.id, fleets);
      if (savedSnapshot.history) setHistory(savedSnapshot.history as ExpeditionHistory[]);
      if (savedSnapshot.resourceStockSnapshots) setResourceStockSnapshots(savedSnapshot.resourceStockSnapshots as ResourceStockSnapshot[]);
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

  const runningFleetCount = fleets.filter((fleet) => fleet.endAt !== null && now < fleet.endAt).length;
  const completedFleetCount = pendingReturnFleets.length;
  const almostDoneFleetCount = fleets.filter((fleet) => {
    if (!fleet.endAt || now >= fleet.endAt) return false;
    return fleet.endAt - now <= 5 * 60 * 1000;
  }).length;
  const nextFleet = fleets
    .filter((fleet) => fleet.endAt !== null && now < fleet.endAt)
    .sort((a, b) => (a.endAt ?? 0) - (b.endAt ?? 0))[0];
  const nextFleetExpedition = nextFleet ? findExpedition(nextFleet.expeditionId) : null;
  const quickPresets = allPresets.slice(0, 3);
  const cloudStatusLabel = authState.user ? "クラウド同期OK" : "ローカル保存";
  const notificationStatusLabel = deviceStatus?.permission === "granted" ? "スマホ通知OK" : "通知設定確認";

  function switchAppTab(tab: MobileTab, targetId?: string) {
    setMobileTab(tab);
    window.setTimeout(() => {
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 0);
  }

  function jumpToRecords() {
    setSelectedDailyKey(getDayKey(now));
    switchAppTab("records", "records-section");
  }

  function jumpToExpeditionDetail(expeditionId: string) {
    setSelectedDetailId(expeditionId);
    setCollapsedPanels((current) => ({ ...current, details: false }));
    switchAppTab("search", "detail-search-section");
  }

  function jumpToAssist(targetId: "preset-section" | "strategy-section" = "preset-section") {
    setCollapsedPanels((current) => ({ ...current, presets: false, strategy: false }));
    switchAppTab("assist", targetId);
  }

  function jumpToAccount(targetId: string = "account-cloud-section") {
    setCollapsedPanels((current) => ({ ...current, account: false, pwa: false, notifications: false }));
    switchAppTab("account", targetId);
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
    <main className={`app-shell mobile-tab-${mobileTab} theme-${themeMode} ${compactFleetCards ? "compact-fleets" : ""}`}>
      <header className="hero">
        <div>
          <p className="eyebrow">KanColle Expedition Support</p>
          <h1>艦これ遠征サポート</h1>
          <p>
            遠征タイマー・通知・遠征検索・記録をタブで切り替える司令室UI。現在の収録遠征は<strong>{totalExpeditionCount}件</strong>、お気に入りは<strong>{pinnedExpeditionIds.length}件</strong>。
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
          <div className="theme-switch" role="group" aria-label="テーマ切替">
            <button type="button" className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")}>ライト</button>
            <button type="button" className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")}>ダーク</button>
          </div>
          <button type="button" className="ghost small" onClick={() => setCompactFleetCards((value) => !value)}>
            {compactFleetCards ? "通常カード" : "簡易カード"}
          </button>
        </div>
      </header>

      <nav className="desktop-tabbar" aria-label="画面タブ">
        <button type="button" className={mobileTab === "timers" ? "active" : ""} onClick={() => switchAppTab("timers")}><span>タイマー</span><small>司令室</small></button>
        <button type="button" className={mobileTab === "search" ? "active" : ""} onClick={() => switchAppTab("search", "detail-search-section")}><span>遠征</span><small>検索・条件</small></button>
        <button type="button" className={mobileTab === "assist" ? "active" : ""} onClick={() => switchAppTab("assist", "preset-section")}><span>攻略</span><small>候補・セット</small></button>
        <button type="button" className={mobileTab === "records" ? "active" : ""} onClick={() => switchAppTab("records", "records-section")}><span>記録</span><small>資源・履歴</small></button>
        <button type="button" className={mobileTab === "account" ? "active" : ""} onClick={() => switchAppTab("account", "account-cloud-section")}><span>設定</span><small>通知・同期</small></button>
      </nav>

      {pendingReturnFleets.length > 0 && (
        <section className="return-check-card" aria-label="帰投チェック">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Return Check</p>
              <h2>帰投チェック</h2>
              <p className="helper-text">通知後にアプリを開いたら、ここからすぐ成功/大成功で記録できるよ。</p>
            </div>
            <span className="status done">{pendingReturnFleets.length}件 完了待ち</span>
          </div>
          <div className="return-check-list">
            {pendingReturnFleets.map((fleet) => {
              const expedition = findExpedition(fleet.expeditionId);
              return (
                <article className="return-check-item" key={`return-${fleet.fleetNo}`}>
                  <div>
                    <strong>第{fleet.fleetNo}艦隊が帰投</strong>
                    <span>{expedition.id}: {expedition.name}</span>
                    <small>終了予定 {formatDateTime(fleet.endAt)} / {getRewardModifierLabel(rewardSettings, fleet.fleetNo)}</small>
                  </div>
                  <div className="return-check-actions">
                    <button type="button" onClick={() => recordFleetResult(fleet, "success")}>成功で記録</button>
                    <button type="button" onClick={() => recordFleetResult(fleet, "great")}>大成功で記録</button>
                    <button type="button" className="ghost" onClick={() => jumpToExpeditionDetail(expedition.id)}>条件を見る</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section id="dashboard-section" className="dashboard-strip" aria-label="遠征司令室">
        <article className="command-card status-command-card">
          <p className="eyebrow">Command Deck</p>
          <h2>遠征司令室</h2>
          <div className="command-status-grid">
            <span><strong>{runningFleetCount}</strong>遠征中</span>
            <span><strong>{completedFleetCount}</strong>完了待ち</span>
            <span><strong>{almostDoneFleetCount}</strong>残り5分</span>
          </div>
          <p className="helper-text">{nextFleet && nextFleetExpedition ? `次の帰投：第${nextFleet.fleetNo}艦隊 ${nextFleetExpedition.name} / ${formatDateTime(nextFleet.endAt)}` : "現在、帰投待ちの艦隊はないよ。"}</p>
        </article>

        <article className="command-card resource-command-card">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Today</p>
              <h3>今日の獲得資材</h3>
            </div>
            <button type="button" className="ghost small" onClick={jumpToRecords}>詳細</button>
          </div>
          <div className="daily-total-grid compact-resource-cards mini-dashboard-resources">
            <button type="button" className={dailyChartMode === "燃料" ? "active" : ""} onClick={() => setDailyChartMode("燃料")}>燃料<strong>{todayTotal.fuel}</strong></button>
            <button type="button" className={dailyChartMode === "弾薬" ? "active" : ""} onClick={() => setDailyChartMode("弾薬")}>弾薬<strong>{todayTotal.ammo}</strong></button>
            <button type="button" className={dailyChartMode === "鋼材" ? "active" : ""} onClick={() => setDailyChartMode("鋼材")}>鋼材<strong>{todayTotal.steel}</strong></button>
            <button type="button" className={dailyChartMode === "ボーキ" ? "active" : ""} onClick={() => setDailyChartMode("ボーキ")}>ボーキ<strong>{todayTotal.bauxite}</strong></button>
          </div>
          <p className="helper-text">{todayHistory.length}件記録 / 大成功{todayGreatCount}件</p>
        </article>

        <article className="command-card quick-preset-command-card">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Quick Preset</p>
              <h3>ワンタップ編成</h3>
            </div>
            <button type="button" className="ghost small" onClick={() => jumpToAssist("preset-section")}>全部</button>
          </div>
          <div className="quick-preset-list">
            {quickPresets.map((preset) => (
              <button type="button" key={`dashboard-${preset.id}`} onClick={() => applyPreset(preset)}>
                <span>{preset.name}</span>
                <small>{formatResources(getPresetRatesFor(preset))} / h</small>
              </button>
            ))}
          </div>
          <div className="command-chip-row">
            <span>{cloudStatusLabel}</span>
            <span>{notificationStatusLabel}</span>
          </div>
        </article>
      </section>

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
          <div className="cloud-message account-message-stack">
            <span>{cloudSyncMessage || "初めて使う場合は新規登録 → ログイン。ログイン後は「クラウドへ保存」「クラウドから読込」で端末間同期できるよ。"}</span>
            {setupGuideDismissed ? (
              <button type="button" className="ghost small" onClick={() => setSetupGuideDismissed(false)}>
                初回設定ガイドを再表示
              </button>
            ) : null}
          </div>
        </div>
      </details>

      {showSetupGuide ? (
        <InitialSetupGuide
          loggedIn={loggedIn}
          webhookRegistered={webhookRegistered}
          deviceRegistered={deviceRegistered}
          testNotificationDone={testNotificationDone}
          expeditionStarted={expeditionStarted}
          autoDismissReady={setupGuideDone}
          onDismiss={() => setSetupGuideDismissed(true)}
          onJumpAccount={() => jumpToAccount("account-cloud-section")}
          onJumpNotification={() => jumpToAccount("notification-section")}
          onJumpTimer={() => switchAppTab("timers", "fleet-timer-section")}
          onTestNotification={runSetupNotificationTest}
        />
      ) : null}

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
        id="reward-section"
        className="reward-card fold-card"
        open={!collapsedPanels.rewards}
        onToggle={(event) => handlePanelToggle("rewards", event.currentTarget.open)}
      >
        <summary className="fold-summary">
          <span><small>Reward Bonus</small><strong>大成功・大発補正</strong></span>
          <em>{collapsedPanels.rewards ? "開く" : "閉じる"}</em>
        </summary>
        <div className="fold-content reward-settings-content">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Reward Forecast</p>
              <h2>報酬補正設定</h2>
              <p>遠征報酬・時給目安・通知文・帰投記録を、大成功と艦隊ごとの大発動艇系補正込みで見積もるよ。</p>
            </div>
            <div className="reward-bonus-summary">
              <span>現在の計算</span>
              <strong>{getRewardModifierLabel(rewardSettings)}</strong>
            </div>
          </div>

          <div className="reward-settings-grid reward-settings-grid-v36">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={rewardSettings.greatSuccessDefault}
                onChange={(event) => setRewardSettings((current) => ({ ...current, greatSuccessDefault: event.target.checked }))}
              />
              <span>大成功で見積もる</span>
              <small>ONなら資材1.5倍として表示・記録する。</small>
            </label>

            <label className="toggle-card">
              <input
                type="checkbox"
                checked={rewardSettings.kinuKaiNiBonus}
                onChange={(event) => setRewardSettings((current) => ({ ...current, kinuKaiNiBonus: event.target.checked }))}
              />
              <span>鬼怒改二ボーナスを含める</span>
              <small>大発系ボーナス枠に+5%。改修平均には含めない。</small>
            </label>

            <div className="reward-bonus-summary soft">
              <span>既定の大発系補正</span>
              <strong>+{formatBonusPercent(defaultRewardBreakdown.totalBonus)}</strong>
              <small>{getLandingCraftSummary(rewardSettings)}</small>
            </div>
          </div>

          <div className="craft-editor global-craft-editor">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Landing Craft</p>
                <h3>既定の大発系装備</h3>
                <p className="helper-text">艦隊ごとの設定が無いときに使う既定値。第2〜第4艦隊は各艦隊カード内で個別に調整できる。</p>
              </div>
              <button type="button" className="secondary small" onClick={addDefaultLandingCraft} disabled={(defaultRewardModifier.landingCrafts?.length ?? 0) >= MAX_LANDING_CRAFT_SLOTS}>装備追加</button>
            </div>
            <div className="craft-slot-list">
              {(defaultRewardModifier.landingCrafts ?? []).length === 0 ? (
                <p className="empty-text">大発系装備なし。必要なら「装備追加」から追加してね。</p>
              ) : (defaultRewardModifier.landingCrafts ?? []).map((slot, index) => (
                <div className="craft-slot-row" key={slot.id}>
                  <select value={slot.type} onChange={(event) => updateDefaultLandingCraft(index, { type: event.target.value as LandingCraftTypeId })}>
                    {landingCraftDefinitions.map((definition) => (
                      <option value={definition.id} key={definition.id}>{definition.label}</option>
                    ))}
                  </select>
                  <label>
                    <span>★</span>
                    <input type="number" min={0} max={10} value={slot.stars} onChange={(event) => updateDefaultLandingCraft(index, { stars: Number(event.target.value) })} />
                  </label>
                  <button type="button" className="ghost small" onClick={() => removeDefaultLandingCraft(index)}>削除</button>
                </div>
              ))}
            </div>
          </div>

          <div className="reward-preview-grid">
            <div>
              <span>選択中の遠征</span>
              <strong>{selectedDetail.id}: {selectedDetail.name}</strong>
            </div>
            <div>
              <span>基礎報酬</span>
              <strong>{formatResources(selectedDetail.rewards)}</strong>
            </div>
            <div>
              <span>補正込み報酬</span>
              <strong>{formatResources(selectedAdjustedRewards)}</strong>
            </div>
            <div>
              <span>補正込み時給</span>
              <strong>{formatResources(selectedAdjustedRate)} / h</strong>
            </div>
          </div>

          <p className="helper-text">計算は「大発系枠 最大+20%」「改修平均★による最大+2%相当」「特大発動艇の追加枠」を分けて見積もるよ。端数は資材ごとに床関数で丸める。</p>
        </div>
      </details>

      <details
        id="preset-section"
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
            <span>補正込みの合計時給目安</span>
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
                  <strong>補正込み {formatResources(rates)} / h</strong>
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
        id="monthly-section"
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
                      <button type="button" className="ghost" onClick={() => jumpToExpeditionDetail(expedition.id)}>詳細を見る</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </details>

      <details
        id="strategy-section"
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
              const rate = getAdjustedResourceRate(expedition, rewardSettings);
              return (
                <article className="guide-item" key={`guide-${guideMode}-${expedition.id}`}>
                  <div>
                    <strong>{expedition.id}: {expedition.name}</strong>
                    <small>{minutesToLabel(expedition.durationMinutes)} / {expedition.purposeTags.slice(0, 4).join("・")}</small>
                    <span>時給：{formatResources(rate)} / h</span>
                  </div>
                  <div className="guide-actions">
                    <button type="button" onClick={() => jumpToExpeditionDetail(expedition.id)}>詳細</button>
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
            <div className="daily-total-grid compact-resource-cards">
              <button type="button" className={dailyChartMode === "燃料" ? "active" : ""} onClick={() => setDailyChartMode("燃料")}>燃料<strong>{todayTotal.fuel}</strong></button>
              <button type="button" className={dailyChartMode === "弾薬" ? "active" : ""} onClick={() => setDailyChartMode("弾薬")}>弾薬<strong>{todayTotal.ammo}</strong></button>
              <button type="button" className={dailyChartMode === "鋼材" ? "active" : ""} onClick={() => setDailyChartMode("鋼材")}>鋼材<strong>{todayTotal.steel}</strong></button>
              <button type="button" className={dailyChartMode === "ボーキ" ? "active" : ""} onClick={() => setDailyChartMode("ボーキ")}>ボーキ<strong>{todayTotal.bauxite}</strong></button>
            </div>
            <div className="daily-chart-toolbar" aria-label="日別グラフ表示切替">
              {dailyChartModes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={dailyChartMode === mode ? "active" : ""}
                  onClick={() => setDailyChartMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="daily-chart" aria-label={`直近7日の${getDailyChartModeUnit(dailyChartMode)}グラフ`}>
              {dailyResourceSeries.map((point) => {
                const value = getDailyChartValue(point.resources, dailyChartMode);
                const height = value === 0 ? 6 : Math.max(10, Math.round((value / dailyResourceMax) * 100));
                const isSelected = point.key === selectedDailyPoint?.key;
                return (
                  <button
                    type="button"
                    className={`daily-chart-item ${isSelected ? "selected" : ""}`}
                    key={point.key}
                    onClick={() => setSelectedDailyKey(point.key)}
                    title={`${point.label}: ${formatResourceBreakdown(point.resources)}`}
                  >
                    <span className="daily-chart-bar-wrap">
                      <span className="daily-chart-bar" style={{ height: `${height}%` }} />
                    </span>
                    <small>{point.label}</small>
                    <strong>{value}</strong>
                  </button>
                );
              })}
            </div>
            {selectedDailyPoint && (
              <div className="daily-breakdown-card">
                <div>
                  <small>選択日</small>
                  <strong>{selectedDailyPoint.label}</strong>
                </div>
                <div>
                  <small>{dailyChartMode}表示</small>
                  <strong>{getDailyChartValue(selectedDailyPoint.resources, dailyChartMode)}</strong>
                </div>
                <p>{formatResourceBreakdown(selectedDailyPoint.resources)} / 記録{selectedDailyPoint.count}件</p>
              </div>
            )}
            <p className="helper-text">記録数：{todayHistory.length}件 / 大成功：{todayGreatCount}件。バーをタップすると、その日の資材内訳を確認できる。</p>
            <div className="history-list compact-history">
              {selectedDailyEntries.length === 0 ? (
                <p className="empty-text">選択日の帰投記録はまだないよ。</p>
              ) : (
                selectedDailyEntries.slice(0, 5).map((item) => (
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

      <section id="records-section" className="records-card fold-card always-open-panel">
        <div className="fold-summary static-summary">
          <span><small>Records</small><strong>資材記録・グラフ</strong></span>
          <em>記録</em>
        </div>
        <div className="fold-content records-content">
          <aside className="daily-summary records-summary">
            <div className="section-head compact">
              <div>
                <p className="eyebrow">Daily Resources</p>
                <h3>今日の獲得資材</h3>
              </div>
              <button type="button" className="ghost small" onClick={clearHistory} disabled={history.length === 0}>履歴削除</button>
            </div>
            <div className="daily-total-grid compact-resource-cards">
              <button type="button" className={dailyChartMode === "燃料" ? "active" : ""} onClick={() => setDailyChartMode("燃料")}>燃料<strong>{todayTotal.fuel}</strong></button>
              <button type="button" className={dailyChartMode === "弾薬" ? "active" : ""} onClick={() => setDailyChartMode("弾薬")}>弾薬<strong>{todayTotal.ammo}</strong></button>
              <button type="button" className={dailyChartMode === "鋼材" ? "active" : ""} onClick={() => setDailyChartMode("鋼材")}>鋼材<strong>{todayTotal.steel}</strong></button>
              <button type="button" className={dailyChartMode === "ボーキ" ? "active" : ""} onClick={() => setDailyChartMode("ボーキ")}>ボーキ<strong>{todayTotal.bauxite}</strong></button>
            </div>
            <div className="daily-chart-toolbar" aria-label="日別グラフ表示切替">
              {dailyChartModes.map((mode) => (
                <button
                  type="button"
                  key={`records-${mode}`}
                  className={dailyChartMode === mode ? "active" : ""}
                  onClick={() => setDailyChartMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="daily-chart" aria-label={`直近7日の${getDailyChartModeUnit(dailyChartMode)}グラフ`}>
              {dailyResourceSeries.map((point) => {
                const value = getDailyChartValue(point.resources, dailyChartMode);
                const height = value === 0 ? 6 : Math.max(10, Math.round((value / dailyResourceMax) * 100));
                const isSelected = point.key === selectedDailyPoint?.key;
                return (
                  <button
                    type="button"
                    className={`daily-chart-item ${isSelected ? "selected" : ""}`}
                    key={`records-${point.key}`}
                    onClick={() => setSelectedDailyKey(point.key)}
                    title={`${point.label}: ${formatResourceBreakdown(point.resources)}`}
                  >
                    <span className="daily-chart-bar-wrap">
                      <span className="daily-chart-bar" style={{ height: `${height}%` }} />
                    </span>
                    <small>{point.label}</small>
                    <strong>{value}</strong>
                  </button>
                );
              })}
            </div>
            {selectedDailyPoint && (
              <div className="daily-breakdown-card">
                <div>
                  <small>選択日</small>
                  <strong>{selectedDailyPoint.label}</strong>
                </div>
                <div>
                  <small>{dailyChartMode}表示</small>
                  <strong>{getDailyChartValue(selectedDailyPoint.resources, dailyChartMode)}</strong>
                </div>
                <p>{formatResourceBreakdown(selectedDailyPoint.resources)} / 記録{selectedDailyPoint.count}件</p>
              </div>
            )}
            <p className="helper-text">バーをタップすると、その日の資材内訳を確認できる。記録数：{todayHistory.length}件 / 大成功：{todayGreatCount}件。</p>
            <div className="history-list compact-history">
              {selectedDailyEntries.length === 0 ? (
                <p className="empty-text">選択日の帰投記録はまだないよ。</p>
              ) : (
                selectedDailyEntries.slice(0, 8).map((item) => (
                  <p key={`records-${item.id}`}>
                    <span>{formatShortDateTime(item.completedAt)}</span>
                    第{item.fleetNo} {item.expeditionName} / {item.result === "great" ? "大成功" : "成功"} / {formatResources(item.rewards)}
                  </p>
                ))
              )}
            </div>

            <section className="resource-stock-panel" aria-label="所持資源推移">
              <div className="section-head compact">
                <div>
                  <p className="eyebrow">Resource Stock</p>
                  <h3>所持資源の推移</h3>
                  <p className="helper-text">1日1〜2回、艦これ側の現在資源を入力。総量の増減や各資源の収支を折れ線で見られるよ。</p>
                </div>
                <button type="button" className="ghost small" onClick={clearResourceStockSnapshots} disabled={resourceStockSnapshots.length === 0}>推移削除</button>
              </div>

              <div className="resource-stock-input-card">
                <div className="resource-stock-input-head">
                  <div>
                    <strong>現在資源を入力</strong>
                    <span>艦これ画面と同じ配置：燃料/鋼材、弾薬/ボーキ</span>
                  </div>
                  {latestStockSnapshot ? <small>最新 {formatShortDateTime(latestStockSnapshot.recordedAt)}</small> : <small>まだ未記録</small>}
                </div>
                <div className="resource-stock-input-grid game-resource-grid">
                  {resourceGameGridKeys.map((key) => (
                    <label key={`stock-input-${key}`} data-resource={key}>
                      <span>{resourceFullLabels[key]}</span>
                      <input type="number" min={0} max={999999} value={resourceStockInputs[key]} onChange={(event) => updateResourceStockInput(key, event.target.value)} placeholder="現在値" inputMode="numeric" />
                    </label>
                  ))}
                  <button type="button" className="stock-record-button" onClick={recordResourceStockSnapshot}>現在資源を記録</button>
                  <button type="button" className="secondary stock-fill-button" onClick={fillResourceStockInputsFromLatest} disabled={!latestStockSnapshot}>最新値を入力欄へ</button>
                </div>
              </div>

              <div className="stock-chart-controls" aria-label="所持資源グラフ切替">
                <div>
                  {dailyChartModes.map((mode) => (
                    <button type="button" key={`stock-mode-${mode}`} className={stockChartMode === mode ? "active" : ""} onClick={() => setStockChartMode(mode)}>{mode}</button>
                  ))}
                </div>
                <div>
                  {stockChartRanges.map((range) => (
                    <button type="button" key={`stock-range-${range}`} className={stockChartRange === range ? "active" : ""} onClick={() => setStockChartRange(range)}>{range}</button>
                  ))}
                </div>
              </div>

              <div className="stock-line-chart axis-chart">
                {stockChartDisplaySeries.length < 2 ? (
                  <p className="empty-text">2件以上記録すると折れ線グラフが表示されるよ。まずは今の資源を記録してみて。</p>
                ) : (
                  <div className="stock-chart-frame">
                    <div className="stock-y-axis" aria-hidden="true">
                      {stockYAxisTicks.map((tick) => (
                        <span key={`stock-y-${tick}`}>{formatAxisNumber(tick)}</span>
                      ))}
                    </div>
                    <div className="stock-plot-area">
                      <svg viewBox="0 0 100 52" preserveAspectRatio="none" role="img" aria-label={`${stockChartRange}の${stockChartMode}推移`}>
                        {[0, 1, 2, 3].map((lineIndex) => {
                          const y = 6 + lineIndex * 14;
                          return <line key={`grid-y-${lineIndex}`} className="stock-grid-line" x1="0" x2="100" y1={y} y2={y} />;
                        })}
                        {stockXAxisTicks.map(({ index }) => {
                          const x = stockChartDisplaySeries.length === 1 ? 50 : (index / (stockChartDisplaySeries.length - 1)) * 100;
                          return <line key={`grid-x-${index}`} className="stock-grid-line vertical" x1={x} x2={x} y1="6" y2="48" />;
                        })}
                        <polyline
                          points={stockChartDisplaySeries.map((snapshot, index) => {
                            const x = stockChartDisplaySeries.length === 1 ? 50 : (index / (stockChartDisplaySeries.length - 1)) * 100;
                            const value = getResourceStockValue(snapshot.resources, stockChartMode);
                            const y = 48 - ((value - stockChartMin) / stockChartRangeValue) * 42;
                            return `${x.toFixed(2)},${y.toFixed(2)}`;
                          }).join(" ")}
                        />
                        {stockChartDisplaySeries.map((snapshot, index) => {
                          const x = stockChartDisplaySeries.length === 1 ? 50 : (index / (stockChartDisplaySeries.length - 1)) * 100;
                          const value = getResourceStockValue(snapshot.resources, stockChartMode);
                          const y = 48 - ((value - stockChartMin) / stockChartRangeValue) * 42;
                          return (
                            <circle
                              key={snapshot.id}
                              className={selectedStockSnapshot?.id === snapshot.id ? "selected" : ""}
                              cx={x}
                              cy={y}
                              r={selectedStockSnapshot?.id === snapshot.id ? "2" : "1.45"}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedStockSnapshotId(snapshot.id)}
                              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedStockSnapshotId(snapshot.id); }}
                            >
                              <title>{formatStockSnapshotLabel(snapshot.recordedAt, stockChartRange)}：{value.toLocaleString("ja-JP")}</title>
                            </circle>
                          );
                        })}
                      </svg>
                      <div className="stock-x-axis" aria-hidden="true">
                        {stockXAxisTicks.map(({ snapshot, index }) => {
                          const left = stockChartDisplaySeries.length === 1 ? 50 : (index / (stockChartDisplaySeries.length - 1)) * 100;
                          return <span key={`stock-x-${snapshot.id}`} style={{ left: `${left}%` }}>{formatStockAxisDate(snapshot.recordedAt, stockChartRange)}</span>;
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {selectedStockSnapshot && (
                <div className="stock-point-detail">
                  <small>選択中の記録</small>
                  <strong>{formatStockSnapshotLabel(selectedStockSnapshot.recordedAt, stockChartRange)}：{getResourceStockValue(selectedStockSnapshot.resources, stockChartMode).toLocaleString("ja-JP")}</strong>
                  <span>{formatResources(selectedStockSnapshot.resources)} / {formatShortDateTime(selectedStockSnapshot.recordedAt)}</span>
                </div>
              )}

              <div className="stock-summary-grid">
                <div><small>最新</small><strong>{latestStockSnapshot ? getTotalResources(latestStockSnapshot.resources).toLocaleString("ja-JP") : "未記録"}</strong><span>{latestStockSnapshot ? `${formatResources(latestStockSnapshot.resources)} / ${formatShortDateTime(latestStockSnapshot.recordedAt)}` : "現在値を記録すると表示される"}</span></div>
                <div><small>{stockChartRange}の収支</small><strong>{formatSignedNumber(getResourceStockValue(stockDelta, stockChartMode))}</strong><span>{formatSignedResources(stockDelta)}</span></div>
                <div><small>記録数</small><strong>{resourceStockSnapshots.length}件</strong><span>表示中：{stockChartDisplaySeries.length}件</span></div>
              </div>

              <section className="resource-target-panel" aria-label="資源目標プランナー">
                <div className="section-head compact">
                  <div>
                    <p className="eyebrow">Target Planner</p>
                    <h3>資源目標プランナー</h3>
                    <p className="helper-text">目標値と最近の資源推移から、到達までの目安日数をざっくり出すよ。</p>
                  </div>
                  <button type="button" className="ghost small" onClick={() => fillResourceTargetsFromLatest()} disabled={!latestStockSnapshot}>最新+5万</button>
                </div>
                <div className="resource-target-input-grid game-resource-grid">
                  {resourceGameGridKeys.map((key) => (
                    <label key={`target-input-${key}`} data-resource={key}>
                      <span>{resourceFullLabels[key]}</span>
                      <input type="number" min={0} max={999999} value={resourceTargetInputs[key]} onChange={(event) => updateResourceTargetInput(key, event.target.value)} placeholder="目標値" inputMode="numeric" />
                    </label>
                  ))}
                </div>
                <div className="target-overview-card">
                  <div>
                    <small>合計目標まで</small>
                    <strong>{targetTotalRemaining <= 0 ? "達成済み" : targetTotalDays === null ? "ペース不足" : `約${targetTotalDays}日`}</strong>
                    <span>現在 {targetTotalCurrent.toLocaleString("ja-JP")} / 目標 {targetTotalGoal.toLocaleString("ja-JP")} / 平均 {formatSignedNumber(targetTotalDailyAverage)}/日</span>
                  </div>
                </div>
                <div className="target-plan-grid">
                  {targetPlanRows.map((row) => (
                    <article key={`target-row-${row.key}`} className={row.remaining <= 0 ? "achieved" : row.dailyAverage <= 0 ? "warning" : ""}>
                      <span>{row.label}</span>
                      <strong>{row.remaining <= 0 ? "達成済み" : row.days === null ? "ペース不足" : `約${row.days}日`}</strong>
                      <small>現在 {row.currentValue.toLocaleString("ja-JP")} / 目標 {row.targetValue.toLocaleString("ja-JP")}</small>
                      <em>残り {formatSignedNumber(row.remaining)} / 平均 {formatSignedNumber(row.dailyAverage)}/日</em>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          </aside>
        </div>
      </section>

      <section id="fleet-timer-section" className="fleet-grid">
        {fleets.map((fleet) => {
          const expedition = findExpedition(fleet.expeditionId);
          const running = fleet.endAt !== null && now < fleet.endAt;
          const completed = fleet.endAt !== null && now >= fleet.endAt;
          const remainingMs = fleet.endAt ? fleet.endAt - now : 0;
          const almostDone = running && remainingMs <= 5 * 60 * 1000;
          const remaining = fleet.endAt ? formatRemaining(remainingMs) : "--:--:--";
          const fleetModifier = getFleetRewardModifier(rewardSettings, fleet.fleetNo);
          const fleetBonusBreakdown = getRewardBonusBreakdown(rewardSettings, fleet.fleetNo);
          const rate = getAdjustedResourceRate(expedition, rewardSettings, fleet.fleetNo);
          const adjustedRewards = calculateAdjustedRewards(expedition, rewardSettings, undefined, fleet.fleetNo);

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
                <div className="fleet-reward-mini fleet-reward-mini-v36">
                  <div className="bonus-pill">
                    <span>大発系補正</span>
                    <strong>+{formatBonusPercent(fleetBonusBreakdown.totalBonus)}</strong>
                  </div>
                  <label className="mini-check">
                    <input
                      type="checkbox"
                      checked={fleetModifier.kinuKaiNiBonus}
                      onChange={(event) => updateFleetRewardModifier(fleet.fleetNo, { kinuKaiNiBonus: event.target.checked })}
                    />
                    鬼怒改二
                  </label>
                  <small>{getLandingCraftSummary(rewardSettings, fleet.fleetNo)}</small>
                </div>
                <details className="craft-editor fleet-craft-editor">
                  <summary>
                    <span>大発系装備・改修★を編集</span>
                    <em>{fleetBonusBreakdown.craftCount}/{MAX_LANDING_CRAFT_SLOTS}</em>
                  </summary>
                  <div className="craft-slot-list">
                    {(fleetModifier.landingCrafts ?? []).length === 0 ? (
                      <p className="empty-text">この艦隊の大発系装備は未設定。</p>
                    ) : (fleetModifier.landingCrafts ?? []).map((slot, index) => (
                      <div className="craft-slot-row" key={slot.id}>
                        <select value={slot.type} onChange={(event) => updateFleetLandingCraft(fleet.fleetNo, index, { type: event.target.value as LandingCraftTypeId })}>
                          {landingCraftDefinitions.map((definition) => (
                            <option value={definition.id} key={definition.id}>{definition.label}</option>
                          ))}
                        </select>
                        <label>
                          <span>★</span>
                          <input type="number" min={0} max={10} value={slot.stars} onChange={(event) => updateFleetLandingCraft(fleet.fleetNo, index, { stars: Number(event.target.value) })} />
                        </label>
                        <button type="button" className="ghost small" onClick={() => removeFleetLandingCraft(fleet.fleetNo, index)}>削除</button>
                      </div>
                    ))}
                    <button type="button" className="secondary" onClick={() => addFleetLandingCraft(fleet.fleetNo)} disabled={(fleetModifier.landingCrafts?.length ?? 0) >= MAX_LANDING_CRAFT_SLOTS}>装備を追加</button>
                  </div>
                </details>
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
                  <dt>補正込み報酬</dt>
                  <dd>{formatResources(adjustedRewards)}</dd>
                </div>
                <div>
                  <dt>補正込み時給</dt>
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

              <div className="manual-timer-row">
                <label>
                  <span>押し忘れ用：残り分</span>
                  <input
                    type="number"
                    min={1}
                    max={expedition.durationMinutes}
                    value={manualTimerInputs[fleet.fleetNo]}
                    onChange={(event) => setManualTimerInputs((current) => ({ ...current, [fleet.fleetNo]: event.target.value }))}
                    placeholder={`最大${expedition.durationMinutes}`}
                  />
                </label>
                <button type="button" className="secondary" onClick={() => startFleetWithManualRemaining(fleet)}>残り時間でセット</button>
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

              <button className="detail-link" onClick={() => jumpToExpeditionDetail(expedition.id)}>
                成功条件・大成功条件を見る
              </button>
            </article>
          );
        })}
      </section>

      <details
        id="detail-search-section"
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
            <div>燃料<strong>{selectedAdjustedRewards.fuel}</strong><small>{selectedAdjustedRate.fuel}/h</small></div>
            <div>弾薬<strong>{selectedAdjustedRewards.ammo}</strong><small>{selectedAdjustedRate.ammo}/h</small></div>
            <div>鋼材<strong>{selectedAdjustedRewards.steel}</strong><small>{selectedAdjustedRate.steel}/h</small></div>
            <div>ボーキ<strong>{selectedAdjustedRewards.bauxite}</strong><small>{selectedAdjustedRate.bauxite}/h</small></div>
          </div>

          <div className="success-compare">
            <div>
              <span>通常成功</span>
              <strong>{formatResources(selectedDetail.rewards)}</strong>
            </div>
            <div>
              <span>大成功のみ</span>
              <strong>{formatResources(selectedGreatRewards)}</strong>
              <small>大発補正なしの1.5倍目安</small>
            </div>
            <div>
              <span>現在の補正込み</span>
              <strong>{formatResources(selectedAdjustedRewards)}</strong>
              <small>{getRewardModifierLabel(rewardSettings)}</small>
            </div>
          </div>

          <dl className="detail-list">
            <div>
              <dt>海域</dt>
              <dd>{selectedDetail.area}</dd>
            </div>
            <div className="condition-card">
              <dt>成功条件</dt>
              <dd>
                <div className="condition-summary-grid">
                  <span><small>旗艦Lv</small><strong>{selectedDetail.requirements.flagshipLevel}</strong></span>
                  <span><small>隻数</small><strong>{selectedDetail.requirements.ships}</strong></span>
                  <span><small>ステータス/その他</small><strong>{selectedDetail.requirements.stats}</strong></span>
                </div>
              </dd>
            </div>
            <div className="composition-card">
              <dt>編成条件・編成例</dt>
              <dd>
                <div className="composition-pattern-list">
                  {selectedFormationPatterns.map((pattern) => (
                    <article className="composition-pattern" key={pattern.label}>
                      <strong>{pattern.label}</strong>
                      <p>{pattern.requirement}</p>
                      <small>編成例：{pattern.example}</small>
                      {pattern.note && <em>{pattern.note}</em>}
                    </article>
                  ))}
                </div>
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
              const rate = getAdjustedResourceRate(expedition, rewardSettings);
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
        <button type="button" className={mobileTab === "timers" ? "active" : ""} onClick={() => switchAppTab("timers")}>タイマー</button>
        <button type="button" className={mobileTab === "search" ? "active" : ""} onClick={() => switchAppTab("search", "detail-search-section")}>遠征</button>
        <button type="button" className={mobileTab === "assist" ? "active" : ""} onClick={() => switchAppTab("assist", "preset-section")}>攻略</button>
        <button type="button" className={mobileTab === "records" ? "active" : ""} onClick={() => switchAppTab("records", "records-section")}>記録</button>
        <button type="button" className={mobileTab === "account" ? "active" : ""} onClick={() => switchAppTab("account", "account-cloud-section")}>設定</button>
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
