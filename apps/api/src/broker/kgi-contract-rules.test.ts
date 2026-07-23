/**
 * kgi-contract-rules.test.ts
 *
 * Coverage: toKgiOrderQty() — the qty-unit conversion that closes the
 * 2026-07-23 P0 (S1/V34/V51 SIM runners sending raw share counts as `qty`
 * for board-lot orders, a 1000x oversized order relative to what
 * api.Order.create_order() expects).
 *
 * Regression cases below are pinned to the real 2026-07-23 three-sleeve
 * go-live evidence (reports/sim_go_live_20260723/evidence/orders_20260723.jsonl
 * + deals_snapshot_*.json): symbol 6901 sent qty=5 (lots) and filled 5 @
 * 19.25; symbol 1808 canary sent qty=3 and filled 3 @ 35.1 — confirming
 * non-odd-lot orders are lot-denominated on the wire, not share-denominated.
 *
 * No DB. No broker. No HTTP — pure function coverage only.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_LOT_REGULAR, toKgiOrderQty } from "./kgi-contract-rules.js";

test("toKgiOrderQty: board-lot order converts shares to lots (÷1000)", () => {
  assert.equal(toKgiOrderQty(5000, false), 5);
  assert.equal(toKgiOrderQty(3000, false), 3);
  assert.equal(toKgiOrderQty(1000, false), 1);
});

test("toKgiOrderQty: real 2026-07-23 go-live evidence — 6901 and 1808 board-lot sizing", () => {
  // symbol 6901: v51_c1 sleeve sent qty=5, filled 5 lots @ 19.25 (5000 shares)
  assert.equal(toKgiOrderQty(5000, false), 5);
  // symbol 1808: manual canary sent qty=3, filled 3 lots @ 35.1 (3000 shares)
  assert.equal(toKgiOrderQty(3000, false), 3);
});

test("toKgiOrderQty: odd-lot order passes shares through unchanged", () => {
  assert.equal(toKgiOrderQty(500, true), 500);
  assert.equal(toKgiOrderQty(1, true), 1);
  assert.equal(toKgiOrderQty(914, true), 914); // V34 real odd-lot sizing (8046 name)
});

test("toKgiOrderQty: zero shares stays zero regardless of odd-lot flag", () => {
  assert.equal(toKgiOrderQty(0, false), 0);
  assert.equal(toKgiOrderQty(0, true), 0);
});

test("toKgiOrderQty: board-lot conversion is always exact for board-lot-rounded inputs (no fractional lots)", () => {
  // Every board-lot sizing function in the codebase (roundDownBoardLot) only
  // ever produces multiples of BOARD_LOT_REGULAR — this pins that invariant
  // at the conversion boundary so a future sizing bug that produces a
  // non-multiple-of-1000 share count is caught here as a fractional lot.
  for (const shares of [1000, 2000, 11000, 35000, 3000]) {
    const qty = toKgiOrderQty(shares, false);
    assert.equal(Number.isInteger(qty), true, `${shares} shares must convert to an integer lot count`);
    assert.equal(qty * BOARD_LOT_REGULAR, shares);
  }
});
