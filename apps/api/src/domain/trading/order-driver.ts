// W6 Paper Sprint — OrderDriver: state machine coordinator.
// W8 2026-05-05 — wired to paper-ledger-db.ts for persistent storage.
//
// Orchestrates: PENDING → risk-check → ACCEPTED → paper executor → FILLED/REJECTED
// Also supports cancellation stub (PENDING/ACCEPTED → CANCELLED).
//
// v0 stubs:
//   - Risk check: always passes (hardcoded). Future: real risk engine.
//   - Cancellation: stub only; future will wire cancel-from-UI path.
//
// No KGI SDK import. No broker dependency.
// Persistence: paper-ledger-db.ts (DB mode) or in-memory MapAdapter (memory mode).
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
  listOrders,
  recordRealizedPnlForSell,
  type OrderState
} from "./paper-ledger-db.js";

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
    await upsertOrder(finalState);
    return { finalState, rejectionReason: rejectedIntent.reason ?? undefined };
  }

  // Step 2: PENDING → ACCEPTED
  const { intent: acceptedIntent } = transitionIntent(intent, "ACCEPTED");
  await upsertOrder({ intent: acceptedIntent, fill: null });

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
    await upsertOrder(finalState);
    return { finalState, rejectionReason: rejectedIntent.reason ?? undefined };
  }

  // Step 4a: FILLED
  if (executorResult.status === "FILLED") {
    const { intent: filledIntent } = transitionIntent(acceptedIntent, "FILLED");
    await recordFill(acceptedIntent.id, executorResult.fill);
    const finalState: OrderState = { intent: filledIntent, fill: executorResult.fill };
    await upsertOrder(finalState);

    // Realized-P&L ledger (migration 0058): a sell fill may close one or more
    // FIFO buy lots. Persist those matches now, at the moment of fill, so the
    // record is immutable history rather than a value re-derived from a
    // FIFO scan on every future read. Fail-open — a persistence hiccup here
    // must never block the order from reaching FILLED status; the live
    // computeFifoRealizedPnl() view (used by /paper/positions) is unaffected
    // either way since it doesn't read this ledger.
    if (finalState.intent.side === "sell") {
      try {
        const priorFilledOrders = (
          await listOrders(finalState.intent.userId, { status: "FILLED" })
        ).filter((o) => o.intent.id !== finalState.intent.id);
        await recordRealizedPnlForSell(finalState, priorFilledOrders);
      } catch (err) {
        console.error(
          `[order-driver] failed to persist realized P&L for sell ${finalState.intent.id}:`,
          err
        );
      }
    }

    return { finalState };
  }

  // Step 4b: REJECTED (executor rejection)
  const { intent: rejectedIntent } = transitionIntent(acceptedIntent, "REJECTED", {
    reason: executorResult.reason
  });
  const finalState: OrderState = { intent: rejectedIntent, fill: null };
  await upsertOrder(finalState);
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
export async function cancelOrder(
  state: OrderState,
  reason?: string
): Promise<CancelOrderResult> {
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
  await upsertOrder(finalState);
  return { finalState, alreadyTerminal: false };
}
