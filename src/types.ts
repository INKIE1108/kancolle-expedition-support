export type ResourceRewards = {
  fuel: number;
  ammo: number;
  steel: number;
  bauxite: number;
};

export type GreatSuccessType = "normalKira" | "drum" | "special" | "unknown";

export type ExpeditionPrerequisite = {
  label: string;
  expeditionId?: string;
  note?: string;
};

export type Expedition = {
  id: string;
  area: string;
  name: string;
  durationMinutes: number;
  rewards: ResourceRewards;
  itemReward: string;
  requirements: {
    flagshipLevel: string;
    ships: string;
    formation: string;
    stats: string;
  };
  greatSuccess: {
    type: GreatSuccessType;
    note: string;
  };
  purposeTags: string[];
  memo: string;
  sourceNote: string;
  prerequisites?: ExpeditionPrerequisite[];
};

export type FleetTimer = {
  fleetNo: 2 | 3 | 4;
  expeditionId: string;
  startAt: number | null;
  endAt: number | null;
  notifiedAt: number | null;
  pcNotify: boolean;
  discordNotify: boolean;
  recordedAt?: number | null;
};

export type AppSettings = {
  /** ユーザー個別のDiscord Webhook URL。v2.1ではクラウド保存対象。 */
  discordWebhookUrl: string;
  /** 旧バージョン互換用。v2.1のUIでは個人URLモード固定。 */
  discordNotifyMode?: "direct" | "server";
  /** 旧バージョン互換用。v2.1のUIではサーバー側通知予約固定。 */
  serverNotificationMode?: "off" | "supabase";
};
