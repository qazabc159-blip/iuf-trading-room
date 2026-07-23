/**
 * v34-sim-runner.test.ts
 *
 * Coverage:
 *   - Schema validation fail-closed cases (missing/extra column, wrong header
 *     order, label mismatch, planned_entry mismatch, invalid numeric fields)
 *   - Valid parse incl. UTF-8 BOM stripping + mixed per-row signal_date
 *     (allowed by design — see module doc, unlike V5-1's uniform-date rule)
 *   - Equal-weight 10M notional allocation + board-lot rounding
 *   - KGI subscription cap check (9 + 31 reserved = 40 pass; over cap fails)
 *   - Label passthrough (V34_LABEL constant + parsed rows carry it verbatim)
 *   - In-memory order-submit guard (claim/release, closes double-submission race)
 *   - Report JSON write failure tolerance (real fs failure, not mocked)
 *
 * No DB. No broker. No HTTP — pure function coverage only (the report-write
 * tests do real, scoped fs I/O against a temp dir / an intentionally invalid
 * path, cleaned up after each test — not network/DB/broker I/O).
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  _v34ClaimOrderSubmitTickForDate,
  _v34ReleaseOrderSubmitGuard,
  _v34WriteReportJsonBestEffort,
  checkV34KgiSubscriptionCap,
  computeV34OrderSizing,
  listEmbeddedV34BasketAsOfDates,
  nextWeekdayIso,
  parseV34BasketCsv,
  readV34BasketForDate,
  reconcileUnconfirmedV34Orders,
  V34_CAPITAL_TWD,
  V34_KGI_SUBSCRIPTION_CAP,
  V34_LABEL,
  V34_PLANNED_ENTRY,
  V34_RESERVED_SLOTS_OTHER_TRACKERS,
  type V34Basket,
  type V34BasketRow,
} from "./v34-sim-runner.js";
import { toKgiOrderQty } from "./broker/kgi-contract-rules.js";

const VALID_HEADER = "stock_id,signal_date,gh,days_since_high,wm60_twd,last_close,label,weight,planned_entry";
const ROW = (id: string, signalDate = "2026-07-09") =>
  `${id},${signalDate},0.98,3,10000000000,100.0,${V34_LABEL},0.1111111111111111,${V34_PLANNED_ENTRY}`;

function make9RowCsv(): string {
  const ids = ["2330", "8046", "2409", "6223", "6488", "6182", "6213", "8150", "3374"];
  return [VALID_HEADER, ...ids.map((id) => ROW(id))].join("\n");
}

// ---------------------------------------------------------------------------
// Schema validation — fail-closed cases
// ---------------------------------------------------------------------------

test("parseV34BasketCsv: rejects missing column", () => {
  const csv = "stock_id,signal_date,gh,days_since_high,wm60_twd,last_close,label,weight\n2330,2026-07-09,0.98,3,10000000000,100.0," + V34_LABEL + ",0.11";
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /schema_mismatch/);
});

test("parseV34BasketCsv: rejects wrong header order", () => {
  const csv = "signal_date,stock_id,gh,days_since_high,wm60_twd,last_close,label,weight,planned_entry\n2026-07-09,2330,0.98,3,10000000000,100.0," + V34_LABEL + ",0.11," + V34_PLANNED_ENTRY;
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /schema_mismatch/);
});

test("parseV34BasketCsv: rejects extra column", () => {
  const csv = VALID_HEADER + ",extra\n" + ROW("2330") + ",oops";
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
});

test("parseV34BasketCsv: rejects row with mismatched label", () => {
  const csv = [VALID_HEADER, "2330,2026-07-09,0.98,3,10000000000,100.0,SOMETHING_ELSE,0.11," + V34_PLANNED_ENTRY].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /label_mismatch/);
});

test("parseV34BasketCsv: rejects row with wrong planned_entry", () => {
  const csv = [VALID_HEADER, `2330,2026-07-09,0.98,3,10000000000,100.0,${V34_LABEL},0.11,market_open`].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unexpected_planned_entry/);
});

test("parseV34BasketCsv: rejects invalid gh", () => {
  const csv = [VALID_HEADER, `2330,2026-07-09,not_a_number,3,10000000000,100.0,${V34_LABEL},0.11,${V34_PLANNED_ENTRY}`].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid_gh/);
});

test("parseV34BasketCsv: rejects invalid days_since_high", () => {
  const csv = [VALID_HEADER, `2330,2026-07-09,0.98,-1,10000000000,100.0,${V34_LABEL},0.11,${V34_PLANNED_ENTRY}`].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid_days_since_high/);
});

test("parseV34BasketCsv: rejects invalid wm60_twd", () => {
  const csv = [VALID_HEADER, `2330,2026-07-09,0.98,3,0,100.0,${V34_LABEL},0.11,${V34_PLANNED_ENTRY}`].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid_wm60_twd/);
});

test("parseV34BasketCsv: rejects invalid last_close", () => {
  const csv = [VALID_HEADER, `2330,2026-07-09,0.98,3,10000000000,-5,${V34_LABEL},0.11,${V34_PLANNED_ENTRY}`].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid_last_close/);
});

test("parseV34BasketCsv: rejects invalid weight", () => {
  const csv = [VALID_HEADER, `2330,2026-07-09,0.98,3,10000000000,100.0,${V34_LABEL},not_a_number,${V34_PLANNED_ENTRY}`].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid_weight/);
});

test("parseV34BasketCsv: rejects empty/header-only csv", () => {
  const result = parseV34BasketCsv(VALID_HEADER, "test.csv", "2026-07-14");
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Valid parse + BOM stripping + label passthrough + mixed signal_date
// ---------------------------------------------------------------------------

test("parseV34BasketCsv: accepts valid 9-row basket and strips leading BOM", () => {
  const csv = "﻿" + make9RowCsv();
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.basket.rows.length, 9);
    assert.equal(result.basket.asOfDate, "2026-07-14");
    for (const row of result.basket.rows) {
      assert.equal(row.label, V34_LABEL);
      assert.equal(row.plannedEntry, V34_PLANNED_ENTRY);
    }
  }
});

test("parseV34BasketCsv: mixed per-row signal_date is accepted (by design — fresh oos_prices window)", () => {
  const rows = [
    ROW("2330", "2026-07-09"),
    ROW("6182", "2026-07-14"),
    ROW("3374", "2026-07-14"),
  ];
  const csv = [VALID_HEADER, ...rows].join("\n");
  const result = parseV34BasketCsv(csv, "test.csv", "2026-07-14");
  assert.equal(result.ok, true);
  if (result.ok) {
    const dates = new Set(result.basket.rows.map((r) => r.signalDate));
    assert.ok(dates.has("2026-07-09"));
    assert.ok(dates.has("2026-07-14"));
    // asOfDate is the file-name anchor, independent of per-row signal_date spread
    assert.equal(result.basket.asOfDate, "2026-07-14");
  }
});

// ---------------------------------------------------------------------------
// KGI subscription cap check (accounts for V5-1's 31 reserved slots)
// ---------------------------------------------------------------------------

function basketWithNSymbols(n: number): V34Basket {
  const rows = Array.from({ length: n }, (_, i) => ({
    stockId: String(1000 + i),
    signalDate: "2026-07-09",
    gh: 0.98,
    daysSinceHigh: 3,
    wm60Twd: 10_000_000_000,
    lastClose: 100,
    label: V34_LABEL,
    weight: 1 / n,
    plannedEntry: V34_PLANNED_ENTRY,
  }));
  return { schema: "v34_sim_shakedown_basket_v1", sourceFile: "test.csv", asOfDate: "2026-07-14", rows };
}

test("checkV34KgiSubscriptionCap: 9 basket names + 31 reserved (V5-1 30+0050) = 40, passes (contract arithmetic)", () => {
  const basket = basketWithNSymbols(9);
  const result = checkV34KgiSubscriptionCap(basket);
  assert.equal(result.ok, true);
  assert.equal(result.count, 40);
});

test("checkV34KgiSubscriptionCap: fail-closed when basket + reserved slots exceed 40", () => {
  const basket = basketWithNSymbols(10); // 10 + 31 = 41 > cap
  const result = checkV34KgiSubscriptionCap(basket);
  assert.equal(result.ok, false);
  assert.equal(result.count, 41);
  assert.match(result.error ?? "", /subscription_cap_exceeded/);
});

test("checkV34KgiSubscriptionCap: exactly at cap (9 names + 31 reserved = 40) passes", () => {
  const basket = basketWithNSymbols(V34_KGI_SUBSCRIPTION_CAP - V34_RESERVED_SLOTS_OTHER_TRACKERS);
  const result = checkV34KgiSubscriptionCap(basket);
  assert.equal(result.ok, true);
  assert.equal(result.count, V34_KGI_SUBSCRIPTION_CAP);
});

// ---------------------------------------------------------------------------
// Equal-weight 10M allocation + board-lot rounding
// ---------------------------------------------------------------------------

test("computeV34OrderSizing: 10M / 9 names = equal notional, board-lot rounded shares", () => {
  const basket = basketWithNSymbols(9);
  const lastCloses = new Map(basket.rows.map((r) => [r.stockId, { closePrice: 100 }]));
  const sized = computeV34OrderSizing(basket, lastCloses, V34_CAPITAL_TWD);

  const expectedPerName = V34_CAPITAL_TWD / 9; // 1,111,111.11
  for (const entry of sized) {
    assert.ok(Math.abs(entry.targetNotionalTwd - expectedPerName) < 0.01);
    // 1,111,111.11 / 100 = 11111.11 shares -> floor to nearest 1000 = 11000
    assert.equal(entry.targetShares, 11000);
    assert.equal(entry.isOddLot, false);
    assert.equal(entry.sizingNote, "ok");
  }
});

test("computeV34OrderSizing: missing last close is skipped (0 shares), not silently priced at 0", () => {
  const basket = basketWithNSymbols(2);
  const lastCloses = new Map([[basket.rows[0].stockId, { closePrice: 50 }]]); // 2nd symbol missing
  const sized = computeV34OrderSizing(basket, lastCloses, 1_000_000);

  const missing = sized.find((s) => s.stockId === basket.rows[1].stockId)!;
  assert.equal(missing.targetShares, 0);
  assert.equal(missing.isOddLot, false);
  assert.equal(missing.lastClosePrice, null);
  assert.equal(missing.sizingNote, "skipped_missing_last_close");
});

test("computeV34OrderSizing: budget below even 1-share odd-lot rounds to 0 shares with explicit note", () => {
  const basket = basketWithNSymbols(1);
  const lastCloses = new Map([[basket.rows[0].stockId, { closePrice: 10_000_000_000 }]]); // absurdly high price
  const sized = computeV34OrderSizing(basket, lastCloses, 1_000_000);
  assert.equal(sized[0].targetShares, 0);
  assert.equal(sized[0].isOddLot, true);
  assert.equal(sized[0].sizingNote, "sub_odd_lot_rounds_to_zero");
});

// ---------------------------------------------------------------------------
// Board-lot-preferred / odd-lot-fallback sizing against the REAL committed
// basket prices (2026-07-14, Pete review PR #1268 finding): the old
// floor-to-nearest-1000-only logic silently rounded 2330/8046/6223/6488 to 0
// shares because their equal-weight ~1.111M TWD budget can't afford even a
// single 1000-share board lot at these real closes — only 5/9 names and
// ~49.5% of the contracted notional would have entered. Hand-calculated
// (budget = 10,000,000/9 = 1,111,111.111... per name) against the exact
// prices in data/lab/sim_baskets/v34_sim_shakedown_basket_2026-07-14.csv —
// not the flat $100 fixture used by the test above, which was exactly what
// hid this bug (Pete's point: "28 個測試全用 $100 假價把這病遮掉了").
// ---------------------------------------------------------------------------

function realBasketRow(stockId: string, lastClose: number): V34BasketRow {
  return {
    stockId,
    signalDate: "2026-07-09",
    gh: 0.98,
    daysSinceHigh: 3,
    wm60Twd: 10_000_000_000,
    lastClose,
    label: V34_LABEL,
    weight: 1 / 9,
    plannedEntry: V34_PLANNED_ENTRY,
  };
}

// stockId -> real committed CSV close price (2026-07-14 basket)
const REAL_BASKET_PRICES: Array<[string, number]> = [
  ["2330", 2415.0],
  ["8046", 1215.0],
  ["2409", 31.45],
  ["6223", 7080.0],
  ["6488", 1350.0],
  ["6182", 186.5],
  ["6213", 385.0],
  ["8150", 117.0],
  ["3374", 365.5],
];

function realBasket(): V34Basket {
  return {
    schema: "v34_sim_shakedown_basket_v1",
    sourceFile: "v34_sim_shakedown_basket_2026-07-14.csv",
    asOfDate: "2026-07-14",
    rows: REAL_BASKET_PRICES.map(([id, price]) => realBasketRow(id, price)),
  };
}

test("computeV34OrderSizing: real committed basket prices — all 9 names get > 0 shares (Pete finding: 4/9 previously rounded to 0)", () => {
  const basket = realBasket();
  const lastCloses = new Map(REAL_BASKET_PRICES.map(([id, price]) => [id, { closePrice: price }]));
  const sized = computeV34OrderSizing(basket, lastCloses, V34_CAPITAL_TWD);

  // Hand-calculated expected shares (budget=1,111,111.111... per name; floor to
  // nearest 1000 when affordable, else floor to the odd-lot share count):
  const expected: Record<string, { shares: number; isOddLot: boolean }> = {
    "2330": { shares: 460, isOddLot: true },     // 1,111,111.11/2415   = 460.09  -> odd lot 460
    "8046": { shares: 914, isOddLot: true },     // 1,111,111.11/1215   = 914.49  -> odd lot 914
    "2409": { shares: 35000, isOddLot: false },  // 1,111,111.11/31.45  = 35329.6 -> board lot 35000
    "6223": { shares: 156, isOddLot: true },     // 1,111,111.11/7080   = 156.94  -> odd lot 156
    "6488": { shares: 823, isOddLot: true },     // 1,111,111.11/1350   = 823.05  -> odd lot 823
    "6182": { shares: 5000, isOddLot: false },   // 1,111,111.11/186.5  = 5957.7  -> board lot 5000
    "6213": { shares: 2000, isOddLot: false },   // 1,111,111.11/385    = 2886.0  -> board lot 2000
    "8150": { shares: 9000, isOddLot: false },   // 1,111,111.11/117    = 9496.7  -> board lot 9000
    "3374": { shares: 3000, isOddLot: false },   // 1,111,111.11/365.5  = 3040.0  -> board lot 3000
  };

  assert.equal(sized.length, 9, "all 9 names must be sized");
  let totalCommittedTwd = 0;
  for (const entry of sized) {
    const exp = expected[entry.stockId];
    assert.ok(exp, `unexpected stockId ${entry.stockId}`);
    assert.ok(entry.targetShares > 0, `${entry.stockId}: must get > 0 shares (Pete finding — was silently 0 before this fix)`);
    assert.equal(entry.targetShares, exp.shares, `${entry.stockId}: expected ${exp.shares} shares`);
    assert.equal(entry.isOddLot, exp.isOddLot, `${entry.stockId}: expected isOddLot=${exp.isOddLot}`);
    totalCommittedTwd += entry.targetShares * (entry.lastClosePrice ?? 0);
  }

  // Total committed notional must stay within the 10M contracted budget, and
  // close to it (previously only ~49.5% actually committed with the 4 zeroed names).
  assert.ok(totalCommittedTwd <= V34_CAPITAL_TWD, `total committed ${totalCommittedTwd} must not exceed capital ${V34_CAPITAL_TWD}`);
  assert.ok(totalCommittedTwd > V34_CAPITAL_TWD * 0.9, `total committed ${totalCommittedTwd} should be close to equal-weight (>90% of ${V34_CAPITAL_TWD})`);
});

// ---------------------------------------------------------------------------
// qty-unit regression (2026-07-23 P0 fix): board-lot entries (isOddLot=false)
// must convert to LOTS (÷1000) before being sent as createOrder({ qty });
// odd-lot entries (isOddLot=true) keep the raw share count. Pins both
// branches against the real committed basket sizing above.
// ---------------------------------------------------------------------------

test("qty-unit fix: real committed basket sizing converts board-lot entries to lots, odd-lot entries pass through as shares", () => {
  const basket = realBasket();
  const lastCloses = new Map(REAL_BASKET_PRICES.map(([id, price]) => [id, { closePrice: price }]));
  const sized = computeV34OrderSizing(basket, lastCloses, V34_CAPITAL_TWD);

  const expectedQty: Record<string, number> = {
    "2330": 460,    // odd lot -> shares pass through
    "8046": 914,    // odd lot -> shares pass through
    "2409": 35,     // board lot 35000 shares -> 35 lots
    "6223": 156,    // odd lot -> shares pass through
    "6488": 823,    // odd lot -> shares pass through
    "6182": 5,      // board lot 5000 shares -> 5 lots
    "6213": 2,      // board lot 2000 shares -> 2 lots
    "8150": 9,      // board lot 9000 shares -> 9 lots
    "3374": 3,      // board lot 3000 shares -> 3 lots
  };
  for (const entry of sized) {
    const qty = toKgiOrderQty(entry.targetShares, entry.isOddLot);
    assert.equal(qty, expectedQty[entry.stockId], `${entry.stockId}: expected qty ${expectedQty[entry.stockId]}`);
  }
});

// ---------------------------------------------------------------------------
// reconcileUnconfirmedV34Orders() — the 2026-07-23 P0 reconciliation cron
// wrapper. Test env runs in memory mode (no DATABASE_URL/PERSISTENCE_MODE=
// database), so this exercises the fail-safe no-op contract: never throws,
// always returns a well-formed zeroed summary, makes no gateway call.
// ---------------------------------------------------------------------------

test("reconcileUnconfirmedV34Orders: no-ops safely (returns zeroed summary, no throw) when not in database mode", async () => {
  const summary = await reconcileUnconfirmedV34Orders();
  assert.equal(summary.auditRowFound, false);
  assert.equal(summary.ordersUnconfirmed, 0);
  assert.equal(summary.ordersNewlyConfirmed, 0);
  assert.equal(summary.gatewayUnreachable, false);
  assert.equal(summary.skippedGatewayScheduledOff, false);
});

// ---------------------------------------------------------------------------
// Entry-date computation
// ---------------------------------------------------------------------------

test("nextWeekdayIso: Tuesday as-of date -> Wednesday entry date (2026-07-14 -> 2026-07-15)", () => {
  assert.equal(nextWeekdayIso("2026-07-14"), "2026-07-15");
});

test("nextWeekdayIso: Friday as-of date skips weekend -> next Monday", () => {
  // 2026-07-17 is a Friday.
  assert.equal(nextWeekdayIso("2026-07-17"), "2026-07-20");
});

// ---------------------------------------------------------------------------
// In-memory in-flight guard — closes the double-submission race window
// (mirrors V5-1 / PR #1247 review blocker 1 fix).
// ---------------------------------------------------------------------------

test("order-submit guard: overlapping tick for the same entry date — only the first claim succeeds", () => {
  _v34ReleaseOrderSubmitGuard();
  try {
    const firstTickClaims = _v34ClaimOrderSubmitTickForDate("2026-07-15");
    const secondTickClaims = _v34ClaimOrderSubmitTickForDate("2026-07-15");
    assert.equal(firstTickClaims, true, "first tick must be allowed to proceed to submit");
    assert.equal(secondTickClaims, false, "second overlapping tick for the same date must NOT be allowed to submit again");
  } finally {
    _v34ReleaseOrderSubmitGuard();
  }
});

test("order-submit guard: a different entry date is not blocked by a prior day's claim", () => {
  _v34ReleaseOrderSubmitGuard();
  try {
    assert.equal(_v34ClaimOrderSubmitTickForDate("2026-07-15"), true);
    assert.equal(_v34ClaimOrderSubmitTickForDate("2026-08-11"), true);
  } finally {
    _v34ReleaseOrderSubmitGuard();
  }
});

test("order-submit guard: release allows a subsequent tick to retry the same date", () => {
  _v34ReleaseOrderSubmitGuard();
  try {
    assert.equal(_v34ClaimOrderSubmitTickForDate("2026-07-15"), true);
    _v34ReleaseOrderSubmitGuard();
    assert.equal(_v34ClaimOrderSubmitTickForDate("2026-07-15"), true, "after release, the same date must be claimable again");
  } finally {
    _v34ReleaseOrderSubmitGuard();
  }
});

// ---------------------------------------------------------------------------
// Report JSON write failure tolerance
// ---------------------------------------------------------------------------

test("report JSON write: a real fs failure (NUL-byte path) is caught, recorded in failsafeNotes, and does not throw", async () => {
  const notes: string[] = [];
  const invalidPath = join(process.cwd(), "v34-test-\0-invalid", "report.json");
  await assert.doesNotReject(() => _v34WriteReportJsonBestEffort(invalidPath, { ok: true }, notes));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /report_json_write_failed/);
});

// ---------------------------------------------------------------------------
// Real embedded basket file — the actual production data path (data/lab/
// sim_baskets/v34_sim_shakedown_basket_2026-07-14.csv, committed into this
// repo). Verifies the real Lab-produced CSV bytes parse cleanly under the
// strict schema gate above, and that the scheduler's directory scan finds it.
// ---------------------------------------------------------------------------

test("readV34BasketForDate: real embedded 2026-07-14 shakedown basket parses cleanly (9 rows, cap-checks OK)", async () => {
  const result = await readV34BasketForDate("2026-07-14");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.basket.rows.length, 9);
    for (const row of result.basket.rows) {
      assert.equal(row.label, V34_LABEL);
      assert.equal(row.plannedEntry, V34_PLANNED_ENTRY);
    }
    const capCheck = checkV34KgiSubscriptionCap(result.basket);
    assert.equal(capCheck.ok, true);
    assert.equal(capCheck.count, 40);
  }
});

test("listEmbeddedV34BasketAsOfDates: finds the real 2026-07-14 basket file", async () => {
  const dates = await listEmbeddedV34BasketAsOfDates();
  assert.ok(dates.includes("2026-07-14"));
});

test("report JSON write: success path writes the real file and leaves failsafeNotes untouched", async () => {
  const notes: string[] = [];
  const tmpDir = await fs.mkdtemp(join(tmpdir(), "v34-test-"));
  try {
    const path = join(tmpDir, "nested", "report.json");
    await _v34WriteReportJsonBestEffort(path, { ok: true }, notes);
    assert.equal(notes.length, 0);
    const written = JSON.parse(await fs.readFile(path, "utf-8"));
    assert.deepEqual(written, { ok: true });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
