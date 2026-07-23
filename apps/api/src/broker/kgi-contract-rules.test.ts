/**
 * kgi-contract-rules.test.ts
 *
 * Coverage: toKgiOrderQty() / fromKgiOrderQty() — the symmetric qty-unit
 * conversion pair that closes the 2026-07-23 P0 (S1/V34/V51 SIM runners
 * sending raw share counts as `qty` for board-lot orders, a 1000x oversized
 * order; plus the parse-side twin bug found by Pete's PR #1345 Round 2
 * review — reconcileKgiOrder() treating wire-lot deal quantities as if
 * already shares).
 *
 * Regression cases below are pinned to the real 2026-07-23 three-sleeve
 * go-live evidence (reports/sim_go_live_20260723/evidence/orders_20260723.jsonl
 * + deals_snapshot_*.json): symbol 6901 sent qty=5 (lots) and filled 5 @
 * 19.25 (real shares=5000); symbol 1808 (order Y001R) sent qty=3 (real
 * shares=3000) — confirming non-odd-lot orders are lot-denominated on the
 * wire, not share-denominated.
 *
 * No DB. No broker. No HTTP — pure function coverage only.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { BOARD_LOT_REGULAR, fromKgiOrderQty, toKgiOrderQty } from "./kgi-contract-rules.js";

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

// ---------------------------------------------------------------------------
// Defensive-gap documentation (Pete review PR #1345, 🟡 suggestion #2):
// toKgiOrderQty() has no throw/assert guard against non-1000-multiple
// board-lot input — today's three call sites (S1/V34/V51) all guarantee
// this via roundDownBoardLot, so it's unreachable today, but the function
// itself silently floors rather than erroring. This test makes that
// silent-floor behavior an explicit, intentional contract (not an
// unnoticed gap) so a future change to it is a deliberate decision, not an
// accidental regression.
// ---------------------------------------------------------------------------

test("toKgiOrderQty: non-1000-multiple board-lot input is silently floored (documented current behavior, not asserted-against — no caller today can trigger this)", () => {
  assert.equal(toKgiOrderQty(1500, false), 1, "1500 shares floors to 1 lot, dropping the extra 500 shares silently");
  assert.equal(toKgiOrderQty(2999, false), 2);
});

// ---------------------------------------------------------------------------
// fromKgiOrderQty() — the symmetric parse-side inverse, added 2026-07-23
// Round 2 (Pete review PR #1345). Both directions must always agree.
// ---------------------------------------------------------------------------

test("fromKgiOrderQty: board-lot wire quantity converts lots to shares (×1000)", () => {
  assert.equal(fromKgiOrderQty(5, false), 5000);
  assert.equal(fromKgiOrderQty(3, false), 3000);
  assert.equal(fromKgiOrderQty(1, false), 1000);
});

test("fromKgiOrderQty: real 2026-07-23 go-live evidence — 6901 full fill and 1808/Y001R partial fill", () => {
  // 6901: deal wire quantity=5 lots -> real shares filled=5000
  assert.equal(fromKgiOrderQty(5, false), 5000);
  // 1808 (Y001R): deal wire quantity=1 lot (partial fill of a 3-lot/3000-share
  // order) -> real shares filled=1000, not 1
  assert.equal(fromKgiOrderQty(1, false), 1000);
});

test("fromKgiOrderQty: odd-lot wire quantity passes through unchanged (already shares)", () => {
  assert.equal(fromKgiOrderQty(460, true), 460);
  assert.equal(fromKgiOrderQty(1, true), 1);
});

test("fromKgiOrderQty: zero wire quantity stays zero regardless of odd-lot flag", () => {
  assert.equal(fromKgiOrderQty(0, false), 0);
  assert.equal(fromKgiOrderQty(0, true), 0);
});

test("toKgiOrderQty and fromKgiOrderQty are exact inverses for board-lot and odd-lot alike", () => {
  for (const shares of [1000, 3000, 5000, 11000, 35000]) {
    assert.equal(fromKgiOrderQty(toKgiOrderQty(shares, false), false), shares);
  }
  for (const shares of [1, 460, 914, 999]) {
    assert.equal(fromKgiOrderQty(toKgiOrderQty(shares, true), true), shares);
  }
});
