// W6 Paper Sprint — In-memory order ledger.
//
// v0: module-level Map<orderId, OrderState> storage.
// Day 3: replace Map storage with DB queries (migration 0015 paper_orders table).
//
// Design choices:
//   - No KGI SDK import. No broker dependency. Completely standalone.
//   - OrderState combines intent + optional fill (fill is null until FILLED).
//   - listOrders supports userId filter + optional status filter.
//   - recordFill is idempotent: calling twice with same fill is a no-op (by orderId).
//
// WARNING: all state is process-scoped and non-persistent.
// A process restart loses all ledger entries.
// Day 3 will swap this for DB-backed persistence.

import type { OrderIntent, OrderIntentStatus } from "./order-intent.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimulatedFill {
  fillQty: number;
  fillPrice: number;
  fillTime: Date;
}

export interface OrderState {
  intent: OrderIntent;
  fill: SimulatedFill | null;
}

export interface ListOrdersFilter {
  status?: OrderIntentStatus;
}

// ---------------------------------------------------------------------------
// v0 in-memory store
//
// Day 3: replace with DB-backed store (drizzle, paper_orders + paper_fills tables).
// ---------------------------------------------------------------------------

const _store = new Map<string, OrderState>();

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Persist (or overwrite) an OrderState by orderId.
 * Called whenever intent status transitions.
 */
export function upsertOrder(state: OrderState): void {
  _store.set(state.intent.id, state);
}

/**
 * Retrieve an order by its orderId.
 * Returns undefined if not found.
 */
export function getOrder(orderId: string): OrderState | undefined {
  return _store.get(orderId);
}

/**
 * List all orders for a userId, with optional status filter.
 * Returns a copy of the array (not the internal Map values directly).
 */
export function listOrders(
  userId: string,
  filters?: ListOrdersFilter
): OrderState[] {
  const results: OrderState[] = [];
  for (const state of _store.values()) {
    if (state.intent.userId !== userId) continue;
    if (filters?.status !== undefined && state.intent.status !== filters.status) continue;
    results.push(state);
  }
  // Sort by createdAt ascending (stable, deterministic)
  results.sort((a, b) =>
    a.intent.createdAt.localeCompare(b.intent.createdAt)
  );
  return results;
}

/**
 * Record a fill on an existing order.
 * - Caller must have already transitioned intent to FILLED before calling.
 * - Idempotent: if fill already recorded, this is a no-op.
 * - Returns false if orderId not found.
 */
export function recordFill(orderId: string, fill: SimulatedFill): boolean {
  const existing = _store.get(orderId);
  if (!existing) return false;
  if (existing.fill !== null) {
    // Already recorded — idempotent no-op
    return true;
  }
  _store.set(orderId, { ...existing, fill });
  return true;
}

/**
 * Delete an order from the ledger.
 * Returns true if the order existed and was deleted; false if not found.
 */
export function deleteOrder(orderId: string): boolean {
  return _store.delete(orderId);
}

// ---------------------------------------------------------------------------
// Test helpers — underscore prefix signals test-only usage
// ---------------------------------------------------------------------------

/** Clear ALL ledger state. Use only in tests. */
export function _clearLedger(): void {
  _store.clear();
}

/** Return the raw store size. Use only in tests. */
export function _ledgerSize(): number {
  return _store.size;
}
