"use client";

import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import { resolvePushCapability, urlBase64ToUint8Array } from "@/lib/push-client";

import styles from "./PushNotificationSettings.module.css";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
type ViewState = "checking" | "needs-install" | "unsupported" | "permission-denied" | "disabled" | "enabled" | "error";
type VapidResponse = { data?: { publicKey?: string }; message?: string };

function isStandalonePwa() {
  const displayModeStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayModeStandalone || iosStandalone;
}

async function pushApi(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
}

export function PushNotificationSettings() {
  const [viewState, setViewState] = useState<ViewState>("checking");
  const [message, setMessage] = useState("正在檢查此裝置的推播能力…");
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    async function load() {
      const capability = resolvePushCapability({
        standalone: isStandalonePwa(),
        serviceWorkerSupported: "serviceWorker" in navigator,
        pushManagerSupported: "PushManager" in window,
        notificationsSupported: "Notification" in window,
      });
      if (capability === "needs-install") {
        if (!disposed) { setViewState("needs-install"); setMessage("請先加入主畫面，再從主畫面開啟戰情室以啟用推播。"); }
        return;
      }
      if (capability === "unsupported") {
        if (!disposed) { setViewState("unsupported"); setMessage("此裝置或瀏覽器尚未支援推播通知。"); }
        return;
      }
      if (Notification.permission === "denied") {
        if (!disposed) { setViewState("permission-denied"); setMessage("通知權限已被關閉，請到系統設定中允許戰情室通知。"); }
        return;
      }
      try {
        const [registration, keyResponse] = await Promise.all([
          navigator.serviceWorker.ready,
          pushApi("/api/v1/push/vapid-public-key"),
        ]);
        const keyBody = await keyResponse.json() as VapidResponse;
        if (!keyResponse.ok || !keyBody.data?.publicKey) throw new Error(keyBody.message || "推播服務目前無法使用，請稍後再試。");
        const existing = await registration.pushManager.getSubscription();
        if (!disposed) {
          setPublicKey(keyBody.data.publicKey);
          setViewState(existing ? "enabled" : "disabled");
          setMessage(existing ? "此裝置已啟用交易警示推播。" : "此裝置尚未啟用交易警示推播。");
        }
      } catch (error) {
        if (!disposed) { setViewState("error"); setMessage(error instanceof Error ? error.message : "推播服務目前無法使用，請稍後再試。"); }
      }
    }
    void load();
    return () => { disposed = true; };
  }, []);

  async function enablePush() {
    if (!publicKey || busy) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setViewState("permission-denied");
        setMessage("尚未取得通知權限；可到系統設定中重新允許。");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const response = await pushApi("/api/v1/push/subscribe", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
      const body = await response.json() as { message?: string };
      if (!response.ok) {
        if (!existing) await subscription.unsubscribe().catch(() => false);
        throw new Error(body.message || "無法完成推播訂閱，請稍後再試。");
      }
      setViewState("enabled");
      setMessage("此裝置已啟用交易警示推播。");
    } catch (error) {
      setViewState("error");
      setMessage(error instanceof Error ? error.message : "無法完成推播訂閱，請稍後再試。");
    } finally { setBusy(false); }
  }

  async function disablePush() {
    if (busy) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await pushApi("/api/v1/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
        const body = await response.json() as { message?: string };
        if (!response.ok) throw new Error(body.message || "無法關閉推播，請稍後再試。");
        await subscription.unsubscribe();
      }
      setViewState("disabled");
      setMessage("此裝置尚未啟用交易警示推播。");
    } catch (error) {
      setViewState("error");
      setMessage(error instanceof Error ? error.message : "無法關閉推播，請稍後再試。");
    } finally { setBusy(false); }
  }

  const enabled = viewState === "enabled";
  const actionable = viewState === "enabled" || viewState === "disabled" || viewState === "error";
  const stateLabel = enabled ? "已啟用" : viewState === "checking" ? "檢查中" : "未啟用";

  return (
    <section className={styles.panel} aria-labelledby="push-settings-title">
      <div className={styles.header}>
        <div className={styles.identity}>
          <BellRing className={styles.icon} size={21} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <div className={styles.eyebrow}>PUSH NOTIFICATIONS</div>
            <h2 className={styles.title} id="push-settings-title">交易警示推播</h2>
            <p className={styles.copy}>只在此裝置接收重要警示；離線或無法取得最新資料時，不會用舊行情取代。</p>
          </div>
        </div>
        <span className={styles.state}>{stateLabel}</span>
      </div>
      <div className={styles.controls}>
        <button
          className={`${styles.button} ${enabled ? styles.buttonEnabled : ""}`}
          type="button"
          disabled={busy || !actionable || (viewState === "error" && !publicKey)}
          onClick={enabled ? disablePush : enablePush}
        >
          {busy ? "處理中…" : enabled ? "關閉此裝置推播" : viewState === "needs-install" ? "請先加入主畫面" : "啟用此裝置推播"}
        </button>
        <p className={`${styles.message} ${viewState === "error" ? styles.error : ""}`} role="status" aria-live="polite">{message}</p>
      </div>
    </section>
  );
}
