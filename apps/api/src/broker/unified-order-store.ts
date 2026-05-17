/**
 * unified-order-store.ts — CRUD for unified_orders (UTA Phase A)
 *
 * Dual-mode: database or in-memory fallback (CI / local dev without DB).
 */

import { randomUUID } from "node:crypto";

import { eq, desc, and } from "drizzle-orm";

import { isDatabaseMode, getDb, unifiedOrders } from "@iuf-trading-room/db";
import type { UnifiedOrderInput } from "./broker-adapter.js";

export type UnifiedOrderStatus =
  | "pending"
  | "submitted"
  | "partial_fill"
  | "filled"
  | "cancelled"
  | "rejected";

export interface UnifiedOrderRecord {
  id: string;
  workspaceId: string;
  brokerAccountId: string | null;
  adapterKey: string;
  symbol: string;
  action: "Buy" | "Sell";
  qty: number;
  quantityUnit: "SHARE" | "LOT";
  priceType: "Market" | "Limit" | "LimitUp" | "LimitDown";
  limitPrice: number | null;
  orderCond: "Cash" | "Margin" | "ShortSelling" | "LendSelling" | null;
  oddLot: boolean;
  status: UnifiedOrderStatus;
  idempotencyKey: string | null;
  externalOrderId: string | null;
  filledQty: number;
  filledPrice: number | null;
  submittedAt: string | null;
  filledAt: string | null;
  cancelledAt: string | null;
  actorId: string | null;
  adapterResponse: unknown | null;
  createdAt: string;
  updatedAt: string;
}

const _memStore = new Map<string, UnifiedOrderRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function memCreate(
  workspaceId: string,
  adapterKey: string,
  input: UnifiedOrderInput,
  actorId: string | null
): UnifiedOrderRecord {
  const id = randomUUID();
  const now = nowIso();
  const record: UnifiedOrderRecord = {
    id,
    workspaceId,
    brokerAccountId: null,
    adapterKey,
    symbol: input.symbol,
    action: input.action,
    qty: input.qty,
    quantityUnit: input.quantityUnit ?? "LOT",
    priceType: input.priceType,
    limitPrice: input.limitPrice ?? null,
    orderCond: input.orderCond ?? null,
    oddLot: input.oddLot ?? false,
    status: "pending",
    idempotencyKey: null,
    externalOrderId: null,
    filledQty: 0,
    filledPrice: null,
    submittedAt: null,
    filledAt: null,
    cancelledAt: null,
    actorId,
    adapterResponse: null,
    createdAt: now,
    updatedAt: now,
  };
  _memStore.set(id, record);
  return record;
}

export async function createUnifiedOrder(
  workspaceId: string,
  adapterKey: string,
  input: UnifiedOrderInput,
  actorId: string | null
): Promise<UnifiedOrderRecord> {
  const db = getDb();
  if (!db || !isDatabaseMode()) {
    return memCreate(workspaceId, adapterKey, input, actorId);
  }

  const [row] = await db
    .insert(unifiedOrders)
    .values({
      workspaceId,
      adapterKey,
      symbol: input.symbol,
      action: input.action,
      qty: input.qty,
      quantityUnit: input.quantityUnit ?? "LOT",
      priceType: input.priceType,
      limitPrice: input.limitPrice != null ? String(input.limitPrice) : null,
      orderCond: input.orderCond ?? null,
      oddLot: input.oddLot ?? false,
      status: "pending",
      idempotencyKey: input.idempotencyKey ?? null,
      actorId: actorId ?? null,
    })
    .returning();

  return dbRowToRecord(row);
}

export async function updateUnifiedOrderSubmitted(
  orderId: string,
  externalOrderId: string,
  adapterResponse: unknown
): Promise<void> {
  const db = getDb();
  const now = nowIso();
  if (!db || !isDatabaseMode()) {
    const existing = _memStore.get(orderId);
    if (existing) {
      _memStore.set(orderId, {
        ...existing,
        status: "submitted",
        externalOrderId,
        submittedAt: now,
        adapterResponse,
        updatedAt: now,
      });
    }
    return;
  }

  await db
    .update(unifiedOrders)
    .set({
      status: "submitted",
      externalOrderId,
      submittedAt: new Date(now),
      adapterResponse: adapterResponse as Record<string, unknown>,
      updatedAt: new Date(now),
    })
    .where(eq(unifiedOrders.id, orderId));
}

export async function updateUnifiedOrderRejected(
  orderId: string,
  adapterResponse: unknown
): Promise<void> {
  const db = getDb();
  const now = nowIso();
  if (!db || !isDatabaseMode()) {
    const existing = _memStore.get(orderId);
    if (existing) {
      _memStore.set(orderId, {
        ...existing,
        status: "rejected",
        adapterResponse,
        updatedAt: now,
      });
    }
    return;
  }

  await db
    .update(unifiedOrders)
    .set({
      status: "rejected",
      adapterResponse: adapterResponse as Record<string, unknown>,
      updatedAt: new Date(now),
    })
    .where(eq(unifiedOrders.id, orderId));
}

export async function listUnifiedOrders(
  workspaceId: string,
  limit = 50
): Promise<UnifiedOrderRecord[]> {
  const db = getDb();
  if (!db || !isDatabaseMode()) {
    return [..._memStore.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  const rows = await db
    .select()
    .from(unifiedOrders)
    .where(eq(unifiedOrders.workspaceId, workspaceId))
    .orderBy(desc(unifiedOrders.createdAt))
    .limit(limit);

  return rows.map(dbRowToRecord);
}

export async function getUnifiedOrderById(
  workspaceId: string,
  orderId: string
): Promise<UnifiedOrderRecord | null> {
  const db = getDb();
  if (!db || !isDatabaseMode()) {
    const r = _memStore.get(orderId);
    return r?.workspaceId === workspaceId ? r : null;
  }

  const [row] = await db
    .select()
    .from(unifiedOrders)
    .where(
      and(
        eq(unifiedOrders.id, orderId),
        eq(unifiedOrders.workspaceId, workspaceId)
      )
    )
    .limit(1);

  return row ? dbRowToRecord(row) : null;
}

function dbRowToRecord(row: typeof unifiedOrders.$inferSelect): UnifiedOrderRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    brokerAccountId: row.brokerAccountId ?? null,
    adapterKey: row.adapterKey,
    symbol: row.symbol,
    action: row.action as "Buy" | "Sell",
    qty: row.qty,
    quantityUnit: (row.quantityUnit as "SHARE" | "LOT") ?? "LOT",
    priceType: row.priceType as "Market" | "Limit" | "LimitUp" | "LimitDown",
    limitPrice: row.limitPrice != null ? parseFloat(row.limitPrice) : null,
    orderCond: (row.orderCond as UnifiedOrderRecord["orderCond"]) ?? null,
    oddLot: row.oddLot,
    status: row.status as UnifiedOrderStatus,
    idempotencyKey: row.idempotencyKey ?? null,
    externalOrderId: row.externalOrderId ?? null,
    filledQty: row.filledQty,
    filledPrice: row.filledPrice != null ? parseFloat(row.filledPrice) : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    filledAt: row.filledAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    actorId: row.actorId ?? null,
    adapterResponse: row.adapterResponse ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function _resetUnifiedOrderStoreForTests(): void {
  _memStore.clear();
}
