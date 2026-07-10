/* IUF Trading Room service worker.
 *
 * Financial-data invariant: every /api/** request is network-only. Never add
 * an API response to Cache Storage and never provide a stale fallback.
 */

const SW_VERSION = "iuf-pwa-v2";
const STATIC_CACHE = `${SW_VERSION}-static`;
const OFFLINE_FALLBACK_URL = new URL("/__iuf_offline_fallback__", self.location.origin).href;
const CACHE_PREFIX = "iuf-pwa-";
const OFFLINE_DOCUMENT = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#080b10">
  <title>目前離線｜IUF 戰情室</title>
  <style>
    :root{color-scheme:dark;--surface:#080b10;--panel:#0c1118;--line:rgba(220,228,240,.19);--text:#e7ecf3;--muted:#91a0b5;--accent:#e2b85c}
    *{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));background:var(--surface);color:var(--text);font-family:system-ui,-apple-system,"Noto Sans TC",sans-serif}
    main{width:min(100%,520px);border:1px solid var(--line);border-top-color:var(--accent);background:var(--panel);padding:clamp(24px,7vw,40px)}
    .eyebrow{margin:0 0 12px;color:var(--accent);font:600 13px/1.5 ui-monospace,"SFMono-Regular",monospace;letter-spacing:.12em}h1{margin:0;font-size:clamp(24px,7vw,34px);line-height:1.3}p{margin:16px 0 0;color:var(--muted);font-size:16px;line-height:1.75}
    button{width:100%;min-height:48px;margin-top:28px;border:1px solid var(--accent);background:transparent;color:var(--accent);font:inherit;font-weight:700;cursor:pointer;touch-action:manipulation}button:active{background:rgba(226,184,92,.1)}button:focus-visible{outline:3px solid var(--text);outline-offset:3px}
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">CONNECTION OFFLINE</p>
    <h1>目前離線</h1>
    <p>目前離線，行情與帳務資料無法載入。恢復網路後再重新載入，本頁不會顯示任何先前快取的數字。</p>
    <button type="button" onclick="location.reload()">重新載入</button>
  </main>
</body>
</html>`;

function createOfflineResponse() {
  return new Response(OFFLINE_DOCUMENT, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.put(OFFLINE_FALLBACK_URL, createOfflineResponse()))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
      self.clients.claim(),
    ]).then(async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "IUF_SW_UPDATED", version: SW_VERSION });
      }
    }),
  );
});

function isApiRequest(url) {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function isCacheFirstStatic(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/icon.png" ||
      url.pathname === "/apple-icon.png" ||
      url.pathname === "/favicon.ico")
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match(OFFLINE_FALLBACK_URL);
    if (fallback) return fallback;
    return createOfflineResponse();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Non-negotiable: market/account API data always comes from the network.
  // Rejections deliberately propagate so offline callers fail fast.
  if (isApiRequest(url)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigateOrOffline(request));
    return;
  }

  if (isCacheFirstStatic(url)) {
    event.respondWith(cacheFirst(request));
  }
});

function safeNotificationData(data) {
  const fallback = {
    title: "交易提醒",
    body: "戰情室有新的提醒，請開啟應用程式查看。",
    url: "/alerts",
  };
  if (!data || typeof data !== "object") return fallback;

  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title : fallback.title,
    body: typeof data.body === "string" && data.body.trim() ? data.body : fallback.body,
    url: isSafeAppPath(data.url) ? data.url : fallback.url,
  };
}

function isSafeAppPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

self.addEventListener("push", (event) => {
  let incoming;
  try {
    incoming = event.data?.json();
  } catch {
    incoming = null;
  }
  const notification = safeNotificationData(incoming);
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: "/icons/icon-192.png",
      badge: "/icon.png",
      data: { url: notification.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  const safePath = isSafeAppPath(path) ? path : "/alerts";
  const targetUrl = new URL(safePath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      const existingClient = windowClients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existingClient) {
        await existingClient.navigate(targetUrl);
        return existingClient.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
