/**
 * paper-executor.test.ts — W6 Day 2 unit tests
 *
 * Coverage:
 *   A. PaperExecutor — MARKET order fills
 *   B. PaperExecutor — LIMIT order fills
 *   C. PaperExecutor — REJECTED paths
 *   D. OrderDriver — state machine (PENDING → ACCEPTED → FILLED/REJECTED)
 *   E. OrderDriver — cancellation stub
 *   F. OrderDriver — illegal transition guard
 *   G. PaperLedger — in-memory CRUD
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/paper-executor.test.ts
 *
 * No KGI SDK import. No broker dependency. No DB. No HTTP route.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createOrderIntent, IllegalTransitionError } from "../domain/trading/order-intent.js";
import { executeOrder } from "../domain/trading/paper-executor.js";
import { driveOrder, cancelOrder } from "../domain/trading/order-driver.js";
import {
  upsertOrder,
  getOrder,
  listOrders,
  recordFill,
  deleteOrder,
  _clearLedger,
  _ledgerSize
} from "../domain/trading/paper-ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIntent(overrides: Partial<Parameters<typeof createOrderIntent>[0]> = {}) {
  return createOrderIntent({
    idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    symbol: "2330",
    side: "buy",
    orderType: "market",
    qty: 1000,
    userId: "00000000-0000-0000-0000-000000000001",
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// A0. Odd-lot (SHARE unit) — notional must equal price × qty (not × 1000)
// ---------------------------------------------------------------------------

test("A0: odd-lot SHARE qty=1 price=800 → FILLED, fillQty=1 (not 1000)", async () => {
  const intent = makeIntent({ orderType: "limit", qty: 1, quantity_unit: "SHARE", price: 800.0 });
  const result = await executeOrder(intent);
  assert.equal(result.status, "FILLED");
  if (result.status === "FILLED") {
    // fillQty is the raw qty (1 share), not lot-expanded (1000 shares)
    assert.equal(result.fill.fillQty, 1);
    assert.equal(result.fill.fillPrice, 800.0);
    // Notional = 1 × 800 = 800 TWD (not 800,000 TWD from ×1000 lot-expansion)
    const notional = result.fill.fillQty * result.fill.fillPrice;
    assert.equal(notional, 800);
    assert.equal(result.quantity_unit, "SHARE");
  }
});

// ---------------------------------------------------------------------------
// A. PaperExecutor — MARKET fills
// ---------------------------------------------------------------------------

test("A1: market order with price set → FILLED at intent.price", async () => {
  const intent = makeIntent({ orderType: "market", price: 850.0 });
  const result = await executeOrder(intent);
  assert.equal(result.status, "FILLED");
  if (result.status === "FILLED") {
    assert.equal(result.fill.fillQty, 1000);
    assert.equal(result.fill.fillPrice, 850.0);
    assert.ok(result.fill.fillTime instanceof Date);
  }
});

test("A2: market order with no price (null) → FILLED at fallback 100.0", async () => {
  const intent = makeIntent({ orderType: "market", price: null });
  const result = await executeOrder(intent);
  assert.equal(result.status, "FILLED");
  if (result.status === "FILLED") {
    assert.equal(result.fill.fillPrice, 100.0);
    assert.equal(result.fill.fillQty, 1000);
  }
});

test("A3: market order with price=undefined → FILLED at fallback 100.0", async () => {
  const intent = makeIntent({ orderType: "market" });
  // createOrderIntent sets price: null when not provided
  const result = await executeOrder(intent);
  assert.equal(result.status, "FILLED");
  if (result.status === "FILLED") {
    assert.equal(result.fill.fillPrice, 100.0);
  }
});

test("A4: market order fill qty equals intent.qty", async () => {
  const intent = makeIntent({ orderType: "market", qty: 5000, price: 200.0 });
  const result = await executeOrder(intent);
  assert.equal(result.status, "FILLED");
  if (result.status === "FILLED") {
    assert.equal(result.fill.fillQty, 5000);
  }
});

// ---------------------------------------------------------------------------
// B. PaperExecutor — LIMIT fills
// ---------------------------------------------------------------------------

test("B1: limit order with price set → FILLED at limit price", async () => {
  const intent = makeIntent({ orderType: "limit", price: 790.0 });
  const result = await executeOrder(intent);
  assert.equal(result.status, "FILLED");
  if (result.status === "FILLED") {
    assert.equal(result.fill.fillPrice, 790.0);
    assert.equal(result.fill.fillQty, 1000);
  }
});

test("B2: limit order with null price → REJECTED (no price for limit)", async () => {
  const intent = makeIntent({ orderType: "limit", price: null });
  const result = await executeOrder(intent);
  assert.equal(result.status, "REJECTED");
  if (result.status === "REJECTED") {
    assert.ok(result.reason.includes("price is null"));
  }
});

// ---------------------------------------------------------------------------
// C. PaperExecutor — REJECTED paths
// ---------------------------------------------------------------------------

test("C1: stop order → REJECTED (v0 not supported)", async () => {
  const intent = makeIntent({ orderType: "stop", price: 800.0 });
  const result = await executeOrder(intent);
  assert.equal(result.status, "REJECTED");
  if (result.status === "REJECTED") {
    assert.ok(result.reason.includes("stop"));
  }
});

test("C2: stop_limit order → REJECTED (v0 not supported)", async () => {
  const intent = makeIntent({ orderType: "stop_limit", price: 800.0 });
  const result = await executeOrder(intent);
  assert.equal(result.status, "REJECTED");
  if (result.status === "REJECTED") {
    assert.ok(result.reason.includes("stop_limit"));
  }
});

// ---------------------------------------------------------------------------
// D. OrderDriver — state machine (full pipeline)
// ---------------------------------------------------------------------------

test("D1: driveOrder market → PENDING to FILLED (risk pass → executor fill)", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market", price: 100.0 });
  const result = await driveOrder(intent);

  assert.equal(result.finalState.intent.status, "FILLED");
  assert.ok(result.finalState.fill !== null);
  if (result.finalState.fill) {
    assert.equal(result.finalState.fill.fillPrice, 100.0);
  }
  assert.equal(result.rejectionReason, undefined);
});

test("D2: driveOrder limit with price → PENDING to FILLED", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "limit", price: 820.0 });
  const result = await driveOrder(intent);

  assert.equal(result.finalState.intent.status, "FILLED");
  assert.ok(result.finalState.fill !== null);
  if (result.finalState.fill) {
    assert.equal(result.finalState.fill.fillPrice, 820.0);
  }
});

test("D3: driveOrder limit with null price → PENDING to REJECTED (executor reject)", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "limit", price: null });
  const result = await driveOrder(intent);

  assert.equal(result.finalState.intent.status, "REJECTED");
  assert.ok(result.finalState.fill === null);
  assert.ok(result.rejectionReason !== undefined);
  assert.ok(result.rejectionReason!.includes("price is null"));
});

test("D4: driveOrder persists to ledger — getOrder returns FILLED state", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market", price: 50.0 });
  const result = await driveOrder(intent);

  const persisted = getOrder(intent.id);
  assert.ok(persisted !== undefined);
  assert.equal(persisted!.intent.status, "FILLED");
  assert.ok(persisted!.fill !== null);
});

test("D5: driveOrder stop_limit → REJECTED (executor unsupported)", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "stop_limit", price: 800.0 });
  const result = await driveOrder(intent);

  assert.equal(result.finalState.intent.status, "REJECTED");
  assert.ok(result.rejectionReason !== undefined);
  assert.ok(result.rejectionReason!.includes("stop_limit"));
});

// ---------------------------------------------------------------------------
// E. OrderDriver — cancellation stub
// ---------------------------------------------------------------------------

test("E1: cancelOrder on PENDING intent → CANCELLED", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market" });
  const state = { intent, fill: null };
  upsertOrder(state);

  const result = cancelOrder(state, "user request");
  assert.equal(result.finalState.intent.status, "CANCELLED");
  assert.equal(result.alreadyTerminal, false);
  assert.ok(result.finalState.intent.reason !== null);
});

test("E2: cancelOrder on FILLED intent → alreadyTerminal, state unchanged", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market" });
  const driverResult = await driveOrder(intent);
  assert.equal(driverResult.finalState.intent.status, "FILLED");

  const cancel = cancelOrder(driverResult.finalState, "late cancel");
  assert.equal(cancel.alreadyTerminal, true);
  assert.equal(cancel.finalState.intent.status, "FILLED");
});

test("E3: cancelOrder on REJECTED intent → alreadyTerminal", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "limit", price: null });
  const driverResult = await driveOrder(intent);
  assert.equal(driverResult.finalState.intent.status, "REJECTED");

  const cancel = cancelOrder(driverResult.finalState);
  assert.equal(cancel.alreadyTerminal, true);
  assert.equal(cancel.finalState.intent.status, "REJECTED");
});

test("E4: cancelOrder on CANCELLED intent → alreadyTerminal (idempotent)", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market" });
  const state = { intent, fill: null };

  const first = cancelOrder(state);
  assert.equal(first.alreadyTerminal, false);

  const second = cancelOrder(first.finalState);
  assert.equal(second.alreadyTerminal, true);
});

// ---------------------------------------------------------------------------
// F. OrderDriver — illegal transition guard
// ---------------------------------------------------------------------------

test("F1: driveOrder on non-PENDING intent → throws IllegalTransitionError", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market" });
  // Manually drive once to FILLED
  const result = await driveOrder(intent);
  assert.equal(result.finalState.intent.status, "FILLED");

  // Try to drive the FILLED intent again — should throw
  await assert.rejects(
    () => driveOrder(result.finalState.intent),
    IllegalTransitionError
  );
});

// ---------------------------------------------------------------------------
// G. PaperLedger — in-memory CRUD
// ---------------------------------------------------------------------------

test("G1: upsertOrder + getOrder round-trip", () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market" });
  upsertOrder({ intent, fill: null });

  const retrieved = getOrder(intent.id);
  assert.ok(retrieved !== undefined);
  assert.equal(retrieved!.intent.id, intent.id);
  assert.equal(retrieved!.fill, null);
});

test("G2: listOrders returns only orders for matching userId", () => {
  _clearLedger();
  const userA = "00000000-0000-0000-0000-000000000001";
  const userB = "00000000-0000-0000-0000-000000000002";

  const i1 = makeIntent({ userId: userA });
  const i2 = makeIntent({ userId: userB });
  const i3 = makeIntent({ userId: userA });

  upsertOrder({ intent: i1, fill: null });
  upsertOrder({ intent: i2, fill: null });
  upsertOrder({ intent: i3, fill: null });

  const userAOrders = listOrders(userA);
  assert.equal(userAOrders.length, 2);
  assert.ok(userAOrders.every(o => o.intent.userId === userA));

  const userBOrders = listOrders(userB);
  assert.equal(userBOrders.length, 1);
});

test("G3: listOrders with status filter returns only matching", async () => {
  _clearLedger();
  const i1 = makeIntent({ orderType: "market", price: 100.0 });
  const i2 = makeIntent({ orderType: "limit", price: null }); // → REJECTED

  await driveOrder(i1);
  await driveOrder(i2);

  const filledOrders = listOrders(i1.userId, { status: "FILLED" });
  assert.equal(filledOrders.length, 1);
  assert.equal(filledOrders[0]!.intent.id, i1.id);

  const rejectedOrders = listOrders(i2.userId, { status: "REJECTED" });
  assert.equal(rejectedOrders.length, 1);
  assert.equal(rejectedOrders[0]!.intent.id, i2.id);
});

test("G4: recordFill persists fill; second call is idempotent", async () => {
  _clearLedger();
  const intent = makeIntent({ orderType: "market", price: 120.0 });
  upsertOrder({ intent, fill: null });

  const fill = { fillQty: 1000, fillPrice: 120.0, fillTime: new Date() };
  const ok1 = recordFill(intent.id, fill);
  assert.equal(ok1, true);

  const state1 = getOrder(intent.id);
  assert.ok(state1?.fill !== null);
  assert.equal(state1!.fill!.fillPrice, 120.0);

  // Idempotent second call
  const fill2 = { fillQty: 1000, fillPrice: 999.0, fillTime: new Date() };
  const ok2 = recordFill(intent.id, fill2);
  assert.equal(ok2, true);

  const state2 = getOrder(intent.id);
  // Price should still be from first fill
  assert.equal(state2!.fill!.fillPrice, 120.0);
});

test("G5: recordFill on unknown orderId returns false", () => {
  _clearLedger();
  const fill = { fillQty: 100, fillPrice: 100.0, fillTime: new Date() };
  const ok = recordFill("non-existent-id", fill);
  assert.equal(ok, false);
});

test("G6: deleteOrder removes from ledger; getOrder returns undefined", () => {
  _clearLedger();
  const intent = makeIntent();
  upsertOrder({ intent, fill: null });
  assert.ok(getOrder(intent.id) !== undefined);

  const deleted = deleteOrder(intent.id);
  assert.equal(deleted, true);
  assert.equal(getOrder(intent.id), undefined);
  assert.equal(_ledgerSize(), 0);
});

test("G7: _clearLedger resets all state", () => {
  const i1 = makeIntent();
  const i2 = makeIntent();
  upsertOrder({ intent: i1, fill: null });
  upsertOrder({ intent: i2, fill: null });
  assert.ok(_ledgerSize() >= 2);

  _clearLedger();
  assert.equal(_ledgerSize(), 0);
});
