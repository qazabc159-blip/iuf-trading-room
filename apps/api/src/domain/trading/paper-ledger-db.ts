// W6 Day 4 — DB-backed paper ledger.
// W8 2026-05-05 — wired to order-driver; fallback MapAdapter for memory mode.
//
// Drizzle queries against paper_orders + paper_fills tables (migration 0015).
//
// Public export shape intentionally mirrors paper-ledger.ts:
//   upsertOrder / getOrder / listOrders / recordFill / deleteOrder
//   + findByIdempotencyKey (idempotency persistence, Task B)
//
// Architecture:
//   - Internal `LedgerAdapter` interface abstracts storage operations.
//   - `drizzleAdapter(db)` wraps a DatabaseClient with drizzle queries.
//   - `mapAdapter()` provides in-memory fallback for memory mode (CI/local).
//   - Each public function accepts an optional `adapter?: LedgerAdapter`.
//     In production (PERSISTENCE_MODE=database): omit → DrizzleAdapter.
//     In memory mode (default): omit → MapAdapter (same process, non-persistent).
//     In tests: pass a MapAdapter explicitly.
//
// Hard stops: no KGI SDK import, no broker, no market-data, no server.ts touch.

import { and, asc, eq } from "drizzle-orm";

import { getDb, isDatabaseMode, paperFills, paperOrders } from "@iuf-trading-room/db";
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
  /** Find an order by idempotency key. Returns undefined if not found. */
  findByIdempotencyKey(key: string): Promise<OrderState | undefined>;
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

    async findByIdempotencyKey(key: string): Promise<OrderState | undefined> {
      const [orderRow] = await db
        .select()
        .from(paperOrders)
        .where(eq(paperOrders.idempotencyKey, key));
      if (!orderRow) return undefined;
      const [fillRow] = await db
        .select()
        .from(paperFills)
        .where(eq(paperFills.orderId, orderRow.id));
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
// MapAdapter — in-memory fallback for memory mode (CI / local without DB)
// ---------------------------------------------------------------------------

/**
 * In-memory LedgerAdapter backed by a Map + Set.
 * Used when PERSISTENCE_MODE != "database".
 * Same semantics as the old paper-ledger.ts but async and unified under
 * the LedgerAdapter interface.
 */
export function mapAdapter(): LedgerAdapter {
  const orders = new Map<string, OrderState>();
  // idempotency_key → orderId index
  const idempotencyIndex = new Map<string, string>();

  return {
    async saveOrder(state: OrderState): Promise<void> {
      const existing = idempotencyIndex.get(state.intent.idempotencyKey);
      if (existing && existing !== state.intent.id) {
        // Key already registered to a different orderId — idempotent no-op
        return;
      }
      orders.set(state.intent.id, state);
      idempotencyIndex.set(state.intent.idempotencyKey, state.intent.id);
    },

    async findOrder(orderId: string): Promise<OrderState | undefined> {
      return orders.get(orderId);
    },

    async findByIdempotencyKey(key: string): Promise<OrderState | undefined> {
      const orderId = idempotencyIndex.get(key);
      if (!orderId) return undefined;
      return orders.get(orderId);
    },

    async listOrders(
      userId: string,
      statusFilter?: OrderIntentStatus
    ): Promise<OrderState[]> {
      const results: OrderState[] = [];
      for (const state of orders.values()) {
        if (state.intent.userId !== userId) continue;
        if (statusFilter !== undefined && state.intent.status !== statusFilter) continue;
        results.push(state);
      }
      results.sort((a, b) => a.intent.createdAt.localeCompare(b.intent.createdAt));
      return results;
    },

    async saveFill(orderId: string, fill: SimulatedFill): Promise<boolean> {
      const existing = orders.get(orderId);
      if (!existing) return false;
      if (existing.fill !== null) return true; // idempotent
      orders.set(orderId, { ...existing, fill });
      return true;
    },

    async removeOrder(orderId: string): Promise<boolean> {
      const existing = orders.get(orderId);
      if (!existing) return false;
      idempotencyIndex.delete(existing.intent.idempotencyKey);
      orders.delete(orderId);
      return true;
    }
  };
}

// ---------------------------------------------------------------------------
// Module-level default adapter (lazy, picks DB or memory based on env)
// ---------------------------------------------------------------------------

let _defaultAdapter: LedgerAdapter | null = null;

/** Exposed for test injection only. */
export function _setDefaultAdapterForTest(adapter: LedgerAdapter | null): void {
  _defaultAdapter = adapter;
}

function getDefaultAdapter(): LedgerAdapter {
  if (!_defaultAdapter) {
    _defaultAdapter = isDatabaseMode() ? drizzleAdapter() : mapAdapter();
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

/**
 * Find an order by its idempotency key.
 * Returns undefined if not found.
 * Used by submit routes for persistent duplicate detection across restarts.
 */
export async function findByIdempotencyKey(
  key: string,
  adapter?: LedgerAdapter | null
): Promise<OrderState | undefined> {
  return (adapter ?? getDefaultAdapter()).findByIdempotencyKey(key);
}
