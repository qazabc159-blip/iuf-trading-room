import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import type { AppSession } from "@iuf-trading-room/contracts";
import { getDb, pushSubscriptions, type PushSubscriptionKeys } from "@iuf-trading-room/db";

import { getConfiguredWebPushService, type WebPushServiceState } from "./web-push-client.js";

type PushVariables = { session: AppSession };
type PushEnvironment = { Variables: PushVariables };

export type StoredPushSubscription = {
  workspaceId: string;
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
  upsert(workspaceId: string, userId: string, subscription: PushSubscriptionInput): Promise<void>;
  removeForUser(workspaceId: string, userId: string, endpoint: string): Promise<boolean>;
  listForWorkspace(workspaceId: string): Promise<StoredPushSubscription[]>;
  removeByEndpoint(workspaceId: string, endpoint: string): Promise<boolean>;
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
  async upsert(workspaceId, userId, subscription) {
    const db = requireDb();
    await db
      .insert(pushSubscriptions)
      .values({ workspaceId, userId, endpoint: subscription.endpoint, keys: subscription.keys })
      .onConflictDoUpdate({
        target: [pushSubscriptions.workspaceId, pushSubscriptions.endpoint],
        set: { userId, keys: subscription.keys },
      });
  },

  async removeForUser(workspaceId, userId, endpoint) {
    const db = requireDb();
    const removed = await db
      .delete(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.workspaceId, workspaceId),
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ))
      .returning({ id: pushSubscriptions.id });
    return removed.length > 0;
  },

  async listForWorkspace(workspaceId) {
    const db = requireDb();
    return db
      .select({
        workspaceId: pushSubscriptions.workspaceId,
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        keys: pushSubscriptions.keys,
        createdAt: pushSubscriptions.createdAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.workspaceId, workspaceId));
  },

  async removeByEndpoint(workspaceId, endpoint) {
    const db = requireDb();
    const removed = await db
      .delete(pushSubscriptions)
      .where(and(
        eq(pushSubscriptions.workspaceId, workspaceId),
        eq(pushSubscriptions.endpoint, endpoint),
      ))
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

function getSession(c: Context<PushEnvironment>): AppSession | null {
  return c.get("session") ?? null;
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
    if (!getSession(c)) return c.json({ error: "unauthenticated" }, 401);
    const pushService = deps.getPushService();
    if (!pushService.ok) return unavailableResponse(c, pushService);
    return c.json({ data: { publicKey: pushService.service.publicKey } });
  });

  routes.post("/api/v1/push/subscribe", async (c) => {
    const session = getSession(c);
    if (!session) return c.json({ error: "unauthenticated" }, 401);
    const pushService = deps.getPushService();
    if (!pushService.ok) return unavailableResponse(c, pushService);

    const parsed = subscriptionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_push_subscription", message: "推播訂閱資料格式不正確。" }, 400);
    }

    try {
      await deps.store.upsert(session.workspace.id, session.user.id, parsed.data);
      return c.json({ data: { subscribed: true } }, 201);
    } catch (error) {
      if (error instanceof PushSubscriptionStorageUnavailableError) return storageUnavailableResponse(c);
      throw error;
    }
  });

  routes.post("/api/v1/push/unsubscribe", async (c) => {
    const session = getSession(c);
    if (!session) return c.json({ error: "unauthenticated" }, 401);

    const parsed = unsubscribeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "invalid_push_subscription", message: "推播訂閱資料格式不正確。" }, 400);
    }

    try {
      const removed = await deps.store.removeForUser(
        session.workspace.id,
        session.user.id,
        parsed.data.endpoint,
      );
      return c.json({ data: { unsubscribed: true, removed } });
    } catch (error) {
      if (error instanceof PushSubscriptionStorageUnavailableError) return storageUnavailableResponse(c);
      throw error;
    }
  });

  return routes;
}

export const pushSubscriptionRoutes = createPushSubscriptionRoutes();
