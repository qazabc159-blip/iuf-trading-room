/**
 * fundamentals-finmind-sync.test.ts — BLOCK #4 PR A: 4 happy-path unit tests
 *
 * T1: runMonthlyRevenueSync — killswitch_on skips with reason
 * T2: runMonthlyRevenueSync — no token returns skipped=no_token
 * T3: withFinMindRetry — retries on throw, succeeds on 2nd attempt
 * T4: isInQuarterlyReleaseWindow — returns boolean (smoke check)
 * T5: runFinancialStatementsSync — killswitch_on skips
 * T6: runBalanceSheetSync — no token skips
 * T7: runCashFlowsSync — no token skips
 * T8: cadence helpers — isMonthlyRevenueBurstDay / isWeeklyTriggerDay return boolean
 */

import assert from "node:assert/strict";
import test from "node:test";

// We test pure-logic paths that don't require DB or FinMind API calls.
// DB-dependent paths (upsert, quarantine) are integration territory.

// ── Import helpers under test ─────────────────────────────────────────────────

import {
  withFinMindRetry,
  isMonthlyRevenueBurstDay,
  isInQuarterlyReleaseWindow,
  isWeeklyTriggerDay,
  runMonthlyRevenueSync,
  runFinancialStatementsSync,
  runBalanceSheetSync,
  runCashFlowsSync,
  revenueYearMonth,
} from "./fundamentals-finmind-sync.js";

// ── T1: killswitch blocks monthly revenue ─────────────────────────────────────

test("T1: runMonthlyRevenueSync with killswitch ON returns skipped=killswitch_on", async () => {
  const original = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    const result = await runMonthlyRevenueSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "killswitch_on");
    assert.equal(result.rowsUpserted, 0);
    assert.equal(result.tickersAttempted, 0);
  } finally {
    if (original === undefined) {
      delete process.env.FINMIND_KILL_SWITCH;
    } else {
      process.env.FINMIND_KILL_SWITCH = original;
    }
  }
});

// ── T2: no token returns skipped=no_token ─────────────────────────────────────

test("T2: runMonthlyRevenueSync with no token returns skipped=no_token", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runMonthlyRevenueSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T3: withFinMindRetry retries on throw ─────────────────────────────────────

test("T3: withFinMindRetry retries once then succeeds", async () => {
  let callCount = 0;
  const result = await withFinMindRetry<{ id: number }>(
    "TestDataset",
    async () => {
      callCount++;
      if (callCount === 1) throw new Error("simulated_network_error");
      return [{ id: 1 }];
    },
    { maxRetries: 2 }
  );

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.calls, 2, "Should have taken 2 attempts");
  assert.equal(result.error, null);
});

// ── T4: isInQuarterlyReleaseWindow returns boolean ───────────────────────────

test("T4: isInQuarterlyReleaseWindow returns a boolean", () => {
  const result = isInQuarterlyReleaseWindow();
  assert.equal(typeof result, "boolean");
});

// ── T5: runFinancialStatementsSync killswitch ─────────────────────────────────

test("T5: runFinancialStatementsSync with killswitch ON returns skipped", async () => {
  const original = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    const result = await runFinancialStatementsSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "killswitch_on");
    assert.equal(result.dataset, "TaiwanStockFinancialStatements");
  } finally {
    if (original === undefined) {
      delete process.env.FINMIND_KILL_SWITCH;
    } else {
      process.env.FINMIND_KILL_SWITCH = original;
    }
  }
});

// ── T6: runBalanceSheetSync no token ─────────────────────────────────────────

test("T6: runBalanceSheetSync with no token returns skipped=no_token", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runBalanceSheetSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
    assert.equal(result.dataset, "TaiwanStockBalanceSheet");
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T7: runCashFlowsSync no token ─────────────────────────────────────────────

test("T7: runCashFlowsSync with no token returns skipped=no_token", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runCashFlowsSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
    assert.equal(result.dataset, "TaiwanStockCashFlowsStatement");
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T8: cadence helpers are boolean functions ─────────────────────────────────

test("T8: cadence helpers isMonthlyRevenueBurstDay + isWeeklyTriggerDay return booleans", () => {
  const burstDay = isMonthlyRevenueBurstDay();
  const weeklyTrigger = isWeeklyTriggerDay();
  assert.equal(typeof burstDay, "boolean");
  assert.equal(typeof weeklyTrigger, "boolean");
});

test("T9: monthly revenue persistence keys by accounting period, not publication date", () => {
  assert.equal(revenueYearMonth({
    date: "2026-06-10",
    revenue_year: 2026,
    revenue_month: 5,
  }), "2026-05");
});
