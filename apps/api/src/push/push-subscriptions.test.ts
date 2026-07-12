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
  const rowKey = (workspaceId: string, endpoint: string) => `${workspaceId}::${endpoint}`;
  const store: PushSubscriptionStore = {
    async upsert(workspaceId: string, userId: string, subscription: PushSubscriptionInput) {
      rows.set(rowKey(workspaceId, subscription.endpoint), {
        workspaceId,
        userId,
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        createdAt: new Date(),
      });
    },
    async removeForUser(workspaceId, userId, endpoint) {
      const key = rowKey(workspaceId, endpoint);
      const row = rows.get(key);
      if (!row || row.userId !== userId) return false;
      return rows.delete(key);
    },
    async listForWorkspace(workspaceId) {
      return [...rows.values()].filter((row) => row.workspaceId === workspaceId);
    },
    async removeByEndpoint(workspaceId, endpoint) {
      return rows.delete(rowKey(workspaceId, endpoint));
    },
  };
  return { rows, rowKey, store };
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
  const { rows, rowKey, store } = createMemoryStore();
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
  assert.equal(rows.get(rowKey(session.workspace.id, endpoint))?.workspaceId, session.workspace.id);
  assert.equal(rows.get(rowKey(session.workspace.id, endpoint))?.userId, session.user.id);
  assert.deepEqual(rows.get(rowKey(session.workspace.id, endpoint))?.keys, {
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
  assert.equal(pushServiceChecks, 2);
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

test("unsubscribe clears the authenticated row without requiring VAPID configuration", async () => {
  const { rows, store } = createMemoryStore();
  const endpoint = "https://push.example.invalid/subscription/revoke-without-vapid";
  await store.upsert(session.workspace.id, session.user.id, {
    endpoint,
    expirationTime: null,
    keys: { p256dh: "browser-public-key", auth: "browser-auth-secret" },
  });
  const app = createAuthenticatedApp(store, () => {
    throw new Error("unsubscribe must not read VAPID configuration");
  });

  const response = await app.request("/api/v1/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { unsubscribed: true, removed: true } });
  assert.equal(rows.size, 0);
});

test("push routes reject requests without an authenticated session", async () => {
  const { store } = createMemoryStore();
  const app = createPushSubscriptionRoutes({ store, getPushService: configuredPushService });
  const response = await app.request("/api/v1/push/vapid-public-key");
  assert.equal(response.status, 401);
});

test("migration 0052 forward/down and Drizzle schema keep workspace and DESC index alignment", () => {
  const forward = readFileSync(new URL("../../../../packages/db/migrations/0052_push_subscriptions_workspace.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../../../../packages/db/migrations/0052_push_subscriptions_workspace.down.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../../../packages/db/src/schema.ts", import.meta.url), "utf8");

  assert.match(forward, /ADD COLUMN IF NOT EXISTS workspace_id UUID/);
  assert.match(forward, /FOREIGN KEY \(workspace_id\) REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(forward, /ALTER COLUMN workspace_id SET NOT NULL/);
  assert.match(forward, /CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_workspace_endpoint_uidx\s+ON push_subscriptions\(workspace_id, endpoint\)/);
  assert.match(forward, /push_subscriptions\(workspace_id, user_id, created_at DESC\)/);
  assert.match(down, /DROP COLUMN IF EXISTS workspace_id/);
  assert.match(down, /CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uidx/);
  assert.match(schema, /uniqueIndex\("push_subscriptions_workspace_endpoint_uidx"\)\.on\(\s*table\.workspaceId,\s*table\.endpoint/);
  assert.match(schema, /index\("push_subscriptions_workspace_user_created_idx"\)\.on\(\s*table\.workspaceId,\s*table\.userId,\s*table\.createdAt\.desc\(\)/);
});

test("migration 0052 backfill is idempotent and preserves the owning user workspace", () => {
  const forward = readFileSync(new URL("../../../../packages/db/migrations/0052_push_subscriptions_workspace.sql", import.meta.url), "utf8");

  assert.match(forward, /SET workspace_id = COALESCE\(\s*u\.workspace_id,/);
  assert.match(forward, /WHERE ps\.user_id = u\.id\s+AND ps\.workspace_id IS NULL/);
  assert.match(forward, /ORDER BY w\.created_at ASC, w\.id ASC\s+LIMIT 1/);
  assert.match(forward, /IF NOT EXISTS \(\s*SELECT 1\s*FROM pg_constraint/);
  assert.match(forward, /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g);
});
