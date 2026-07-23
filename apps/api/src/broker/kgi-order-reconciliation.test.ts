/**
 * kgi-order-reconciliation.test.ts
 *
 * Coverage: reconcileUnconfirmedAuditOrders() — the pure reconciliation-scan
 * core of the 2026-07-23 P0 fix for S1/V34/V51 SIM runners' 3x1.5s=4.5s
 * confirmation-polling timeout (settlement_confirmed 100%=0 for 8 straight
 * weeks — see reports/sim_go_live_20260723/).
 *
 * The `deals` fixture below is a trimmed, byte-faithful subset of the REAL
 * `/deals` response captured 2026-07-23 09:43 TST (~19 min after the
 * three-sleeve go-live batch), documented in
 * reports/sim_go_live_20260723/VISIBILITY_DIAGNOSIS_20260723.md — this is
 * exactly the "今天 53 單真成交資料" fixture/dry-run evidence the P0 dispatch
 * asked for: it proves that orders which a 4.5s poll would have permanently
 * marked "unconfirmed" DO resolve to "filled" once a later snapshot is
 * re-checked against them.
 *
 * Running these tests against the REAL fixture (not idealized synthetic
 * data) caught a second, independent latent bug while building this fix:
 * numberValue() turned "key absent" into a real `0` (JS `Number("")===0`)
 * instead of null, which defeated the `filledQty ?? requestedQty ?? 0`
 * fallback whenever real KGI deal evidence lacks an explicit filled_qty
 * field — which it always does (KGI uses "quantity", not "filled_qty").
 * Net effect: status could never advance past "accepted" for ANY real deal,
 * regardless of poll timing — this alone would have made the confirmation
 * cron ineffective even after fixing the 4.5s timeout. Fixed alongside this
 * PR's main fix (see numberValue() doc in kgi-order-reconciliation.ts).
 *
 * No DB. No broker. No HTTP — pure function coverage only.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { reconcileKgiOrder, reconcileUnconfirmedAuditOrders, type UnconfirmedAuditOrder } from "./kgi-order-reconciliation.js";

// Trimmed real /deals payload (2026-07-23 09:43 TST complete recheck) — see
// module doc. Keys are symbol; each value is the KGI Deal array for that
// symbol. order_id is KGI's own assigned id (matches what a runner's poll
// loop observes once /trades or /events surfaces it for the tradeId it's
// tracking).
const REAL_DEALS_20260723 = {
  "6901": [
    {
      task: "Deal", order_id: "Y001B", seqno: "00005830", action: "B",
      symbol: "6901", quantity: 5, price: 19.25, ts: "092446",
    },
  ],
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

test("reconcileUnconfirmedAuditOrders: orders with a matching real deal resolve to filled (the P0 fix)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001B", symbol: "6901", shares: 5 },
    { index: 1, tradeId: "Y001R", symbol: "1808", shares: 1 },
  ];

  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });

  assert.equal(resolutions.length, 2, "both orders have real matching deals and must resolve");

  const bySym = new Map(resolutions.map((r) => [unconfirmed[r.index].symbol, r.reconciled]));
  const r6901 = bySym.get("6901")!;
  assert.equal(r6901.status, "filled");
  assert.equal(r6901.filledQty, 5);
  assert.equal(r6901.avgFillPrice, 19.25);
  assert.equal(r6901.settlementConfirmed, true);
  assert.equal(r6901.settlementSource, "deal");

  const r1808 = bySym.get("1808")!;
  assert.equal(r1808.status, "filled");
  assert.equal(r1808.filledQty, 1);
  assert.equal(r1808.avgFillPrice, 35.1);
});

test("reconcileUnconfirmedAuditOrders: two distinct orders on the same symbol each match their OWN tradeId's deal, not each other's", () => {
  // 5522 has two real deal rows (Y001C and Y001T — two separate 1-share
  // orders sent minutes apart, not one order's partial fills). Matching by
  // tradeId must keep them apart.
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001C", symbol: "5522", shares: 1 },
    { index: 1, tradeId: "Y001T", symbol: "5522", shares: 1 },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 2);
  for (const r of resolutions) {
    assert.equal(r.reconciled.filledQty, 1);
    assert.equal(r.reconciled.status, "filled");
    assert.equal(r.reconciled.avgFillPrice, 72.7);
  }
});

test("reconcileUnconfirmedAuditOrders: order with no matching deal evidence yet stays unresolved (omitted, not force-marked confirmed)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y0099", symbol: "2330", shares: 1 }, // no evidence anywhere in the fixture
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 0, "no fabricated confirmation without real evidence");
});

test("reconcileUnconfirmedAuditOrders: real genuine broker rejection (MAT0015) resolves to rejected, not silently dropped", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "00005843", symbol: "1271", shares: 0 },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { trades: REAL_REJECTED_20260723 });
  assert.equal(resolutions.length, 1);
  assert.equal(resolutions[0].reconciled.status, "rejected");
  assert.equal(resolutions[0].reconciled.settlementConfirmed, true);
});

test("reconcileUnconfirmedAuditOrders: orders without a tradeId are skipped (nothing to match)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: null, symbol: "6901", shares: 5 },
  ];
  const resolutions = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.equal(resolutions.length, 0);
});

test("reconcileUnconfirmedAuditOrders: idempotent — re-running against the same evidence produces the same resolution (no duplicate side effects)", () => {
  const unconfirmed: UnconfirmedAuditOrder[] = [
    { index: 0, tradeId: "Y001B", symbol: "6901", shares: 5 },
  ];
  const first = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  const second = reconcileUnconfirmedAuditOrders(unconfirmed, { deals: REAL_DEALS_20260723 });
  assert.deepEqual(first, second, "same input + same evidence must yield the same resolution every time");
});

test("reconcileUnconfirmedAuditOrders: empty input returns empty output (cheap no-op tick)", () => {
  assert.deepEqual(reconcileUnconfirmedAuditOrders([], { deals: REAL_DEALS_20260723 }), []);
});

// ---------------------------------------------------------------------------
// numberValue() regression (found via this PR's real-fixture testing, not
// a synthetic case): a deal row with NO explicit filled_qty/deal_qty field
// (the real KGI shape — only "quantity") must still produce a correct
// non-zero filledQty and status="filled", not silently compute filledQty=0
// and get stuck at status="accepted" forever.
// ---------------------------------------------------------------------------

test("reconcileKgiOrder: real KGI deal shape (quantity field only, no filled_qty) resolves filledQty and status correctly", () => {
  const reconciled = reconcileKgiOrder({
    order: { tradeId: "Y001B", symbol: "6901", side: "buy", requestedQty: 5 },
    deals: REAL_DEALS_20260723,
  });
  assert.equal(reconciled.filledQty, 5, "must fall back to the quantity field, not silently compute 0");
  assert.equal(reconciled.status, "filled");
  assert.equal(reconciled.settlementConfirmed, true);
});
