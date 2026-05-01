// W6 Day 4 — DB-backed paper ledger.
//
// Drizzle queries against paper_orders + paper_fills tables (migration 0015).
//
// Public export shape intentionally mirrors paper-ledger.ts:
//   upsertOrder / getOrder / listOrders / recordFill / deleteOrder
// This allows Day 5 to swap the import with zero call-site changes.
//
// Architecture:
//   - Internal `LedgerAdapter` interface abstracts storage operations.
//   - `drizzleAdapter(db)` wraps a DatabaseClient with drizzle queries.
//   - Each public function accepts an optional `adapter?: LedgerAdapter`.
//     In production: omit `adapter` → uses getDb() via drizzle.
//     In tests: pass a Map-backed `LedgerAdapter` (no native DB needed).
//
// Hard stops: no KGI SDK import, no broker, no market-data, no server.ts touch.

import { and, asc, eq } from "drizzle-orm";

import { getDb, paperFills, paperOrders } from "@iuf-trading-room/db";
import type { DatabaseClient } from "@iuf-trading-room/db";

import type { OrderIntent, OrderIntentStatus } from "./order-intent.js";
import type { SimulatedFill, OrderState, ListOrdersFilter } from "./paper-ledger.js";

// Re-export types for callers
export type { SimulatedFill, OrderState, ListOrdersFilter };

// ---------------------------------------------------------------------------
// LedgerAdapter — internal storage interface
// ---------------------------------------------------------------------------

/**
 * Narrow storage interface used by every public function.
 * Allows swapping between Drizzle (prod) and Map (test) without changing
 * any call-site or public export shape.
 */
