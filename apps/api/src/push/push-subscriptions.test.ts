import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AppSession } from "@iuf-trading-room/contracts";
import { Hono } from "hono";

import {
  createPushSubscriptionRoutes,
  type PushSubscriptionInput,
  type PushSubscriptionStore,
  type StoredPushSubscription,
} from "./push-subscriptions.js";
import { getConfiguredWebPushService, type WebPushServiceState } from "./web-push-client.js";

const session: AppSession = {
  workspace: { id: "00000000-0000-4000-8000-000000000001", name: "測試工作區", slug: "test" },
  user: {
    id: "00000000-0000-4000-8000-000000000002",
    name: "測試使用者",
    email: "push-test@example.invalid",
    role: "Viewer",
  },
  persistenceMode: "database",
};

function createMemoryStore() {
  const rows = new Map<string, StoredPushSubscription>();
  const store: PushSubscriptionStore = {
    async upsert(userId: string, subscription: PushSubscriptionInput) {
      rows.set(subscription.endpoint, {
        userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        createdAt: new Date(),
      });
    },
    async removeForUser(userId, endpoint) {
      const row = rows.get(endpoint);
      if (!row || row.userId !== userId) return false;
      return rows.delete(endpoint);
    },
    async listAll() { return [...rows.values()]; },
    async removeByEndpoint(endpoint) { return rows.delete(endpoint); },
  };
  return { rows, store };
}

function configuredPushService(): WebPushServiceState {
  return {
    ok: true,
    service: {
      publicKey: "test-public-key",
      async sendNotification() { return { statusCode: 201, body: "", headers: {} }; },
    },
  };
}

function createAuthenticatedApp(store: PushSubscriptionStore, getPushService = configuredPushService) {
  const app = new Hono<{ Variables: { session: AppSession } }>();
  app.use("*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/", createPushSubscriptionRoutes({ store, getPushService }));
  return app;
}

test("push subscription chain stores the authenticated row then removes it", async () => {
  const { rows, store } = createMemoryStore();
  let pushServiceChecks = 0;
  const app = createAuthenticatedApp(store, () => {
    pushServiceChecks += 1;
    return configuredPushService();
  });
  const endpoint = "https://push.example.invalid/subscription/one";

  const keyResponse = await app.request("/api/v1/push/vapid-public-key");
  assert.equal(keyResponse.status, 200);
  assert.deepEqual(await keyResponse.json(), { data: { publicKey: "test-public-key" } });

  const subscribeResponse = await app.request("/api/v1/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint,
      expirationTime: null,
      keys: { p256dh: "browser-public-key", auth: "browser-auth-secret" },
    }),
  });
  assert.equal(subscribeResponse.status, 201);
  assert.equal(rows.get(endpoint)?.userId, session.user.id);
  assert.deepEqual(rows.get(endpoint)?.keys, {
    p256dh: "browser-public-key",
    auth: "browser-auth-secret",
  });

  const unsubscribeResponse = await app.request("/api/v1/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  assert.equal(unsubscribeResponse.status, 200);
  assert.deepEqual(await unsubscribeResponse.json(), { data: { unsubscribed: true, removed: true } });
  assert.equal(rows.size, 0);
  assert.equal(pushServiceChecks, 3);
});

test("missing VAPID environment returns an honest Chinese 503 without touching storage", async () => {
  const { rows, store } = createMemoryStore();
  const app = createAuthenticatedApp(store, () => getConfiguredWebPushService({}));
  const response = await app.request("/api/v1/push/vapid-public-key");
  assert.equal(response.status, 503);
  const body = await response.json() as { message: string; missing: string[] };
  assert.match(body.message, /推播服務尚未完成設定/);
  assert.deepEqual(body.missing, ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
  assert.equal(rows.size, 0);
});

test("push routes reject requests without an authenticated session", async () => {
  const { store } = createMemoryStore();
  const app = createPushSubscriptionRoutes({ store, getPushService: configuredPushService });
  const response = await app.request("/api/v1/push/vapid-public-key");
  assert.equal(response.status, 401);
});

test("migration 0051 forward/down and Drizzle schema keep DESC index alignment", () => {
  const forward = readFileSync(new URL("../../../../packages/db/migrations/0051_push_subscriptions.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../../../../packages/db/migrations/0051_push_subscriptions.down.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../../../packages/db/src/schema.ts", import.meta.url), "utf8");

  assert.match(forward, /CREATE TABLE IF NOT EXISTS push_subscriptions/);
  assert.match(forward, /user_id\s+UUID\s+NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(forward, /CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uidx/);
  assert.match(forward, /push_subscriptions\(user_id, created_at DESC\)/);
  assert.match(down, /DROP TABLE IF EXISTS push_subscriptions/);
  assert.match(schema, /index\("push_subscriptions_user_created_idx"\)\.on\(table\.userId, table\.createdAt\.desc\(\)\)/);
});
