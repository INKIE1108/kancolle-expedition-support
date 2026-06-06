export type ResourceRewards = {
  fuel: number;
  ammo: number;
  steel: number;
  bauxite: number;
};

export type GreatSuccessType = "normalKira" | "drum" | "special" | "unknown";

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
  discordWebhookUrl: string;
};
