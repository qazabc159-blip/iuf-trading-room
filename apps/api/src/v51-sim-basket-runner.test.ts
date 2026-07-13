/**
 * v51-sim-basket-runner.test.ts
 *
 * Coverage:
 *   - Schema validation fail-closed cases (missing/extra column, wrong header
 *     order, label mismatch, entry_rule mismatch, mixed signal dates)
 *   - Valid parse incl. UTF-8 BOM stripping (real Lab csv writer emits utf-8-sig)
 *   - Equal-weight 10M notional allocation + board-lot rounding
 *   - KGI subscription cap check (30+0050=31 pass; >40 fail-closed)
 *   - Label passthrough (V51_LABEL constant + parsed rows carry it verbatim)
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
  _v51ClaimOrderSubmitTickForDate,
  _v51ReleaseOrderSubmitGuard,
  _v51WriteReportJsonBestEffort,
  checkKgiSubscriptionCap,
  computeV51OrderSizing,
  nextWeekdayIso,
  parseV51BasketCsv,
  V51_BENCHMARK_RESERVED_SYMBOLS,
  V51_CAPITAL_TWD,
  V51_ENTRY_RULE,
  V51_KGI_SUBSCRIPTION_CAP,
  V51_LABEL,
  type V51Basket,
} from "./v51-sim-basket-runner.js";

const VALID_HEADER = "stock_id,weight,signal,signal_date,entry_rule,label";
const ROW = (id: string) =>
  `${id},0.033333,yoy=1.0,2026-07-13,next_trading_day_open,${V51_LABEL}`;

function make30RowCsv(): string {
  const ids = Array.from({ length: 30 }, (_, i) => String(1000 + i));
  return [VALID_HEADER, ...ids.map(ROW)].join("\n");
}

// ---------------------------------------------------------------------------
// Schema validation — fail-closed cases
// ---------------------------------------------------------------------------

test("parseV51BasketCsv: rejects missing column", () => {
  const csv = "stock_id,weight,signal,signal_date,entry_rule\n1808,0.03,yoy=1,2026-07-13,next_trading_day_open";
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /schema_mismatch/);
});

test("parseV51BasketCsv: rejects wrong header order", () => {
  const csv = "weight,stock_id,signal,signal_date,entry_rule,label\n0.03,1808,yoy=1,2026-07-13,next_trading_day_open," + V51_LABEL;
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /schema_mismatch/);
});

test("parseV51BasketCsv: rejects extra column", () => {
  const csv = VALID_HEADER + ",extra\n" + ROW("1808") + ",oops";
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
});

test("parseV51BasketCsv: rejects row with mismatched label", () => {
  const csv = [VALID_HEADER, "1808,0.033333,yoy=1.0,2026-07-13,next_trading_day_open,SOMETHING_ELSE"].join("\n");
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /label_mismatch/);
});

test("parseV51BasketCsv: rejects row with wrong entry_rule", () => {
  const csv = [VALID_HEADER, `1808,0.033333,yoy=1.0,2026-07-13,market_open,${V51_LABEL}`].join("\n");
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /unexpected_entry_rule/);
});

test("parseV51BasketCsv: rejects mixed signal dates within one file", () => {
  const csv = [
    VALID_HEADER,
    `1808,0.033333,yoy=1.0,2026-07-13,next_trading_day_open,${V51_LABEL}`,
    `6219,0.033333,yoy=1.0,2026-07-14,next_trading_day_open,${V51_LABEL}`,
  ].join("\n");
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /mixed_signal_dates/);
});

test("parseV51BasketCsv: rejects empty/header-only csv", () => {
  const result = parseV51BasketCsv(VALID_HEADER, "test.csv");
  assert.equal(result.ok, false);
});

test("parseV51BasketCsv: rejects invalid weight", () => {
  const csv = [VALID_HEADER, `1808,not_a_number,yoy=1.0,2026-07-13,next_trading_day_open,${V51_LABEL}`].join("\n");
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid_weight/);
});

// ---------------------------------------------------------------------------
// Valid parse + BOM stripping + label passthrough
// ---------------------------------------------------------------------------

test("parseV51BasketCsv: accepts valid 30-row basket and strips leading BOM", () => {
  const csv = "﻿" + make30RowCsv();
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.basket.rows.length, 30);
    assert.equal(result.basket.signalDate, "2026-07-13");
    // label passthrough — every row carries the mandatory label verbatim
    for (const row of result.basket.rows) {
      assert.equal(row.label, V51_LABEL);
      assert.equal(row.entryRule, V51_ENTRY_RULE);
    }
  }
});

test("parseV51BasketCsv: real embedded Lab csv bytes (BOM + CRLF-agnostic) parse cleanly", () => {
  // Mirrors the exact bytes the Lab csv writer produces (utf-8-sig).
  const csv = "﻿" + [VALID_HEADER, `1808,0.033333,yoy=1625.3727,2026-07-13,next_trading_day_open,${V51_LABEL}`].join("\r\n");
  const result = parseV51BasketCsv(csv, "test.csv");
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// KGI subscription cap check
// ---------------------------------------------------------------------------

function basketWithNSymbols(n: number): V51Basket {
  const rows = Array.from({ length: n }, (_, i) => ({
    stockId: String(1000 + i),
    weight: 1 / n,
    signal: "yoy=1.0",
    signalDate: "2026-07-13",
    entryRule: V51_ENTRY_RULE,
    label: V51_LABEL,
  }));
  return { schema: "v51_sim_basket_v1", sourceFile: "test.csv", signalDate: "2026-07-13", rows };
}

test("checkKgiSubscriptionCap: 30 basket names + reserved 0050 = 31, passes (Elva sign-off §2)", () => {
  const basket = basketWithNSymbols(30);
  const result = checkKgiSubscriptionCap(basket);
  assert.equal(result.ok, true);
  assert.equal(result.count, 31);
  assert.ok(V51_BENCHMARK_RESERVED_SYMBOLS.every((s) => result.symbols.includes(s)));
});

test("checkKgiSubscriptionCap: fail-closed when basket + reserved symbols exceed 40", () => {
  const basket = basketWithNSymbols(40); // 40 + 1 reserved = 41 > cap
  const result = checkKgiSubscriptionCap(basket);
  assert.equal(result.ok, false);
  assert.equal(result.count, 41);
  assert.match(result.error ?? "", /subscription_cap_exceeded/);
});

test("checkKgiSubscriptionCap: exactly at cap (39 names + 1 reserved = 40) passes", () => {
  const basket = basketWithNSymbols(V51_KGI_SUBSCRIPTION_CAP - 1);
  const result = checkKgiSubscriptionCap(basket);
  assert.equal(result.ok, true);
  assert.equal(result.count, V51_KGI_SUBSCRIPTION_CAP);
});

// ---------------------------------------------------------------------------
// Equal-weight 10M allocation + board-lot rounding
// ---------------------------------------------------------------------------

test("computeV51OrderSizing: 10M / 30 names = equal notional, board-lot rounded shares", () => {
  const basket = basketWithNSymbols(30);
  const lastCloses = new Map(basket.rows.map((r) => [r.stockId, { closePrice: 100 }]));
  const sized = computeV51OrderSizing(basket, lastCloses, V51_CAPITAL_TWD);

  const expectedPerName = V51_CAPITAL_TWD / 30; // 333,333.33
  for (const entry of sized) {
    assert.ok(Math.abs(entry.targetNotionalTwd - expectedPerName) < 0.01);
    // 333,333.33 / 100 = 3333.33 shares -> floor to nearest 1000 = 3000
    assert.equal(entry.targetShares, 3000);
    assert.equal(entry.sizingNote, "ok");
  }
});

test("computeV51OrderSizing: missing last close is skipped (0 shares), not silently priced at 0", () => {
  const basket = basketWithNSymbols(2);
  const lastCloses = new Map([[basket.rows[0].stockId, { closePrice: 50 }]]); // 2nd symbol missing
  const sized = computeV51OrderSizing(basket, lastCloses, 1_000_000);

  const missing = sized.find((s) => s.stockId === basket.rows[1].stockId)!;
  assert.equal(missing.targetShares, 0);
  assert.equal(missing.lastClosePrice, null);
  assert.equal(missing.sizingNote, "skipped_missing_last_close");
});

test("computeV51OrderSizing: sub-board-lot allocation rounds down to 0 shares with explicit note", () => {
  const basket = basketWithNSymbols(1);
  const lastCloses = new Map([[basket.rows[0].stockId, { closePrice: 10_000_000 }]]); // absurdly high price
  const sized = computeV51OrderSizing(basket, lastCloses, 1_000_000);
  assert.equal(sized[0].targetShares, 0);
  assert.equal(sized[0].sizingNote, "sub_board_lot_rounds_to_zero");
});

// ---------------------------------------------------------------------------
// Entry-date computation
// ---------------------------------------------------------------------------

test("nextWeekdayIso: Monday signal_date -> Tuesday entry date (2026-07-13 -> 2026-07-14)", () => {
  assert.equal(nextWeekdayIso("2026-07-13"), "2026-07-14");
});

test("nextWeekdayIso: Friday signal_date skips weekend -> next Monday", () => {
  // 2026-07-17 is a Friday.
  assert.equal(nextWeekdayIso("2026-07-17"), "2026-07-20");
});

// ---------------------------------------------------------------------------
// In-memory in-flight guard — closes the double-submission race window
// (PR #1247 review blocker 1). These exercise the exact synchronous claim/
// release primitive runV51OrderSubmitTick() calls before any `await`, not a
// re-implementation of the check.
// ---------------------------------------------------------------------------

test("order-submit guard: overlapping tick for the same entry date — only the first claim succeeds", () => {
  _v51ReleaseOrderSubmitGuard(); // clean slate regardless of test execution order
  try {
    // Simulates two setInterval ticks landing inside the same 08:20-08:40
    // window before the first tick's async work (DB check + submit +
    // audit write) has resolved.
    const firstTickClaims = _v51ClaimOrderSubmitTickForDate("2026-07-14");
    const secondTickClaims = _v51ClaimOrderSubmitTickForDate("2026-07-14");
    assert.equal(firstTickClaims, true, "first tick must be allowed to proceed to submit");
    assert.equal(secondTickClaims, false, "second overlapping tick for the same date must NOT be allowed to submit again");
  } finally {
    _v51ReleaseOrderSubmitGuard();
  }
});

test("order-submit guard: a different entry date is not blocked by a prior day's claim (does not block next-month baskets)", () => {
  _v51ReleaseOrderSubmitGuard();
  try {
    assert.equal(_v51ClaimOrderSubmitTickForDate("2026-07-14"), true);
    assert.equal(_v51ClaimOrderSubmitTickForDate("2026-08-11"), true);
  } finally {
    _v51ReleaseOrderSubmitGuard();
  }
});

test("order-submit guard: release allows a subsequent tick to retry the same date (mirrors s1-sim-runner.ts's retryable-failure reset)", () => {
  _v51ReleaseOrderSubmitGuard();
  try {
    assert.equal(_v51ClaimOrderSubmitTickForDate("2026-07-14"), true);
    _v51ReleaseOrderSubmitGuard();
    assert.equal(_v51ClaimOrderSubmitTickForDate("2026-07-14"), true, "after release, the same date must be claimable again");
  } finally {
    _v51ReleaseOrderSubmitGuard();
  }
});

// ---------------------------------------------------------------------------
// Report JSON write failure tolerance — a residual gap found during Elva's
// merge review of the guard fix above: if the report-JSON write throws
// AFTER orders have already been submitted to KGI SIM, the exception used to
// propagate up to runV51OrderSubmitTick()'s catch, which unconditionally
// releases the guard with no audit_logs row written — re-submitting the
// whole already-filled basket on the next tick. These exercise the real
// writeJson() failure path (a NUL-byte path is a genuine, portable fs
// failure — not a mock) through the wrapper the runner actually calls.
// ---------------------------------------------------------------------------

test("report JSON write: a real fs failure (NUL-byte path) is caught, recorded in failsafeNotes, and does not throw", async () => {
  const notes: string[] = [];
  const invalidPath = join(process.cwd(), "v51-test-\0-invalid", "report.json");
  await assert.doesNotReject(() => _v51WriteReportJsonBestEffort(invalidPath, { ok: true }, notes));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /report_json_write_failed/);
});

test("report JSON write: success path writes the real file and leaves failsafeNotes untouched", async () => {
  const notes: string[] = [];
  const tmpDir = await fs.mkdtemp(join(tmpdir(), "v51-test-"));
  try {
    const path = join(tmpDir, "nested", "report.json");
    await _v51WriteReportJsonBestEffort(path, { ok: true }, notes);
    assert.equal(notes.length, 0);
    const written = JSON.parse(await fs.readFile(path, "utf-8"));
    assert.deepEqual(written, { ok: true });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
