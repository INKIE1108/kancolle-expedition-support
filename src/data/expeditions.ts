import type { Expedition } from "../types";
import fallbackExpeditions from "./expeditions-fallback.json";

// v1.2以降、遠征データ本体はJSONで管理する。
// - public/data/expeditions.json: Web公開後でも差し替えやすい実データ
// - src/data/expeditions-fallback.json: 外部JSON読込に失敗した時の内蔵フォールバック
export const expeditions = fallbackExpeditions as Expedition[];
