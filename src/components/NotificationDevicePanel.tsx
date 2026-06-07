import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DeviceStatus,
  formatDateTimeJa,
  loadDeviceStatus,
  markCurrentDeviceTested,
  registerCurrentDevice,
  unregisterCurrentDevice
} from "../utils/deviceNotifications";

type Props = {
  supabase: SupabaseClient | null;
  userId: string | null;
  vapidPublicKey: string;
  onSendTestNotification?: () => Promise<void | boolean>;
  onStatusChange?: (status: DeviceStatus | null) => void;
};

export function NotificationDevicePanel({
  supabase,
  userId,
  vapidPublicKey,
  onSendTestNotification,
  onStatusChange
}: Props) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!supabase || !userId) {
      setStatus(null);
      onStatusChange?.(null);
      return;
    }

    const next = await loadDeviceStatus(supabase, userId);
    setStatus(next);
    onStatusChange?.(next);
  }

  useEffect(() => {
    refresh().catch((error) => {
      setMessage(error instanceof Error ? error.message : "通知端末情報の読み込みに失敗しました。");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId]);

  async function handleRegister() {
    if (!supabase || !userId) {
      setMessage("先に提督アカウントへログインしてね。");
      return;
    }

    if (!vapidPublicKey) {
      setMessage("VITE_VAPID_PUBLIC_KEY が未設定です。");
      return;
    }

    try {
      setBusy(true);
      await registerCurrentDevice(supabase, userId, vapidPublicKey);
      await refresh();
      setMessage("この端末を通知先として登録したよ。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通知登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!supabase || !userId) {
      setMessage("先に提督アカウントへログインしてね。");
      return;
    }

    try {
      setBusy(true);
      if (onSendTestNotification) {
        await onSendTestNotification();
      }
      await markCurrentDeviceTested(supabase, userId);
      await refresh();
      setMessage("テスト通知を送ったよ。届いていればOK！");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "テスト通知に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnregister() {
    if (!supabase || !userId) {
      setMessage("先に提督アカウントへログインしてね。");
      return;
    }

    const ok = window.confirm("この端末の通知登録を解除する？");
    if (!ok) return;

    try {
      setBusy(true);
      await unregisterCurrentDevice(supabase, userId);
      await refresh();
      setMessage("この端末の通知登録を解除したよ。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通知登録の解除に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  const currentRegistered = Boolean(status?.currentDevice);
  const permissionLabel =
    status?.permission === "granted" ? "許可済み" :
    status?.permission === "denied" ? "拒否中" :
    status?.permission === "default" ? "未選択" :
    "非対応";

  return (
    <div className="device-panel">
      <div className="mini-heading">DEVICE NOTIFICATION</div>
      <h3>通知端末</h3>

      <div className="device-summary-grid">
        <div className="device-summary-card">
          <span>この端末</span>
          <strong>{currentRegistered ? "通知登録済み" : "未登録"}</strong>
        </div>

        <div className="device-summary-card">
          <span>通知許可</span>
          <strong>{permissionLabel}</strong>
        </div>

        <div className="device-summary-card">
          <span>登録端末数</span>
          <strong>{status ? `${status.registeredCount}台` : "未取得"}</strong>
        </div>

        <div className="device-summary-card">
          <span>最終登録</span>
          <strong>{formatDateTimeJa(status?.latestRegisteredAt)}</strong>
        </div>
      </div>

      <div className="device-action-row">
        <button type="button" onClick={handleRegister} disabled={busy}>
          {currentRegistered ? "この端末を再登録" : "この端末を通知登録"}
        </button>

        <button type="button" onClick={handleTest} disabled={busy || !currentRegistered}>
          テスト通知
        </button>

        <button type="button" onClick={handleUnregister} disabled={busy || !currentRegistered}>
          この端末の通知登録を解除
        </button>
      </div>

      {status?.devices.length ? (
        <div className="device-list">
          <div className="device-list-title">登録済み端末</div>
          {status.devices.map((device) => {
            const isCurrent = status.currentEndpoint === device.endpoint;
            return (
              <div className="device-row" key={device.id}>
                <div>
                  <strong>
                    {device.device_label || "名前未設定の端末"}
                    {isCurrent ? " / この端末" : ""}
                  </strong>
                  <p>
                    {device.os_name || "Unknown OS"} / {device.browser_name || "Unknown Browser"}
                  </p>
                </div>
                <div className="device-row-meta">
                  <span>最終登録：{formatDateTimeJa(device.updated_at || device.created_at)}</span>
                  <span>最終テスト：{formatDateTimeJa(device.last_tested_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted-text">まだ通知登録された端末はないよ。</p>
      )}

      {message ? <div className="status-message">{message}</div> : null}
    </div>
  );
}
