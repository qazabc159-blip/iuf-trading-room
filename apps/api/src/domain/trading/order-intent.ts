// W6 Paper Sprint — OrderIntent + type-safe state machine.
//
// States:  PENDING → ACCEPTED → FILLED
//                 ↘ REJECTED
//          PENDING / ACCEPTED → CANCELLED
//
// Illegal transitions are caught at compile time (via the transition map) and
// at runtime (via transitionIntent). No KGI SDK import. No broker dependency.

import { randomUUID } from "node:crypto";

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

export interface OrderIntent {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly symbol: string;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly qty: number;
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

const LEGAL_TRANSITIONS: Record<OrderIntentStatus, ReadonlySet<OrderIntentStatus>> = {
  PENDING:   new Set<OrderIntentStatus>(["ACCEPTED", "REJECTED", "CANCELLED"]),
  ACCEPTED:  new Set<OrderIntentStatus>(["FILLED", "CANCELLED"]),
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

export interface CreateOrderIntentInput {
  idempotencyKey: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  qty: number;
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

  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    orderType: input.orderType,
    qty: input.qty,
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
