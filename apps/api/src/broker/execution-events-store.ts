import { and, desc, eq, gt, lt } from "drizzle-orm";

import type { AppSession, ExecutionEvent } from "@iuf-trading-room/contracts";
import { executionEvents, getDb } from "@iuf-trading-room/db";

const memoryEvents = new Map<string, ExecutionEvent[]>();

function shouldPersist(session: AppSession): boolean {
  return session.persistenceMode === "database";
}

function workspaceKey(session: AppSession): string {
  // In memory mode, the session's workspace id may not be stable across
  // requests for the same x-workspace-slug. Use the slug as the canonical
  // hot-path bucket so append/list hit the same event log.
  return session.workspace.slug;
}

function applyFilters(
  events: ExecutionEvent[],
  filters: ExecutionEventListFilters
): ExecutionEvent[] {
  return events.filter((event) => {
    if (filters.accountId) {
      const payloadAccountId =
        event.payload &&
        typeof event.payload === "object" &&
        "accountId" in event.payload &&
        typeof event.payload.accountId === "string"
          ? event.payload.accountId
          : null;
      if (payloadAccountId !== filters.accountId) {
        return false;
      }
    }
    if (filters.orderId && event.orderId !== filters.orderId) {
      return false;
    }
    if (filters.before && event.timestamp >= filters.before) {
      return false;
    }
    if (filters.after && event.timestamp <= filters.after) {
      return false;
    }
    return true;
  });
}

function mergeEvents(
  primary: ExecutionEvent[],
  secondary: ExecutionEvent[]
): ExecutionEvent[] {
  const byKey = new Map<string, ExecutionEvent>();
  for (const event of [...primary, ...secondary]) {
    byKey.set(
      `${event.orderId}:${event.clientOrderId}:${event.type}:${event.timestamp}`,
      event
    );
  }
  return [...byKey.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function appendExecutionEvent(
  session: AppSession,
  accountId: string,
  event: ExecutionEvent
): Promise<void> {
  const key = workspaceKey(session);
  const existing = memoryEvents.get(key) ?? [];
  const next = [
    {
      ...event,
      payload:
        event.payload && typeof event.payload === "object"
          ? ({ ...event.payload, accountId } as ExecutionEvent["payload"])
          : ({ accountId } as ExecutionEvent["payload"])
    },
    ...existing
  ].slice(0, MAX_LIMIT);
  memoryEvents.set(key, next);

  if (!shouldPersist(session)) return;
  const db = getDb();
  if (!db) return;

  await db.insert(executionEvents).values({
    workspaceId: session.workspace.id,
    accountId,
    orderId: event.orderId,
    clientOrderId: event.clientOrderId,
    type: event.type,
    status: event.status,
    message: event.message,
    payload: event.payload as object | null,
    emittedAt: new Date(event.timestamp)
  });
}

export type ExecutionEventListFilters = {
  accountId?: string;
  orderId?: string;
  limit?: number;
  // ISO timestamp; returns events with emitted_at strictly before this anchor
  // for cursor-style pagination.
  before?: string;
  // ISO timestamp; returns events with emitted_at strictly after this anchor
  // for catch-up after reconnect.
  after?: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export async function listExecutionEvents(
  session: AppSession,
  filters: ExecutionEventListFilters = {}
): Promise<ExecutionEvent[]> {
  const limit = Math.min(
    Math.max(1, filters.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT
  );

  const memory = applyFilters(memoryEvents.get(workspaceKey(session)) ?? [], filters);

  if (!shouldPersist(session)) {
    return memory.slice(0, limit);
  }

  const db = getDb();
  if (!db) {
    return memory.slice(0, limit);
  }

  const conditions = [eq(executionEvents.workspaceId, session.workspace.id)];
  if (filters.accountId) {
    conditions.push(eq(executionEvents.accountId, filters.accountId));
  }
  if (filters.orderId) {
    conditions.push(eq(executionEvents.orderId, filters.orderId));
  }
  if (filters.before) {
    conditions.push(lt(executionEvents.emittedAt, new Date(filters.before)));
  }
  if (filters.after) {
    conditions.push(gt(executionEvents.emittedAt, new Date(filters.after)));
  }

  const rows = await db
    .select()
    .from(executionEvents)
    .where(and(...conditions))
    .orderBy(desc(executionEvents.emittedAt))
    .limit(limit);

  const persisted = rows.map((row): ExecutionEvent => ({
    type: row.type as ExecutionEvent["type"],
    orderId: row.orderId,
    clientOrderId: row.clientOrderId,
    status: row.status as ExecutionEvent["status"],
    message: row.message,
    payload: row.payload as ExecutionEvent["payload"],
    timestamp: row.emittedAt.toISOString()
  }));

  return mergeEvents(memory, persisted).slice(0, limit);
}
