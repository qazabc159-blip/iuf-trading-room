import { readFileSync } from "node:fs";
import vm from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

type ExtendableEvent = {
  waitUntil(promise: Promise<unknown>): void;
  completion?: Promise<unknown>;
};

type MockFetchEvent = {
  request: Request | { method: string; mode: string; url: string };
  respondWith(promise: Promise<Response>): void;
  response?: Promise<Response>;
};

type ServiceWorkerListener = (event: any) => void;

const source = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");

function createHarness() {
  const listeners = new Map<string, ServiceWorkerListener>();
  const cache = {
    match: vi.fn<(request: Request) => Promise<Response | undefined>>(async () => undefined),
    put: vi.fn<(request: RequestInfo, response: Response) => Promise<void>>(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined as Response | undefined),
    keys: vi.fn(async () => [] as string[]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn<(input: Request, init?: RequestInit) => Promise<Response>>(
    async () => new Response("network"),
  );
  const self = {
    location: { origin: "https://app.example.test" },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => [] as Array<{
        url: string;
        navigate(url: string): Promise<unknown>;
        focus(): Promise<unknown>;
        postMessage?(message: unknown): void;
      }>),
      openWindow: vi.fn(async () => undefined as unknown),
    },
    registration: {
      showNotification: vi.fn(async () => undefined),
    },
    addEventListener: vi.fn((type: string, listener: ServiceWorkerListener) => {
      listeners.set(type, listener);
    }),
  };

  vm.runInNewContext(source, { self, caches, fetch, Request, Response, URL, Promise });

  return { listeners, cache, caches, fetch, self };
}

function dispatchExtendable(listener: ServiceWorkerListener) {
  const event: ExtendableEvent = {
    waitUntil(promise) {
      event.completion = promise;
    },
  };
  listener(event as ExtendableEvent & MockFetchEvent);
  return event.completion;
}

function dispatchFetch(listener: ServiceWorkerListener, request: MockFetchEvent["request"]) {
  const event: MockFetchEvent = {
    request,
    respondWith(promise) {
      event.response = promise;
    },
  };
  listener(event as ExtendableEvent & MockFetchEvent);
  return event.response;
}

function dispatchPush(listener: ServiceWorkerListener, payload: unknown) {
  const event: ExtendableEvent & { data: { json(): unknown } } = {
    data: { json: () => payload },
    waitUntil(promise) {
      event.completion = promise;
    },
  };
  listener(event);
  return event.completion;
}

function dispatchNotificationClick(
  listener: ServiceWorkerListener,
  notification: { data: { url?: string }; close(): void },
) {
  const event: ExtendableEvent & { notification: typeof notification } = {
    notification,
    waitUntil(promise) {
      event.completion = promise;
    },
  };
  listener(event);
  return event.completion;
}

describe("PWA service worker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("stores a synthetic honest offline page and activates immediately", async () => {
    const harness = createHarness();
    const completion = dispatchExtendable(harness.listeners.get("install")!);

    await completion;

    expect(harness.cache.put).toHaveBeenCalledOnce();
    expect(harness.cache.put.mock.calls[0]?.[0]).toBe(
      "https://app.example.test/__iuf_offline_fallback__",
    );
    const fallback = harness.cache.put.mock.calls[0]?.[1];
    expect(fallback?.status).toBe(503);
    expect(await fallback?.text()).toContain("目前離線，行情與帳務資料無法載入");
    expect(harness.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it("keeps every /api/** request network-only and propagates offline failure", async () => {
    const harness = createHarness();
    harness.fetch.mockRejectedValueOnce(new TypeError("offline"));
    harness.cache.match.mockResolvedValueOnce(new Response("stale market data"));
    const request = new Request("https://api.example.test/api/v1/quotes");

    const response = dispatchFetch(harness.listeners.get("fetch")!, request);

    await expect(response).rejects.toThrow("offline");
    expect(harness.fetch).toHaveBeenCalledWith(request, { cache: "no-store" });
    expect(harness.caches.open).not.toHaveBeenCalled();
    expect(harness.cache.match).not.toHaveBeenCalled();
  });

  it("serves cache-first static assets without contacting the network", async () => {
    const harness = createHarness();
    harness.cache.match.mockResolvedValueOnce(new Response("cached asset"));
    const request = new Request("https://app.example.test/_next/static/chunks/app.js");

    const response = await dispatchFetch(harness.listeners.get("fetch")!, request);

    expect(await response?.text()).toBe("cached asset");
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it("returns the number-free offline page when a navigation cannot reach the network", async () => {
    const harness = createHarness();
    harness.fetch.mockRejectedValueOnce(new TypeError("offline"));
    const offline = new Response("目前離線，行情與帳務資料無法載入");
    harness.caches.match.mockResolvedValueOnce(offline);

    const response = await dispatchFetch(harness.listeners.get("fetch")!, {
      method: "GET",
      mode: "navigate",
      url: "https://app.example.test/m",
    });

    expect(await response?.text()).toContain("目前離線，行情與帳務資料無法載入");
    expect(harness.caches.match).toHaveBeenCalledWith(
      "https://app.example.test/__iuf_offline_fallback__",
    );
  });

  it("shows the Chinese push payload with its safe deep link", async () => {
    const harness = createHarness();

    await dispatchPush(harness.listeners.get("push")!, {
      title: "重大公告提醒",
      body: "公司發布新的重大公告，請查看最新內容。",
      url: "/companies/2330",
    });

    expect(harness.self.registration.showNotification).toHaveBeenCalledWith(
      "重大公告提醒",
      expect.objectContaining({
        body: "公司發布新的重大公告，請查看最新內容。",
        data: { url: "/companies/2330" },
      }),
    );
  });

  it("focuses an existing app window and navigates it to the notification deep link", async () => {
    const harness = createHarness();
    const client = {
      url: "https://app.example.test/m",
      navigate: vi.fn(async () => undefined),
      focus: vi.fn(async () => undefined),
    };
    harness.self.clients.matchAll.mockResolvedValueOnce([client]);
    const notification = { data: { url: "/briefs" }, close: vi.fn() };

    await dispatchNotificationClick(harness.listeners.get("notificationclick")!, notification);

    expect(notification.close).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith("https://app.example.test/briefs");
    expect(client.focus).toHaveBeenCalledOnce();
    expect(harness.self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("rejects protocol-relative notification links and opens the safe alerts page", async () => {
    const harness = createHarness();
    const notification = { data: { url: "//attacker.example.test" }, close: vi.fn() };

    await dispatchNotificationClick(harness.listeners.get("notificationclick")!, notification);

    expect(harness.self.clients.openWindow).toHaveBeenCalledWith(
      "https://app.example.test/alerts",
    );
  });
});
