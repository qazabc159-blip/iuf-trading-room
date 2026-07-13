/**
 * order-rules.test.ts — 台股下單能力完整矩陣 T-1 驗證矩陣測試
 *
 * Source: reports/epic_trading_desk_20260702/ORDER_TYPE_MATRIX_DESIGN_v1.md §4
 * (7 validation rules). Every rule gets at least one valid + one invalid case,
 * per the design doc's acceptance criteria.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/order-rules.test.ts
 *
 * No DB. No broker. No HTTP. Pure function tests only — order-rules.ts has
 * zero DB/session dependency by design.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkMarketOrderTif,
  checkOddLotSessionTif,
  checkPriceTick,
  checkPriceLimit,
  checkSessionOrderCond,
  checkQuantity,
  validateReduceOnlyModify,
  validateOrderTypeMatrix,
  type OrderMatrixInput
} from "../broker/order-rules.js";

// A fully-valid baseline order — every test tweaks one field off this.
function baseOrder(overrides: Partial<OrderMatrixInput> = {}): OrderMatrixInput {
  return {
    type: "limit",
    timeInForce: "rod",
    orderCond: "cash",
    session: "regular",
    quantity: 1000,
    quantity_unit: "SHARE",
    price: 605, // tier 500-1000, tick=1.0 → integer is on-grid
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// §4.1 — 市價單 TIF 只能 ioc/fok
// ---------------------------------------------------------------------------

test("§4.1 valid: market + ioc passes", () => {
  assert.equal(checkMarketOrderTif({ type: "market", timeInForce: "ioc" }), null);
});

test("§4.1 valid: market + fok passes", () => {
  assert.equal(checkMarketOrderTif({ type: "market", timeInForce: "fok" }), null);
});

test("§4.1 invalid: market + rod → MARKET_ORDER_TIF_INVALID", () => {
  const v = checkMarketOrderTif({ type: "market", timeInForce: "rod" });
  assert.equal(v?.code, "MARKET_ORDER_TIF_INVALID");
});

test("§4.1 invalid: market + day → MARKET_ORDER_TIF_INVALID", () => {
  const v = checkMarketOrderTif({ type: "market", timeInForce: "day" });
  assert.equal(v?.code, "MARKET_ORDER_TIF_INVALID");
});

test("§4.1 not applicable: limit + rod is untouched by this rule", () => {
  assert.equal(checkMarketOrderTif({ type: "limit", timeInForce: "rod" }), null);
});

// ---------------------------------------------------------------------------
// §4.2 — 零股 session × TIF
// ---------------------------------------------------------------------------

test("§4.2 valid: afterhours_odd + rod passes", () => {
  assert.equal(checkOddLotSessionTif({ session: "afterhours_odd", timeInForce: "rod" }), null);
});

test("§4.2 valid: afterhours_fixed + rod passes", () => {
  assert.equal(checkOddLotSessionTif({ session: "afterhours_fixed", timeInForce: "rod" }), null);
});

test("§4.2 invalid: afterhours_odd + ioc → ODD_LOT_SESSION_TIF_INVALID", () => {
  const v = checkOddLotSessionTif({ session: "afterhours_odd", timeInForce: "ioc" });
  assert.equal(v?.code, "ODD_LOT_SESSION_TIF_INVALID");
});

test("§4.2 valid: intraday_odd + ioc passes", () => {
  assert.equal(checkOddLotSessionTif({ session: "intraday_odd", timeInForce: "ioc" }), null);
});

test("§4.2 valid: intraday_odd + fok passes", () => {
  assert.equal(checkOddLotSessionTif({ session: "intraday_odd", timeInForce: "fok" }), null);
});

test("§4.2 invalid: intraday_odd + gtc → ODD_LOT_SESSION_TIF_INVALID", () => {
  const v = checkOddLotSessionTif({ session: "intraday_odd", timeInForce: "gtc" });
  assert.equal(v?.code, "ODD_LOT_SESSION_TIF_INVALID");
});

test("§4.2 not applicable: regular session is untouched by this rule", () => {
  assert.equal(checkOddLotSessionTif({ session: "regular", timeInForce: "gtc" }), null);
});

// ---------------------------------------------------------------------------
// §4.3 — tick（升降單位）
// ---------------------------------------------------------------------------

test("§4.3 valid: 605 is on the 500-1000 tier's 1.0 tick grid", () => {
  assert.equal(checkPriceTick({ type: "limit", price: 605 }), null);
});

test("§4.3 valid: 42.05 is on the 10-50 tier's 0.05 tick grid", () => {
  assert.equal(checkPriceTick({ type: "limit", price: 42.05 }), null);
});

test("§4.3 invalid: 605.3 is off the 500-1000 tier's 1.0 tick grid", () => {
  const v = checkPriceTick({ type: "limit", price: 605.3 });
  assert.equal(v?.code, "PRICE_TICK_INVALID");
  assert.equal(v?.details?.nearestValidPrice, 605);
});

test("§4.3 invalid: 42.07 is off the 10-50 tier's 0.05 tick grid, snaps to 42.05", () => {
  const v = checkPriceTick({ type: "limit", price: 42.07 });
  assert.equal(v?.code, "PRICE_TICK_INVALID");
  assert.equal(v?.details?.nearestValidPrice, 42.05);
});

test("§4.3 not applicable: market orders (no price) skip tick check", () => {
  assert.equal(checkPriceTick({ type: "market", price: null }), null);
});

// ---------------------------------------------------------------------------
// §4.4 — 漲跌停 ±10%
// ---------------------------------------------------------------------------

test("§4.4 valid: price within ±10% band passes", () => {
  // refPrice=600 → band [540, 660] (tick=1.0 rounds band inward)
  assert.equal(checkPriceLimit({ type: "limit", price: 650 }, { refPrice: 600 }), null);
});

test("§4.4 invalid: price above +10% band → PRICE_LIMIT_EXCEEDED", () => {
  const v = checkPriceLimit({ type: "limit", price: 670 }, { refPrice: 600 });
  assert.equal(v?.code, "PRICE_LIMIT_EXCEEDED");
});

test("§4.4 invalid: price below -10% band → PRICE_LIMIT_EXCEEDED", () => {
  const v = checkPriceLimit({ type: "limit", price: 530 }, { refPrice: 600 });
  assert.equal(v?.code, "PRICE_LIMIT_EXCEEDED");
});

test("§4.4 skipped: no refPrice → check does not block", () => {
  assert.equal(checkPriceLimit({ type: "limit", price: 999999 }, { refPrice: null }), null);
  assert.equal(checkPriceLimit({ type: "limit", price: 999999 }, {}), null);
});

test("§4.4 aggregate: priceLimitSkipped=true when refPrice missing on a limit order", () => {
  const result = validateOrderTypeMatrix(baseOrder({ price: 605 }), { refPrice: null });
  assert.equal(result.priceLimitSkipped, true);
});

test("§4.4 aggregate: priceLimitSkipped=false when refPrice present", () => {
  const result = validateOrderTypeMatrix(baseOrder({ price: 605 }), { refPrice: 600 });
  assert.equal(result.priceLimitSkipped, false);
});

// ---------------------------------------------------------------------------
// §4.5 — session × orderCond：零股/盤後定價只支援現股
// ---------------------------------------------------------------------------

test("§4.5 valid: afterhours_odd + cash passes", () => {
  assert.equal(checkSessionOrderCond({ session: "afterhours_odd", orderCond: "cash" }), null);
});

test("§4.5 valid: regular + margin passes (not an odd-lot session)", () => {
  assert.equal(checkSessionOrderCond({ session: "regular", orderCond: "margin" }), null);
});

test("§4.5 invalid: afterhours_odd + margin → ODD_LOT_CASH_ONLY", () => {
  const v = checkSessionOrderCond({ session: "afterhours_odd", orderCond: "margin" });
  assert.equal(v?.code, "ODD_LOT_CASH_ONLY");
});

test("§4.5 invalid: intraday_odd + short → ODD_LOT_CASH_ONLY", () => {
  const v = checkSessionOrderCond({ session: "intraday_odd", orderCond: "short" });
  assert.equal(v?.code, "ODD_LOT_CASH_ONLY");
});

// ---------------------------------------------------------------------------
// §4.6 — 數量：regular 須整張；零股 session 須 1-999 股
// ---------------------------------------------------------------------------

test("§4.6 valid: regular session, 2000 SHARE (2 lots) passes", () => {
  assert.equal(checkQuantity({ session: "regular", quantity: 2000, quantity_unit: "SHARE" }), null);
});

test("§4.6 valid: regular session, 2 LOT (=2000 shares) passes", () => {
  assert.equal(checkQuantity({ session: "regular", quantity: 2, quantity_unit: "LOT" }), null);
});

test("§4.6 invalid: regular session, 1500 SHARE (not a lot multiple) → LOT_QUANTITY_INVALID", () => {
  const v = checkQuantity({ session: "regular", quantity: 1500, quantity_unit: "SHARE" });
  assert.equal(v?.code, "LOT_QUANTITY_INVALID");
});

test("§4.6 valid: intraday_odd session, 500 SHARE passes", () => {
  assert.equal(checkQuantity({ session: "intraday_odd", quantity: 500, quantity_unit: "SHARE" }), null);
});

test("§4.6 invalid: afterhours_odd session, 1200 SHARE (>= 1000) → ODD_LOT_QUANTITY_INVALID", () => {
  const v = checkQuantity({ session: "afterhours_odd", quantity: 1200, quantity_unit: "SHARE" });
  assert.equal(v?.code, "ODD_LOT_QUANTITY_INVALID");
});

// ---------------------------------------------------------------------------
// §4.7 — 改量 reduce-only
// ---------------------------------------------------------------------------

test("§4.7 valid: reducing 1000 → 500 passes", () => {
  assert.equal(validateReduceOnlyModify(1000, 500), null);
});

test("§4.7 invalid: increasing 1000 → 1500 → MODIFY_QTY_NOT_REDUCE_ONLY", () => {
  const v = validateReduceOnlyModify(1000, 1500);
  assert.equal(v?.code, "MODIFY_QTY_NOT_REDUCE_ONLY");
});

test("§4.7 invalid: modifyQty=0 → MODIFY_QTY_NOT_REDUCE_ONLY", () => {
  const v = validateReduceOnlyModify(1000, 0);
  assert.equal(v?.code, "MODIFY_QTY_NOT_REDUCE_ONLY");
});

// ---------------------------------------------------------------------------
// Aggregate — validateOrderTypeMatrix
// ---------------------------------------------------------------------------

test("aggregate: fully-valid order → ok=true, no violations", () => {
  const result = validateOrderTypeMatrix(baseOrder(), { refPrice: 600 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("aggregate: valid odd-lot order (intraday_odd, cash, 500 shares, ioc) → ok=true", () => {
  const result = validateOrderTypeMatrix(
    baseOrder({
      session: "intraday_odd",
      timeInForce: "ioc",
      quantity: 500,
      price: 605
    }),
    { refPrice: 600 }
  );
  assert.equal(result.ok, true);
});

test("aggregate: multiple simultaneous violations are all reported", () => {
  // market order with rod (violates §4.1) AND a non-lot regular quantity (violates §4.6)
  const result = validateOrderTypeMatrix(
    baseOrder({ type: "market", timeInForce: "rod", price: null, quantity: 1500 })
  );
  assert.equal(result.ok, false);
  const codes = result.violations.map((v) => v.code).sort();
  assert.deepEqual(codes, ["LOT_QUANTITY_INVALID", "MARKET_ORDER_TIF_INVALID"]);
});

test("aggregate: session×orderCond + quantity double violation on odd-lot margin order", () => {
  const result = validateOrderTypeMatrix(
    baseOrder({
      session: "afterhours_odd",
      orderCond: "margin",
      timeInForce: "rod",
      quantity: 2000, // too big for an odd-lot session
      price: 605
    }),
    { refPrice: 600 }
  );
  assert.equal(result.ok, false);
  const codes = result.violations.map((v) => v.code).sort();
  assert.deepEqual(codes, ["ODD_LOT_CASH_ONLY", "ODD_LOT_QUANTITY_INVALID"]);
});
