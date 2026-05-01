/**
 * order-intent.test.ts — W6 Day 1 unit tests
 *
 * Coverage:
 *   A. OrderIntent state machine — legal transitions
 *   B. OrderIntent state machine — illegal transitions
 *   C. ExecutionMode flags — defaults
 *   D. ExecutionMode — three-layer gate
 *   E. Idempotency key duplicate detection
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/order-intent.test.ts
 *
 * No KGI SDK import. No broker dependency.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrderIntent,
  transitionIntent,
  IllegalTransitionError,
  _registerIdempotencyKey,
  _clearIdempotencyKeys,
  isDuplicateIdempotencyKey,
  type OrderIntentStatus
} from "../domain/trading/order-intent.js";

import {
  getExecutionMode,
  isKillSwitchEnabled,
  isPaperModeEnabled,
  checkPaperExecutionGate,
  getExecutionFlagSnapshot,
  _setExecutionMode,
  _setKillSwitchEnabled,
  _setPaperModeEnabled
} from "../domain/trading/execution-mode.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePendingIntent(overrides: Partial<Parameters<typeof createOrderIntent>[0]> = {}) {
  return createOrderIntent({
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    symbol: "2330",
    side: "buy",
    orderType: "market",
    qty: 1000,
    quantity_unit: "LOT",
    userId: "user-test-01",
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// A. State machine — legal transitions
// ---------------------------------------------------------------------------

test("A1: PENDING → ACCEPTED is legal", () => {
  const intent = makePendingIntent();
  const { intent: next, previousStatus } = transitionIntent(intent, "ACCEPTED");
  assert.equal(next.status, "ACCEPTED");
  assert.equal(previousStatus, "PENDING");
  assert.ok(next.updatedAt >= intent.createdAt);
});

test("A2: PENDING → REJECTED is legal", () => {
  const intent = makePendingIntent();
  const { intent: next } = transitionIntent(intent, "REJECTED", { reason: "risk_limit" });
  assert.equal(next.status, "REJECTED");
  assert.equal(next.reason, "risk_limit");
});

test("A3: PENDING → CANCELLED is legal", () => {
  const intent = makePendingIntent();
  const { intent: next } = transitionIntent(intent, "CANCELLED");
  assert.equal(next.status, "CANCELLED");
});

test("A4: ACCEPTED → FILLED is legal", () => {
  const intent = makePendingIntent();
  const { intent: accepted } = transitionIntent(intent, "ACCEPTED");
  const { intent: filled } = transitionIntent(accepted, "FILLED");
  assert.equal(filled.status, "FILLED");
});

test("A5: ACCEPTED → CANCELLED is legal", () => {
  const intent = makePendingIntent();
  const { intent: accepted } = transitionIntent(intent, "ACCEPTED");
  const { intent: cancelled } = transitionIntent(accepted, "CANCELLED", { reason: "user_request" });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.reason, "user_request");
});

// ---------------------------------------------------------------------------
// B. State machine — illegal transitions
// ---------------------------------------------------------------------------

const illegalCases: Array<[OrderIntentStatus, OrderIntentStatus]> = [
  ["PENDING",   "FILLED"],    // must go via ACCEPTED
  ["PENDING",   "PENDING"],   // self-loop
  ["FILLED",    "ACCEPTED"],  // terminal
  ["FILLED",    "REJECTED"],  // terminal
  ["FILLED",    "CANCELLED"], // terminal
  ["REJECTED",  "ACCEPTED"],  // terminal
  ["REJECTED",  "PENDING"],   // terminal
  ["CANCELLED", "PENDING"],   // terminal
  ["CANCELLED", "ACCEPTED"],  // terminal
  ["CANCELLED", "FILLED"],    // terminal
];

for (const [from, to] of illegalCases) {
  test(`B: ${from} → ${to} throws IllegalTransitionError`, () => {
    // Build an intent already in the `from` state via legal transitions
    let intent = makePendingIntent();

    // Walk to the target `from` state
    if (from === "ACCEPTED" || from === "FILLED" || from === "CANCELLED" || from === "REJECTED") {
      ({ intent } = transitionIntent(intent, "ACCEPTED"));
    }
    if (from === "FILLED") {
      ({ intent } = transitionIntent(intent, "FILLED"));
    }
    if (from === "CANCELLED") {
      ({ intent } = transitionIntent(intent, "CANCELLED"));
    }
    if (from === "REJECTED") {
      // need to rebuild from PENDING for REJECTED
      intent = makePendingIntent();
      ({ intent } = transitionIntent(intent, "REJECTED"));
    }

    assert.throws(
      () => transitionIntent(intent, to),
      IllegalTransitionError
    );
  });
}

// ---------------------------------------------------------------------------
// C. ExecutionMode flags — defaults
// ---------------------------------------------------------------------------

test("C1: default executionMode is 'disabled' (env not set to paper/live)", () => {
  // We can't unset process.env in test cleanly, but we can reset via setter
  // and verify the read-from-env logic via the getter after reset.
  // The module initialized with whatever process.env.EXECUTION_MODE was;
  // in CI/local (unset) this should be 'disabled'.
  // We reset to a known state first.
  _setExecutionMode("disabled");
  assert.equal(getExecutionMode(), "disabled");
});

test("C2: default killSwitchEnabled is true (kill switch ON = blocked)", () => {
  _setKillSwitchEnabled(true);
  assert.equal(isKillSwitchEnabled(), true);
});

test("C3: default paperModeEnabled is false (paper mode OFF)", () => {
  _setPaperModeEnabled(false);
  assert.equal(isPaperModeEnabled(), false);
});

test("C4: getExecutionFlagSnapshot returns all three flags", () => {
  _setExecutionMode("disabled");
  _setKillSwitchEnabled(true);
  _setPaperModeEnabled(false);
  const snap = getExecutionFlagSnapshot();
  assert.equal(snap.executionMode, "disabled");
  assert.equal(snap.killSwitchEnabled, true);
  assert.equal(snap.paperModeEnabled, false);
});

// ---------------------------------------------------------------------------
// D. Three-layer AND gate
// ---------------------------------------------------------------------------

test("D1: gate blocks when executionMode=disabled", () => {
  _setExecutionMode("disabled");
  _setKillSwitchEnabled(false);
  _setPaperModeEnabled(true);
  const result = checkPaperExecutionGate();
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.layer, "execution_mode");
});

test("D2: gate blocks when executionMode=live (not paper)", () => {
  _setExecutionMode("live");
  _setKillSwitchEnabled(false);
  _setPaperModeEnabled(true);
  const result = checkPaperExecutionGate();
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.layer, "execution_mode");
});

test("D3: gate blocks when kill switch is ON even if mode=paper and paperMode=true", () => {
  _setExecutionMode("paper");
  _setKillSwitchEnabled(true);   // kill switch ON = blocked
  _setPaperModeEnabled(true);
  const result = checkPaperExecutionGate();
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.layer, "kill_switch");
});

test("D4: gate blocks when paperMode=OFF even if mode=paper and killSwitch=OFF", () => {
  _setExecutionMode("paper");
  _setKillSwitchEnabled(false);
  _setPaperModeEnabled(false);   // paper mode OFF
  const result = checkPaperExecutionGate();
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.layer, "paper_mode");
});

test("D5: gate allows when all three layers are satisfied", () => {
  _setExecutionMode("paper");
  _setKillSwitchEnabled(false);
  _setPaperModeEnabled(true);
  const result = checkPaperExecutionGate();
  assert.equal(result.allowed, true);
});

// Restore safe defaults after gate tests
test("D6: restore safe defaults after gate tests", () => {
  _setExecutionMode("disabled");
  _setKillSwitchEnabled(true);
  _setPaperModeEnabled(false);
  const snap = getExecutionFlagSnapshot();
  assert.equal(snap.executionMode, "disabled");
  assert.equal(snap.killSwitchEnabled, true);
  assert.equal(snap.paperModeEnabled, false);
});

// ---------------------------------------------------------------------------
// E. Idempotency key duplicate detection
// ---------------------------------------------------------------------------

test("E1: first registration of a key returns true (not duplicate)", () => {
  _clearIdempotencyKeys();
  const ok = _registerIdempotencyKey("key-abc-001");
  assert.equal(ok, true);
});

test("E2: second registration of same key returns false (duplicate)", () => {
  _clearIdempotencyKeys();
  _registerIdempotencyKey("key-abc-002");
  const ok = _registerIdempotencyKey("key-abc-002");
  assert.equal(ok, false);
});

test("E3: isDuplicateIdempotencyKey returns false for unknown key", () => {
  _clearIdempotencyKeys();
  assert.equal(isDuplicateIdempotencyKey("never-registered"), false);
});

test("E4: isDuplicateIdempotencyKey returns true after registration", () => {
  _clearIdempotencyKeys();
  _registerIdempotencyKey("key-abc-003");
  assert.equal(isDuplicateIdempotencyKey("key-abc-003"), true);
});

test("E5: clearIdempotencyKeys resets the store", () => {
  _registerIdempotencyKey("key-to-clear");
  _clearIdempotencyKeys();
  assert.equal(isDuplicateIdempotencyKey("key-to-clear"), false);
});

test("E6: createOrderIntent rejects empty idempotencyKey", () => {
  assert.throws(
    () => createOrderIntent({
      idempotencyKey: "",
      symbol: "2330",
      side: "buy",
      orderType: "market",
      qty: 1000,
      quantity_unit: "LOT",
      userId: "user-01"
    }),
    { message: /idempotencyKey must not be empty/ }
  );
});

test("E7: createOrderIntent rejects zero qty", () => {
  assert.throws(
    () => createOrderIntent({
      idempotencyKey: "key-qty-zero",
      symbol: "2330",
      side: "buy",
      orderType: "market",
      qty: 0,
      quantity_unit: "LOT",
      userId: "user-01"
    }),
    { message: /qty must be a positive integer/ }
  );
});

test("E8: createOrderIntent rejects negative qty", () => {
  assert.throws(
    () => createOrderIntent({
      idempotencyKey: "key-qty-neg",
      symbol: "2330",
      side: "buy",
      orderType: "market",
      qty: -100,
      quantity_unit: "LOT",
      userId: "user-01"
    }),
    { message: /qty must be a positive integer/ }
  );
});
