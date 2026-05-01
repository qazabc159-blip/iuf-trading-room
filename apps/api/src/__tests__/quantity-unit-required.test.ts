/**
 * quantity-unit-required.test.ts — Item 1 safety gate
 *
 * Coverage:
 *   (a) Schema rejects payload missing quantity_unit → ZodError
 *   (b) Mapper: SHARE → oddLot=true
 *   (c) Mapper: LOT  → oddLot=false
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/quantity-unit-required.test.ts
 *
 * No DB. No broker. No HTTP.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateTaiwanStockNotional,
  paperOrderCreateInputSchema,
  toTaiwanStockShareCount
} from "@iuf-trading-room/contracts";
import { mapPaperIntentToKgiOrder } from "../domain/trading/paper-to-kgi-mapping.js";
import { createOrderIntent } from "../domain/trading/order-intent.js";

// ---------------------------------------------------------------------------
// (a) Schema rejects payload missing quantity_unit
// ---------------------------------------------------------------------------

test("schema rejects payload missing quantity_unit", () => {
  const result = paperOrderCreateInputSchema.safeParse({
    idempotencyKey: "test-key",
    symbol: "2330",
    side: "buy",
    orderType: "limit",
    qty: 1,
    price: 800,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    const hasQtyUnitIssue = result.error.issues.some((i) =>
      i.path.includes("quantity_unit")
    );
    assert.equal(hasQtyUnitIssue, true);
  }
});

test("schema rejects SHARE odd-lot qty >= 1000", () => {
  const result = paperOrderCreateInputSchema.safeParse({
    idempotencyKey: "test-key-share-1000",
    symbol: "2330",
    side: "buy",
    orderType: "limit",
    qty: 1000,
    quantity_unit: "SHARE",
    price: 800,
  });
  assert.equal(result.success, false);
});

test("notional helper keeps SHARE and LOT arithmetic separate", () => {
  assert.equal(toTaiwanStockShareCount(1, "SHARE"), 1);
  assert.equal(toTaiwanStockShareCount(1, "LOT"), 1000);
  assert.equal(estimateTaiwanStockNotional(800, 1, "SHARE"), 800);
  assert.equal(estimateTaiwanStockNotional(800, 1, "LOT"), 800_000);
});

// ---------------------------------------------------------------------------
// (b) Mapper: SHARE → oddLot=true
// ---------------------------------------------------------------------------

test("mapper: SHARE → oddLot=true", () => {
  const intent = createOrderIntent({
    idempotencyKey: "k1",
    symbol: "2330",
    side: "buy",
    orderType: "limit",
    qty: 1,
    quantity_unit: "SHARE",
    price: 800,
    userId: "00000000-0000-0000-0000-000000000001",
  });
  const kgi = mapPaperIntentToKgiOrder(intent);
  assert.equal(kgi.oddLot, true);
  assert.equal(kgi.qty, 1);
});

// ---------------------------------------------------------------------------
// (c) Mapper: LOT → oddLot=false
// ---------------------------------------------------------------------------

test("mapper: LOT → oddLot=false", () => {
  const intent = createOrderIntent({
    idempotencyKey: "k2",
    symbol: "2330",
    side: "buy",
    orderType: "limit",
    qty: 1,
    quantity_unit: "LOT",
    price: 800,
    userId: "00000000-0000-0000-0000-000000000002",
  });
  const kgi = mapPaperIntentToKgiOrder(intent);
  assert.equal(kgi.oddLot, false);
  assert.equal(kgi.qty, 1);
});
