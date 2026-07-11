import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppSession } from "@iuf-trading-room/contracts";
import { getDb, pushSubscriptions, type PushSubscriptionKeys } from "@iuf-trading-room/db";

import { getConfiguredWebPushService, type WebPushServiceState } from "./web-push-client.js";

type PushVariables = { session: AppSession };
type PushEnvironment = { Variables: PushVariables };

export type StoredPushSubscription = {
  userId: string;
  endpoint: string;
  keys: PushSubscriptionKeys;
  createdAt: Date;
};

export type PushSubscriptionInput = {
  endpoint: string;
  expirationTime?: number | null;
  keys: PushSubscriptionKeys;
};

export interface PushSubscriptionStore {
  upsert(userId: string, subscription: PushSubscriptionInput): Promise<void>;
  removeForUser(userId: string, endpoint: string): Promise<boolean>;
  listAll(): Promise<StoredPushSubscription[]>;
  removeByEndpoint(endpoint: string): Promise<boolean>;
}

export class PushSubscriptionStorageUnavailableError extends Error {
  constructor() {
    super("push subscriptions require database persistence");
    this.name = "PushSubscriptionStorageUnavailableError";
  }
}

function requireDb() {
  const db = getDb();
  if (!db) throw new PushSubscriptionStorageUnavailableError();
  return db;
}

export const databasePushSubscriptionStore: PushSubscriptionStore = {
  async upsert(userId, subscription) {
    const db = requireDb();
    await db
      .insert(pushSubscriptions)
      .values({ userId, endpoint: subscription.endpoint, keys: subscription.keys })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, keys: subscription.keys },
      });
  },

  async removeForUser(userId, endpoint) {
    const db = requireDb();
    const removed = await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
      .returning({ id: pushSubscriptions.id });
    return removed.length > 0;
  },

  async listAll() {
    const db = requireDb();
    return db
      .select({
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        keys: pushSubscriptions.keys,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions);
  },

  async removeByEndpoint(endpoint) {
    const db = requireDb();
    const removed = await db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .returning({ id: pushSubscriptions.id });
    return removed.length > 0;
  },
};

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(4096),
    auth: z.string().min(1).max(4096),
  }),
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(4096) });

type PushRouteDependencies = {
  store: PushSubscriptionStore;
  getPushService: () => WebPushServiceState;
};

const defaultDependencies: PushRouteDependencies = {
  store: databasePushSubscriptionStore,
  getPushService: () => getConfiguredWebPushService(),
};

function getSessionUserId(c: Context<PushEnvironment>): string | null {
  return c.get("session")?.user.id ?? null;
}

function unavailableResponse(c: Context<PushEnvironment>, state: Extract<WebPushServiceState, { ok: false }>) {
  return c.json({ error: "push_unavailable", message: state.message, missing: state.missing }, 503);
}

function storageUnavailableResponse(c: Context<PushEnvironment>) {
  return c.json(
    { error: "push_storage_unavailable", message: "推播訂閱目前無法儲存，請稍後再試。" },
    503,
  );
}

export function createPushSubscriptionRoutes(dependencies: Partial<PushRouteDependencies> = {}) {
  const deps = { ...defaultDependencies, ...dependencies };
  const routes = new Hono<PushEnvironment>();

  routes.get("/api/v1/push/vapid-public-key", (c) => {
    if (!getSessionUserId(c)) return c.json({ error: "unauthenticated" }, 401);
    const pushService = deps.getPushService();
    if (!pushService.ok) return unavailableResponse(c, pushService);
    return c.json({ data: { publicKey: pushService.service.publicKey } });
  });

  routes.post("/api/v1/push/subscribe", async (c) => {
    const userId = getSessionUserId(c);
    if (!userId) return c.json({ error: "unauthenticated" }, 401);
    const pushService = deps.getPushService();
    if (!pushService.ok) return unavailableResponse(c, pushService);

    const parsed = subscriptionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_push_subscription", message: "推播訂閱資料格式不正確。" }, 400);
    }

    try {
      await deps.store.upsert(userId, parsed.data);
      return c.json({ data: { subscribed: true } }, 201);
    } catch (error) {
      if (error instanceof PushSubscriptionStorageUnavailableError) return storageUnavailableResponse(c);
      throw error;
    }
  });

  routes.post("/api/v1/push/unsubscribe", async (c) => {
    const userId = getSessionUserId(c);
    if (!userId) return c.json({ error: "unauthenticated" }, 401);

    const parsed = unsubscribeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_push_subscription", message: "推播訂閱資料格式不正確。" }, 400);
    }

    try {
      const removed = await deps.store.removeForUser(userId, parsed.data.endpoint);
      return c.json({ data: { unsubscribed: true, removed } });
    } catch (error) {
      if (error instanceof PushSubscriptionStorageUnavailableError) return storageUnavailableResponse(c);
      throw error;
    }
  });

  return routes;
}

export const pushSubscriptionRoutes = createPushSubscriptionRoutes();
