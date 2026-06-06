import type { Expedition, FleetTimer } from "../types";
import { formatDateTime } from "./time";

export async function requestPcNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    alert("このブラウザはPC通知に対応していません。Discord通知を使ってください。越えられない壁、ある。 ");
    return "denied";
  }

  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

export function sendPcNotification(fleet: FleetTimer, expedition: Expedition): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  new Notification(`第${fleet.fleetNo}艦隊 遠征完了`, {
    body: `${expedition.name} が完了予定時刻を過ぎました。補給と再出発は手動で確認！`,
    tag: `kancolle-expedition-fleet-${fleet.fleetNo}`,
    icon: "/icon.svg"
  });
}

export async function sendDiscordNotification(
  webhookUrl: string,
  fleet: FleetTimer,
  expedition: Expedition,
  mode: "direct" | "server" = "direct"
): Promise<void> {
  const content = [
    `⏰ **第${fleet.fleetNo}艦隊 遠征完了**`,
    `遠征：${expedition.name}`,
    `終了予定：${formatDateTime(fleet.endAt)}`,
    `補給・再出発は手動で確認してね。`
  ].join("\n");

  if (mode === "server") {
    const response = await fetch("/api/discord-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, fleetNo: fleet.fleetNo, expeditionId: expedition.id })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Discord安全通知に失敗しました: ${response.status}${text ? ` ${text}` : ""}`);
    }
    return;
  }

  if (!webhookUrl.trim()) return;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    throw new Error(`Discord通知に失敗しました: ${response.status}`);
  }
}
