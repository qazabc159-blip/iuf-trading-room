"use client";

import { useEffect, useState } from "react";

const SW_VERSION_STORAGE_KEY = "iuf-sw-version";

type SwUpdateMessage = {
  type: "IUF_SW_UPDATED";
  version: string;
};

function isSwUpdateMessage(value: unknown): value is SwUpdateMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SwUpdateMessage>;
  return candidate.type === "IUF_SW_UPDATED" && typeof candidate.version === "string";
}

export function PwaServiceWorkerRegistration() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let disposed = false;
    let hadController = navigator.serviceWorker.controller !== null;

    const handleControllerChange = () => {
      if (!disposed && hadController) setUpdateReady(true);
      hadController = true;
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isSwUpdateMessage(event.data)) return;

      const previousVersion = window.localStorage.getItem(SW_VERSION_STORAGE_KEY);
      window.localStorage.setItem(SW_VERSION_STORAGE_KEY, event.data.version);
      if (!disposed && hadController && previousVersion && previousVersion !== event.data.version) {
        setUpdateReady(true);
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    navigator.serviceWorker.addEventListener("message", handleMessage);

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // Registration failure must not break the trading UI. The app remains
        // online-only and the browser will retry on the next page load.
      });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  if (!updateReady) return null;

  return (
    <aside className="pwa-update-prompt" role="status" aria-live="polite">
      <span>戰情室已更新，重新載入即可使用新版。</span>
      <button type="button" onClick={() => window.location.reload()}>
        重新載入
      </button>
    </aside>
  );
}
