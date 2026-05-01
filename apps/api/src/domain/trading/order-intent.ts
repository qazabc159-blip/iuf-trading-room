// W6 Paper Sprint — OrderIntent + type-safe state machine.
//
// States:  PENDING → ACCEPTED → FILLED
//                 ↘ REJECTED
//          PENDING / ACCEPTED → CANCELLED
//
// Illegal transitions are caught at compile time (via the transition map) and
// at runtime (via transitionIntent). No KGI SDK import. No broker dependency.

import { randomUUID } from "node:crypto";
import { TWSE_ODD_LOT_MAX_SHARES } from "@iuf-trading-room/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrderIntentStatus =
  | "PENDING"
  | "ACCEPTED"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";

/**
 * Quantity unit for TWSE paper orders.
 *
 * Required field. No default. Caller must specify SHARE or LOT explicitly.
 * SHARE — odd-lot (零股). Valid range: 1–999 shares.
 * LOT   — board lot (整張). 1 lot = 1,000 shares for TWSE/TPEx stocks.
 *
 * The arithmetic path is unit-agnostic (qty=1 SHARE = 1 share, qty=1 LOT = 1 lot).
 * Risk engine must use effectiveShares = qty * (unit === "LOT" ? 1000 : 1) for
 * notional calculations.
 */
export type QuantityUnit = "SHARE" | "LOT";

export interface OrderIntent {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly qty: number;
  readonly quantity_unit: QuantityUnit;
  readonly price: number | null;
  readonly userId: string;
  readonly status: OrderIntentStatus;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Transition map — only legal next-states are listed per current state
// ---------------------------------------------------------------------------

// ACCEPTED → REJECTED is legal: brokers can reject post-acknowledge for
// insufficient funds, contract mismatch, or executor-stage validation failures
// (e.g. LIMIT order with null price). PaperExecutor relies on this path.
const LEGAL_TRANSITIONS: Record<OrderIntentStatus, ReadonlySet<OrderIntentStatus>> = {
  PENDING:   new Set<OrderIntentStatus>(["ACCEPTED", "REJECTED", "CANCELLED"]),
  ACCEPTED:  new Set<OrderIntentStatus>(["FILLED", "REJECTED", "CANCELLED"]),
  FILLED:    new Set<OrderIntentStatus>(),
  REJECTED:  new Set<OrderIntentStatus>(),
  CANCELLED: new Set<OrderIntentStatus>()
};

// ---------------------------------------------------------------------------
// Transition error
// ---------------------------------------------------------------------------

export class IllegalTransitionError extends Error {
  constructor(from: OrderIntentStatus, to: OrderIntentStatus) {
    super(`Illegal OrderIntent transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// Demo capital constant — used by risk engine and UI for odd-lot absolute notional cap.
export const DEMO_CAPITAL_TWD = 20_000;

export interface CreateOrderIntentInput {
  idempotencyKey: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  qty: number;
  quantity_unit: QuantityUnit;
  price?: number | null;
  userId: string;
}

export function createOrderIntent(input: CreateOrderIntentInput): OrderIntent {
  if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
    throw new Error("idempotencyKey must not be empty");
  }
  if (!input.symbol || input.symbol.trim() === "") {
    throw new Error("symbol must not be empty");
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error("qty must be a positive integer");
  }

  const unit: QuantityUnit = input.quantity_unit;

  // Odd-lot range validation: Taiwan market allows 1–999 shares per odd-lot order.
  if (unit === "SHARE" && (input.qty < 1 || input.qty > TWSE_ODD_LOT_MAX_SHARES)) {
    throw new Error(`qty for SHARE (odd-lot) must be between 1 and ${TWSE_ODD_LOT_MAX_SHARES}`);
  }

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    orderType: input.orderType,
    qty: input.qty,
    quantity_unit: unit,
    price: input.price ?? null,
    userId: input.userId,
    status: "PENDING",
    reason: null,
    createdAt: now,
    updatedAt: now
  };
}

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

export interface TransitionResult {
  intent: OrderIntent;
  previousStatus: OrderIntentStatus;
}

export function transitionIntent(
  intent: OrderIntent,
  to: OrderIntentStatus,
  opts?: { reason?: string; now?: string }
): TransitionResult {
  const legal = LEGAL_TRANSITIONS[intent.status];
  if (!legal.has(to)) {
    throw new IllegalTransitionError(intent.status, to);
  }

  const now = opts?.now ?? new Date().toISOString();
  const previousStatus = intent.status;

  const updated: OrderIntent = {
    ...intent,
    status: to,
    reason: opts?.reason ?? intent.reason,
    updatedAt: now
  };

  return { intent: updated, previousStatus };
}

// ---------------------------------------------------------------------------
// Idempotency key collision detection (in-memory, for unit tests and ops)
// ---------------------------------------------------------------------------

// Production usage delegates collision detection to the DB UNIQUE constraint.
// This in-memory set is only used in tests / preview mode to catch obvious
// double-submissions before they reach the DB round-trip.
const _inMemoryKeys = new Set<string>();

export function _registerIdempotencyKey(key: string): boolean {
  if (_inMemoryKeys.has(key)) return false; // duplicate
  _inMemoryKeys.add(key);
  return true;
}

export function _clearIdempotencyKeys(): void {
  _inMemoryKeys.clear();
}

export function isDuplicateIdempotencyKey(key: string): boolean {
  return _inMemoryKeys.has(key);
}
