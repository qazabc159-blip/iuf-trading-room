// W6 Paper Sprint — OrderDriver: state machine coordinator.
//
// Orchestrates: PENDING → risk-check → ACCEPTED → paper executor → FILLED/REJECTED
// Also supports cancellation stub (PENDING/ACCEPTED → CANCELLED).
//
// v0 stubs:
//   - Risk check: always passes (hardcoded). Day 4: real risk engine.
//   - Cancellation: stub only; Day 6+ will wire cancel-from-UI path.
//
// No KGI SDK import. No broker dependency. No DB (Day 3).
// No HTTP route (Day 3 wires routes).
//
// State machine:
//   PENDING →[risk pass]→ ACCEPTED →[executor fill]→ FILLED
//                     ↘[risk fail]→ REJECTED
//                                 ↘[executor reject]→ REJECTED
//   PENDING / ACCEPTED →[cancel]→ CANCELLED

import {
  transitionIntent,
  IllegalTransitionError,
  type OrderIntent
} from "./order-intent.js";

import { executeOrder } from "./paper-executor.js";

import {
  upsertOrder,
  recordFill,
  type OrderState
} from "./paper-ledger.js";

// ---------------------------------------------------------------------------
// Risk check (v0 stub)
// ---------------------------------------------------------------------------

export interface RiskCheckResult {
  pass: boolean;
  reason?: string;
}

/**
 * v0 stub: always pass.
 * Day 4: replace with real risk engine call.
 */
function runRiskCheck(_intent: OrderIntent): RiskCheckResult {
  // Day 4: call risk-engine.ts evaluateOrder(intent)
  return { pass: true };
}

// ---------------------------------------------------------------------------
// Drive order: PENDING → ACCEPTED → FILLED/REJECTED
// ---------------------------------------------------------------------------

export interface DriveOrderResult {
  finalState: OrderState;
  rejectionReason?: string;
}

/**
 * Process an OrderIntent through the full paper execution pipeline:
 *  1. Risk check stub (v0: always pass)
 *  2. PENDING → ACCEPTED
 *  3. PaperExecutor.executeOrder
 *  4. ACCEPTED → FILLED or ACCEPTED → REJECTED
 *
 * Persists each transition to the in-memory ledger.
 * Throws IllegalTransitionError if intent is not in PENDING state.
 */
export async function driveOrder(intent: OrderIntent): Promise<DriveOrderResult> {
  if (intent.status !== "PENDING") {
    throw new IllegalTransitionError(intent.status, "ACCEPTED");
  }

  // Step 1: Risk check stub (v0: always pass)
  const risk = runRiskCheck(intent);
  if (!risk.pass) {
    // PENDING → REJECTED (risk block)
    const { intent: rejectedIntent } = transitionIntent(intent, "REJECTED", {
      reason: risk.reason ?? "risk check failed"
    });
    const finalState: OrderState = { intent: rejectedIntent, fill: null };
    upsertOrder(finalState);
    return { finalState, rejectionReason: rejectedIntent.reason ?? undefined };
  }

  // Step 2: PENDING → ACCEPTED
  const { intent: acceptedIntent } = transitionIntent(intent, "ACCEPTED");
  upsertOrder({ intent: acceptedIntent, fill: null });

  // Step 3: PaperExecutor
  let executorResult: Awaited<ReturnType<typeof executeOrder>>;
  try {
    executorResult = await executeOrder(acceptedIntent);
  } catch (err) {
    // Unexpected executor error → REJECTED
    const { intent: rejectedIntent } = transitionIntent(acceptedIntent, "REJECTED", {
      reason: `executor threw: ${String(err)}`
    });
    const finalState: OrderState = { intent: rejectedIntent, fill: null };
    upsertOrder(finalState);
    return { finalState, rejectionReason: rejectedIntent.reason ?? undefined };
  }

  // Step 4a: FILLED
  if (executorResult.status === "FILLED") {
    const { intent: filledIntent } = transitionIntent(acceptedIntent, "FILLED");
    recordFill(acceptedIntent.id, executorResult.fill);
    const finalState: OrderState = { intent: filledIntent, fill: executorResult.fill };
    upsertOrder(finalState);
    return { finalState };
  }

  // Step 4b: REJECTED (executor rejection)
  const { intent: rejectedIntent } = transitionIntent(acceptedIntent, "REJECTED", {
    reason: executorResult.reason
  });
  const finalState: OrderState = { intent: rejectedIntent, fill: null };
  upsertOrder(finalState);
  return { finalState, rejectionReason: rejectedIntent.reason ?? undefined };
}

// ---------------------------------------------------------------------------
// Cancellation hook (v0 stub)
// Day 6+: wire to UI cancel-order endpoint.
// ---------------------------------------------------------------------------

export interface CancelOrderResult {
  finalState: OrderState;
  alreadyTerminal: boolean;
}

/**
 * Cancel a PENDING or ACCEPTED order.
 * - If already in a terminal state (FILLED, REJECTED, CANCELLED), returns
 *   alreadyTerminal: true with current state unchanged.
 * - Persists CANCELLED transition to ledger.
 */
export function cancelOrder(
  state: OrderState,
  reason?: string
): CancelOrderResult {
  const { intent } = state;
  const terminal = new Set(["FILLED", "REJECTED", "CANCELLED"]);

  if (terminal.has(intent.status)) {
    return { finalState: state, alreadyTerminal: true };
  }

  // PENDING or ACCEPTED → CANCELLED
  const { intent: cancelledIntent } = transitionIntent(intent, "CANCELLED", {
    reason: reason ?? "cancelled by user"
  });
  const finalState: OrderState = { intent: cancelledIntent, fill: state.fill };
  upsertOrder(finalState);
  return { finalState, alreadyTerminal: false };
}
