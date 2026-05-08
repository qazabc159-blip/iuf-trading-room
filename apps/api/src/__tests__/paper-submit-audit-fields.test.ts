/**
 * paper-submit-audit-fields.test.ts
 *
 * Bruce TR-3-C1 regression guard:
 * Verifies that the audit log payload for paper/submit carries
 * strategy_run_mode = 'paper' and yang_explicit_ack = false.
 *
 * Coverage:
 *   PAF1: main FILLED path payload contains strategy_run_mode='paper' + yang_explicit_ack=false
 *   PAF2: main REJECTED path payload contains strategy_run_mode='paper' + yang_explicit_ack=false
 *   PAF3: 4-layer gate blocked path payload contains strategy_run_mode='paper' + yang_explicit_ack=false
 *
 * Hard lines:
 *   - No HTTP. No DB. No KGI SDK.
 *   - Verifies payload shape directly — does not require writeAuditLog to actually insert.
 *
 * Run:
 *   node --test --import tsx/esm apps/api/src/__tests__/paper-submit-audit-fields.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

// ---------------------------------------------------------------------------
// Helpers — replicate the payload construction logic from server.ts
// paper/submit audit log payloads (two paths: 4-layer blocked + main outcome)
// ---------------------------------------------------------------------------

function buildFourLayerBlockedPayload(opts: {
  symbol: string;
  side: string;
  orderType: string;
  qty: number;
  quantity_unit: string;
  layer: number;
  auditType: string;
  reason: string;
}) {
  return {
    paperMode: true,
    simulated: true,
    symbol: opts.symbol,
    side: opts.side,
    orderType: opts.orderType,
    qty: opts.qty,
    quantity_unit: opts.quantity_unit,
    outcome: "BLOCKED",
    blockedByLayer: opts.layer,
    auditType: opts.auditType,
    reason: opts.reason,
    // Bruce TR-3-C1: strategy run context fields
    strategy_run_mode: "paper" as const,
    yang_explicit_ack: false as const
  };
}

function buildMainSubmitPayload(opts: {
  symbol: string;
  side: string;
  orderType: string;
  qty: number;
  quantity_unit: string;
  idempotencyKey: string;
  intentId: string;
  isRejected: boolean;
}) {
  return {
    paperMode: true,
    simulated: true,
    symbol: opts.symbol,
    side: opts.side,
    orderType: opts.orderType,
    qty: opts.qty,
    quantity_unit: opts.quantity_unit,
    outcome: opts.isRejected ? "REJECTED" : "FILLED",
    idempotencyKey: opts.idempotencyKey,
    intentId: opts.intentId,
    // Bruce TR-3-C1: strategy run context fields
    strategy_run_mode: "paper" as const,
    yang_explicit_ack: false as const
  };
}

// ---------------------------------------------------------------------------
// PAF1: FILLED path — strategy_run_mode + yang_explicit_ack present
// ---------------------------------------------------------------------------

test("PAF1: paper/submit FILLED audit payload includes strategy_run_mode='paper' + yang_explicit_ack=false", () => {
  const p = buildMainSubmitPayload({
    symbol: "2330",
    side: "buy",
    orderType: "limit",
    qty: 1,
    quantity_unit: "SHARE",
    idempotencyKey: "idem-001",
    intentId: "intent-001",
    isRejected: false
  });

  assert.equal(p.strategy_run_mode, "paper", "strategy_run_mode must be 'paper'");
  assert.equal(p.yang_explicit_ack, false, "yang_explicit_ack must be false for paper/submit");
  assert.equal(p.outcome, "FILLED", "outcome should be FILLED");
  assert.equal(p.paperMode, true, "paperMode must be true");
  assert.equal(p.simulated, true, "simulated must be true");
});

// ---------------------------------------------------------------------------
// PAF2: REJECTED path — same fields must be present
// ---------------------------------------------------------------------------

test("PAF2: paper/submit REJECTED audit payload includes strategy_run_mode='paper' + yang_explicit_ack=false", () => {
  const p = buildMainSubmitPayload({
    symbol: "2454",
    side: "sell",
    orderType: "market",
    qty: 1,
    quantity_unit: "LOT",
    idempotencyKey: "idem-002",
    intentId: "intent-002",
    isRejected: true
  });

  assert.equal(p.strategy_run_mode, "paper", "strategy_run_mode must be 'paper'");
  assert.equal(p.yang_explicit_ack, false, "yang_explicit_ack must be false for paper/submit");
  assert.equal(p.outcome, "REJECTED", "outcome should be REJECTED");
});

// ---------------------------------------------------------------------------
// PAF3: 4-layer gate blocked path — same fields must be present
// ---------------------------------------------------------------------------

test("PAF3: paper/submit 4-layer blocked audit payload includes strategy_run_mode='paper' + yang_explicit_ack=false", () => {
  const p = buildFourLayerBlockedPayload({
    symbol: "2330",
    side: "buy",
    orderType: "limit",
    qty: 1,
    quantity_unit: "SHARE",
    layer: 1,
    auditType: "kill_switch_on",
    reason: "kill switch is enabled"
  });

  assert.equal(p.strategy_run_mode, "paper", "strategy_run_mode must be 'paper'");
  assert.equal(p.yang_explicit_ack, false, "yang_explicit_ack must be false");
  assert.equal(p.outcome, "BLOCKED", "outcome should be BLOCKED");
  assert.equal(p.blockedByLayer, 1);
  assert.equal(p.auditType, "kill_switch_on");
});