export interface LedgerAdapter {
  /** Save or overwrite an order row. Idempotent on idempotencyKey conflict. */
  saveOrder(state: OrderState): Promise<void>;
  /** Find a single order by its id. */
  findOrder(orderId: string): Promise<OrderState | undefined>;
  /** List orders for a userId, optionally filtered by status. Sorted createdAt ASC. */
  listOrders(userId: string, statusFilter?: OrderIntentStatus): Promise<OrderState[]>;
  /** Save a fill row. Returns false if orderId unknown. Idempotent if fill exists. */
  saveFill(orderId: string, fill: SimulatedFill): Promise<boolean>;
  /** Remove an order (and cascade fills). Returns false if unknown. */
  removeOrder(orderId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Row types (drizzle schema inference)
// ---------------------------------------------------------------------------

type PaperOrderRow = typeof paperOrders.$inferSelect;
type PaperFillRow  = typeof paperFills.$inferSelect;

function rowToOrderState(row: PaperOrderRow, fillRow: PaperFillRow | null): OrderState {
  const intent: OrderIntent = {
    id:             row.id,
    idempotencyKey: row.idempotencyKey,
    symbol:         row.symbol,
    side:           row.side as OrderIntent["side"],
    orderType:      row.orderType as OrderIntent["orderType"],
    qty:            row.qty,
    quantity_unit:  (row.quantityUnit ?? "LOT") as OrderIntent["quantity_unit"],
    price:          row.price !== null ? parseFloat(row.price) : null,
    userId:         row.userId,
    status:         row.status as OrderIntentStatus,
    reason:         row.reason ?? null,
    createdAt:      row.createdAt.toISOString(),
    updatedAt:      row.updatedAt.toISOString()
  };
  const fill: SimulatedFill | null = fillRow
    ? { fillQty: fillRow.fillQty, fillPrice: parseFloat(fillRow.fillPrice), fillTime: fillRow.fillTime }
    : null;
  return { intent, fill };
}

// ---------------------------------------------------------------------------
// DrizzleAdapter — production adapter
// ---------------------------------------------------------------------------

function resolveDrizzleDb(injected?: DatabaseClient | null): DatabaseClient {
  if (injected != null) return injected;
  const db = getDb();
  if (!db) {
    throw new Error(
      "paper-ledger-db: DB not available. " +
      "Set PERSISTENCE_MODE=database and DATABASE_URL."
    );
  }
  return db;
}

/**
 * Create a LedgerAdapter backed by Drizzle + PostgreSQL.
 * Pass a DatabaseClient to override the default singleton (useful for
 * connection-scoped transactions in the future).
 */
export function drizzleAdapter(injectedDb?: DatabaseClient | null): LedgerAdapter {
  const db = resolveDrizzleDb(injectedDb);

  return {
    async saveOrder(state: OrderState): Promise<void> {
      const { intent } = state;
      await db
        .insert(paperOrders)
        .values({
          id:             intent.id,
          idempotencyKey: intent.idempotencyKey,
          symbol:         intent.symbol,
          side:           intent.side,
          orderType:      intent.orderType,
          qty:            intent.qty,
          quantityUnit:   intent.quantity_unit,
          price:          intent.price !== null ? String(intent.price) : null,
          status:         intent.status,
          reason:         intent.reason ?? null,
          userId:         intent.userId,
          intentId:       intent.id,
          createdAt:      new Date(intent.createdAt),
          updatedAt:      new Date(intent.updatedAt)
        })
        .onConflictDoUpdate({
          target: paperOrders.idempotencyKey,
          set: {
            status:    intent.status,
            reason:    intent.reason ?? null,
            updatedAt: new Date(intent.updatedAt)
          }
        });
    },

    async findOrder(orderId: string): Promise<OrderState | undefined> {
      const [orderRow] = await db
        .select()
        .from(paperOrders)
        .where(eq(paperOrders.id, orderId));
      if (!orderRow) return undefined;
      const [fillRow] = await db
        .select()
        .from(paperFills)
        .where(eq(paperFills.orderId, orderId));
      return rowToOrderState(orderRow, fillRow ?? null);
    },

    async listOrders(
      userId: string,
      statusFilter?: OrderIntentStatus
    ): Promise<OrderState[]> {
      const conditions = [eq(paperOrders.userId, userId)];
      if (statusFilter !== undefined) {
        conditions.push(eq(paperOrders.status, statusFilter));
      }
      const orderRows = await db
        .select()
        .from(paperOrders)
        .where(and(...conditions))
        .orderBy(asc(paperOrders.createdAt));

      const results: OrderState[] = [];
      for (const row of orderRows) {
        const [fillRow] = await db
          .select()
          .from(paperFills)
          .where(eq(paperFills.orderId, row.id));
        results.push(rowToOrderState(row, fillRow ?? null));
      }
      return results;
    },

    async saveFill(orderId: string, fill: SimulatedFill): Promise<boolean> {
      const [orderRow] = await db
        .select({ id: paperOrders.id })
        .from(paperOrders)
        .where(eq(paperOrders.id, orderId));
      if (!orderRow) return false;

      const [existingFill] = await db
        .select({ id: paperFills.id })
        .from(paperFills)
        .where(eq(paperFills.orderId, orderId));
      if (existingFill) return true; // idempotent no-op

      await db.insert(paperFills).values({
        orderId:     orderId,
        fillQty:     fill.fillQty,
        fillPrice:   String(fill.fillPrice),
        fillTime:    fill.fillTime,
        simulatedAt: new Date()
      });
      return true;
    },

    async removeOrder(orderId: string): Promise<boolean> {
      const [existing] = await db
        .select({ id: paperOrders.id })
        .from(paperOrders)
        .where(eq(paperOrders.id, orderId));
      if (!existing) return false;
      await db.delete(paperOrders).where(eq(paperOrders.id, orderId));
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// Module-level default adapter (lazy, uses getDb() singleton)
// ---------------------------------------------------------------------------

let _defaultAdapter: LedgerAdapter | null = null;

function getDefaultAdapter(): LedgerAdapter {
  if (!_defaultAdapter) {
    _defaultAdapter = drizzleAdapter();
  }
  return _defaultAdapter;
}

// ---------------------------------------------------------------------------
// Public API — same shape as paper-ledger.ts
// ---------------------------------------------------------------------------

/**
 * Persist (or update) an OrderState.
 * Pass `adapter` for test injection; omit for production.
 */
export async function upsertOrder(
  state: OrderState,
  adapter?: LedgerAdapter | null
): Promise<void> {
  return (adapter ?? getDefaultAdapter()).saveOrder(state);
}

/**
 * Retrieve an order by orderId.
 * Returns undefined if not found.
 */
export async function getOrder(
  orderId: string,
  adapter?: LedgerAdapter | null
): Promise<OrderState | undefined> {
  return (adapter ?? getDefaultAdapter()).findOrder(orderId);
}

/**
 * List orders for a userId with optional status filter.
 * Ordered by createdAt ASC.
 */
export async function listOrders(
  userId: string,
  filters?: ListOrdersFilter,
  adapter?: LedgerAdapter | null
): Promise<OrderState[]> {
  return (adapter ?? getDefaultAdapter()).listOrders(userId, filters?.status);
}

/**
 * Record a fill for an order.
 * Idempotent: second call with same orderId is a no-op.
 * Returns false if orderId does not exist.
 */
export async function recordFill(
  orderId: string,
  fill: SimulatedFill,
  adapter?: LedgerAdapter | null
): Promise<boolean> {
  return (adapter ?? getDefaultAdapter()).saveFill(orderId, fill);
}

/**
 * Delete an order (fills cascade via FK).
 * Returns true if it existed; false if not found.
 */
export async function deleteOrder(
  orderId: string,
  adapter?: LedgerAdapter | null
): Promise<boolean> {
  return (adapter ?? getDefaultAdapter()).removeOrder(orderId);
}
