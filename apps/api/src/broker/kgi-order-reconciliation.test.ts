/**
 * kgi-order-reconciliation.test.ts
 *
 * Coverage: reconcileUnconfirmedAuditOrders() / reconcileKgiOrder() — the
 * reconciliation-matching core of the 2026-07-23 P0 fix for S1/V34/V51 SIM
 * runners' 3x1.5s=4.5s confirmation-polling timeout (settlement_confirmed
 * 100%=0 for 8 straight weeks — see reports/sim_go_live_20260723/).
 *
 * Fixtures below are trimmed, byte-faithful subsets of the REAL `/deals` and
 * `/trades?full=true` responses captured 2026-07-23 09:24-09:43 TST during
 * the three-sleeve go-live batch — this is exactly the "今天 53 單真成交資料"
 * fixture/dry-run evidence the P0 dispatch asked for.
 *
 * 2026-07-23 Round 2 (Pete review PR #1345, NEEDS_FIX): Round 1's fixtures
 * used `shares` values equal to the WIRE lot count (e.g. `shares: 5` for
 * 6901, which really is 5000 SHARES / 5 LOTS) — this happened to sidestep
 * the exact bug Pete found (normalizeEvidence()/reconcileKgiOrder() treating
 * a board-lot deal's wire `quantity` field, which is in LOTS, as if it were
 * already SHARES, then comparing/summing it directly against the real
 * share-denominated `requestedQty` audit_logs actually stores). Every
 * `shares` value below is now the REAL production share count (matching
 * `reports/sim_go_live_20260723/evidence/orders_20260723.jsonl`), not the
 * wire lot count — this is the only way this class of bug can be caught by
 * a test at all.
 *
 * No DB. No broker. No HTTP — pure function coverage only.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileKgiOrder, reconcileUnconfirmedAuditOrders, type UnconfirmedAuditOrder } from "./kgi-order-reconciliation.js";

// Trimmed real /deals payload (2026-07-23 09:24-09:43 TST, multiple rechecks
// across the go-live window). Keys are symbol; each value is the KGI Deal
// array for that symbol. `quantity` is the WIRE unit — LOTS for board-lot
// orders (isOddLot=false), matching the real committed
// orders_20260723.jsonl `qty_lots` field, NOT the `shares` field.
const REAL_DEALS_20260723 = {
  // 6901: v51_c1 sleeve, sent qty=5 lots (real shares=5000, orders_20260723.jsonl
  // line 3). ONE deal row for the full 5 lots — a genuine full-fill case.
  "6901": [
    {
      task: "Deal", order_id: "Y001B", seqno: "00005830", action: "B",
      symbol: "6901", quantity: 5, price: 19.25, ts: "092446",
    },
  ],
  // 5522: TWO SEPARATE 1-lot orders (real shares=1000 each) sent a second
  // apart — not one order's partial fills. Matching by tradeId must keep
  // them apart despite sharing a symbol.
  "5522": [
    {
      task: "Deal", order_id: "Y001C", seqno: "00005831", action: "B",
      symbol: "5522", quantity: 1, price: 72.7, ts: "092446",
    },
    {
      task: "Deal", order_id: "Y001T", seqno: "00005849", action: "B",
      symbol: "5522", quantity: 1, price: 72.7, ts: "092447",
    },
  ],
  // 1808 (order Y001R, v51_c3 sleeve): sent qty=3 lots (real shares=3000) —
  // this is a REAL, GENUINE partial fill captured live: only 1 of the 3
  // lots (1000 of the 3000 real shares) had matched by snapshot time.
  "1808": [
    {
      task: "Deal", order_id: "Y001R", seqno: "00005847", action: "B",
      symbol: "1808", quantity: 1, price: 35.1, ts: "092447",
    },
  ],
};

// Real /trades?full=true "無效單" (invalid orders) entries for symbols that
// were rejected with a genuine broker error — these have no order_id/deal,
// only an operations[].status="Failed" entry with the KGI error code.
const REAL_REJECTED_20260723 = {
  無效單: [
    {
      order: { order_id: "0000", symbol: "1271", quantity: 0, price: 0 },
      order_status: { nid: null, status: null, deals: [] },
      operations: [{ nid: "00005843", task: "NewOrder", status: "Failed", msg: "|MAT0015 :..." }],
    },
  ],
};

// Odd-lot deal: NOT a literal captured wire event (today's go-live batch was
// sent by an external test script that treated every sleeve uniformly as
// board-lot, so no real odd-lot deal event exists in today's evidence) —
// constructed from V34's REAL committed sizing output for symbol 2330
// (v34-sim-runner.test.ts "real committed basket prices" test: 1,111,111.11
// budget / 2415 real close = 460 shares, isOddLot=true) plus that same real
// close price. Odd-lot wire quantity IS shares directly (no lot conversion),
// so this deal's `quantity` is genuinely share-denominated, matching what
// V34's real odd-lot submission path would report.
const REAL_ODD_LOT_DEAL_2330 = {
  "2330": [
    { task: "Deal", order_id: "Y0ODD", seqno: "00099001", action: "B", symbol: "2330", quantity: 460, price: 2415, ts: "093000" },
  ],
};

test("reconcileUnconfirmedAuditOrders: board-lot full fill resolves filledQty in real SHARES, not the wire lot count (the Round 2 fix)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001B", symbol: "6901", shares: 5000, isOddLot: false },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 1, "real matching deal must resolve");

  const r = resolutions[0].reconciled;
  assert.equal(r.status, "filled", "5000/5000 real shares filled must be status=filled, not stuck at partially_filled");
  assert.equal(r.filledQty, 5000, "wire quantity=5 lots must convert to 5000 shares, not stay 5");
  assert.equal(r.remainingQty, 0);
  assert.equal(r.avgFillPrice, 19.25, "price is already per-share — no conversion needed");
  assert.equal(r.settlementConfirmed, true);
  assert.equal(r.settlementSource, "deal");
});

test("reconcileUnconfirmedAuditOrders: REAL genuine partial fill (1808, 1000/3000 real shares) resolves to partially_filled with correct remaining", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001R", symbol: "1808", shares: 3000, isOddLot: false },
  ];
  // partially_filled counts as settlementConfirmed=true (see
  // ReconciledKgiOrder.settlementConfirmed) — this order still comes back
  // through the normal resolutions array, not filtered out.
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 1);
  const r = resolutions[0].reconciled;
  assert.equal(r.filledQty, 1000, "wire quantity=1 lot must convert to 1000 real shares, not stay 1");
  assert.equal(r.remainingQty, 2000, "3000 requested - 1000 filled = 2000 remaining shares, not 2999");
  assert.equal(r.status, "partially_filled");
  assert.equal(r.avgFillPrice, 35.1);
});

test("reconcileUnconfirmedAuditOrders: odd-lot deal is NOT converted (wire quantity already IS the real share count)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y0ODD", symbol: "2330", shares: 460, isOddLot: true },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_ODD_LOT_DEAL_2330 });
  assert.equal(resolutions.length, 1);
  const r = resolutions[0].reconciled;
  assert.equal(r.filledQty, 460, "odd-lot wire quantity is already shares — must NOT be multiplied by 1000");
  assert.equal(r.status, "filled");
  assert.equal(r.avgFillPrice, 2415);
});

test("reconcileUnconfirmedAuditOrders: two distinct board-lot orders on the same symbol each match their OWN tradeId's deal, not each other's", () => {
  // 5522 has two real deal rows (Y001C and Y001T — two separate 1000-share
  // orders sent minutes apart, not one order's partial fills). Matching by
  // tradeId must keep them apart.
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001C", symbol: "5522", shares: 1000, isOddLot: false },
    { index: 1, tradeId: "Y001T", symbol: "5522", shares: 1000, isOddLot: false },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 2);
  for (const r of resolutions) {
    assert.equal(r.reconciled.filledQty, 1000);
    assert.equal(r.reconciled.status, "filled");
    assert.equal(r.reconciled.avgFillPrice, 72.7);
  }
});

test("reconcileUnconfirmedAuditOrders: order with no matching deal evidence yet stays unresolved (omitted, not force-marked confirmed)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y0099", symbol: "2330", shares: 1000, isOddLot: false }, // no evidence anywhere in the fixture
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 0, "no fabricated confirmation without real evidence");
});

test("reconcileUnconfirmedAuditOrders: real genuine broker rejection (MAT0015) resolves to rejected, not silently dropped", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "00005843", symbol: "1271", shares: 0, isOddLot: false },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { trades: REAL_REJECTED_20260723 });
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].reconciled.status, "rejected");
  assert.equal(resolutions[0].reconciled.settlementConfirmed, true);
});

test("reconcileUnconfirmedAuditOrders: orders without a tradeId are skipped (nothing to match)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: null, symbol: "6901", shares: 5000, isOddLot: false },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 0);
});

test("reconcileUnconfirmedAuditOrders: idempotent — re-running against the same evidence produces the same resolution (no duplicate side effects)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001B", symbol: "6901", shares: 5000, isOddLot: false },
  ];
  const first = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  const second = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.deepEqual(first, second, "same input + same evidence must yield the same resolution every time");
});

test("reconcileUnconfirmedAuditOrders: empty input returns empty output (cheap no-op tick)", () => {
  assert.deepEqual(reconcileUnconfirmedAuditOrders([], { deals: REAL_DEALS_20260723 }), []);
});

// ---------------------------------------------------------------------------
// Pete's exact repro (PR #1345 review comment) — pinned verbatim as a
// regression test: reconcileKgiOrder() called directly with the real 6901
// fixture and the REAL requestedQty (5000 shares, not the wire lot count 5)
// used to return filledQty:5, status:"partially_filled" — wrong by 1000x,
// and NOT self-healing because status leaving "unconfirmed" would have
// permanently excluded it from every subsequent reconcile-cron tick's
// filter (`status === "unconfirmed"`). This never shipped (caught in
// review before merge — no corrupted audit_logs rows exist), but the
// scenario itself must stay closed going forward.
// ---------------------------------------------------------------------------

test("reconcileKgiOrder: Pete's exact repro — real requestedQty=5000 (not wire lots=5) must resolve to filled, not partially_filled", () => {
  const reconciled = reconcileKgiOrder({
    order: { tradeId: "Y001B", symbol: "6901", side: "buy", requestedQty: 5000, wireQtyUnit: "lots" },
    deals: REAL_DEALS_20260723,
  });
  assert.equal(reconciled.filledQty, 5000);
  assert.equal(reconciled.remainingQty, 0);
  assert.equal(reconciled.status, "filled", "must not be stuck at partially_filled (Pete's exact finding)");
  assert.equal(reconciled.settlementConfirmed, true);
});

// ---------------------------------------------------------------------------
// numberValue() regression (found via this PR's Round 1 real-fixture
// testing, not a synthetic case): a deal row with NO explicit filled_qty/
// deal_qty field (the real KGI shape — only "quantity") must still produce
// a correct non-zero filledQty and status="filled", not silently compute
// filledQty=0 and get stuck at status="accepted" forever.
// ---------------------------------------------------------------------------

test("reconcileKgiOrder: real KGI deal shape (quantity field only, no filled_qty) resolves filledQty and status correctly", () => {
  const reconciled = reconcileKgiOrder({
    order: { tradeId: "Y001B", symbol: "6901", side: "buy", requestedQty: 5000, wireQtyUnit: "lots" },
    deals: REAL_DEALS_20260723,
  });
  assert.equal(reconciled.filledQty, 5000, "must fall back to the quantity field, not silently compute 0");
  assert.equal(reconciled.status, "filled");
  assert.equal(reconciled.settlementConfirmed, true);
});

// ---------------------------------------------------------------------------
// wireQtyUnit defaults to "shares" (no conversion) when omitted — this is
// the backward-compatibility guarantee for callers outside this PR's scope
// (kgi-sim-env.ts's smoke-test probe, syncKgiUnifiedOrders' unified_orders
// sync) that do NOT pass wireQtyUnit: their behavior must be byte-identical
// to before this Round 2 fix existed.
// ---------------------------------------------------------------------------

test("reconcileKgiOrder: wireQtyUnit omitted defaults to no conversion (preserves exact behavior for callers outside this PR's scope)", () => {
  const reconciled = reconcileKgiOrder({
    order: { tradeId: "Y001B", symbol: "6901", side: "buy", requestedQty: 5 }, // no wireQtyUnit
    deals: REAL_DEALS_20260723,
  });
  // Matches Round 1's (pre-Pete-review) already-shipped-elsewhere behavior:
  // wire quantity=5 treated as-is (no x1000), matched against requestedQty=5.
  assert.equal(reconciled.filledQty, 5);
  assert.equal(reconciled.status, "filled");
});
