import { and, desc, eq, gt, lt } from "drizzle-orm";

import type { AppSession, ExecutionEvent } from "@iuf-trading-room/contracts";
import { executionEvents, getDb } from "@iuf-trading-room/db";

function shouldPersist(session: AppSession): boolean {
  return session.persistenceMode === "database";
}

export async function appendExecutionEvent(
  session: AppSession,
  accountId: string,
  event: ExecutionEvent
): Promise<void> {
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
  if (!shouldPersist(session)) return [];
  const db = getDb();
  if (!db) return [];

  const limit = Math.min(
    Math.max(1, filters.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT
  );

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

  return rows.map((row): ExecutionEvent => ({
    type: row.type as ExecutionEvent["type"],
    orderId: row.orderId,
    clientOrderId: row.clientOrderId,
    status: row.status as ExecutionEvent["status"],
    message: row.message,
    payload: row.payload as ExecutionEvent["payload"],
    timestamp: row.emittedAt.toISOString()
  }));
}
