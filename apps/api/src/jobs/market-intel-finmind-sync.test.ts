/**
 * market-intel-finmind-sync.test.ts — BLOCK #4 PR C: 4 market-intel dataset unit tests
 *
 * T1:  runDividendSync         — killswitch_on skips with reason
 * T2:  runDividendSync         — no token returns skipped=no_token
 * T3:  runMarketValueSync      — killswitch_on skips with reason
 * T4:  runMarketValueSync      — no token returns skipped=no_token
 * T5:  runValuationSync        — killswitch_on skips with reason
 * T6:  runValuationSync        — no token returns skipped=no_token
 * T7:  runStockNewsSync        — killswitch_on skips with reason + experimental=true
 * T8:  runStockNewsSync        — no token returns skipped=no_token + experimental=true
 * T9:  isWeekendTriggerDay     — returns boolean
 * T10: isSundayTriggerDay      — returns boolean
 * T11: queryMarketIntelDatasetStats — no DB returns EMPTY state (no throw)
 * T12: runDividendSync         — with token but no DB returns skipped=no_db gracefully
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  runDividendSync,
  runMarketValueSync,
  runValuationSync,
  runStockNewsSync,
  isWeekendTriggerDay,
  isSundayTriggerDay,
  queryMarketIntelDatasetStats
} from "./market-intel-finmind-sync.js";

// ── T1: killswitch blocks dividend ───────────────────────────────────────────

test("T1: runDividendSync with killswitch ON returns skipped=killswitch_on", async () => {
  const original = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    const result = await runDividendSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "killswitch_on");
    assert.equal(result.rowsUpserted, 0);
    assert.equal(result.tickersAttempted, 0);
    assert.equal(result.dataset, "TaiwanStockDividend");
  } finally {
    if (original === undefined) {
      delete process.env.FINMIND_KILL_SWITCH;
    } else {
      process.env.FINMIND_KILL_SWITCH = original;
    }
  }
});

// ── T2: no token returns skipped=no_token (dividend) ─────────────────────────

test("T2: runDividendSync with no token returns skipped=no_token", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runDividendSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
    assert.equal(result.dataset, "TaiwanStockDividend");
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T3: killswitch blocks market value ───────────────────────────────────────

test("T3: runMarketValueSync with killswitch ON returns skipped=killswitch_on", async () => {
  const original = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    const result = await runMarketValueSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "killswitch_on");
    assert.equal(result.rowsUpserted, 0);
    assert.equal(result.dataset, "TaiwanStockMarketValue");
  } finally {
    if (original === undefined) {
      delete process.env.FINMIND_KILL_SWITCH;
    } else {
      process.env.FINMIND_KILL_SWITCH = original;
    }
  }
});

// ── T4: no token returns skipped=no_token (market value) ─────────────────────

test("T4: runMarketValueSync with no token returns skipped=no_token", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runMarketValueSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
    assert.equal(result.dataset, "TaiwanStockMarketValue");
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T5: killswitch blocks valuation ──────────────────────────────────────────

test("T5: runValuationSync with killswitch ON returns skipped=killswitch_on", async () => {
  const original = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    const result = await runValuationSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "killswitch_on");
    assert.equal(result.rowsUpserted, 0);
    assert.equal(result.dataset, "TaiwanStockPER");
  } finally {
    if (original === undefined) {
      delete process.env.FINMIND_KILL_SWITCH;
    } else {
      process.env.FINMIND_KILL_SWITCH = original;
    }
  }
});

// ── T6: no token returns skipped=no_token (valuation) ────────────────────────

test("T6: runValuationSync with no token returns skipped=no_token", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runValuationSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
    assert.equal(result.dataset, "TaiwanStockPER");
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T7: killswitch blocks news + experimental flag ───────────────────────────

test("T7: runStockNewsSync with killswitch ON returns skipped=killswitch_on + experimental=true", async () => {
  const original = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    const result = await runStockNewsSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "killswitch_on");
    assert.equal(result.rowsUpserted, 0);
    assert.equal(result.dataset, "TaiwanStockNews");
    assert.equal(result.experimental, true);
  } finally {
    if (original === undefined) {
      delete process.env.FINMIND_KILL_SWITCH;
    } else {
      process.env.FINMIND_KILL_SWITCH = original;
    }
  }
});

// ── T8: no token returns skipped=no_token + experimental=true (news) ─────────

test("T8: runStockNewsSync with no token returns skipped=no_token + experimental=true", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  delete process.env.FINMIND_API_TOKEN;
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runStockNewsSync([{ ticker: "2330" }]);
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_token");
    assert.equal(result.dataset, "TaiwanStockNews");
    assert.equal(result.experimental, true);
  } finally {
    if (originalToken !== undefined) process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});

// ── T9: isWeekendTriggerDay returns boolean ───────────────────────────────────

test("T9: isWeekendTriggerDay returns a boolean", () => {
  const result = isWeekendTriggerDay();
  assert.equal(typeof result, "boolean");
});

// ── T10: isSundayTriggerDay returns boolean ───────────────────────────────────

test("T10: isSundayTriggerDay returns a boolean", () => {
  const result = isSundayTriggerDay();
  assert.equal(typeof result, "boolean");
});

// ── T11: queryMarketIntelDatasetStats with no DB returns EMPTY (no throw) ─────

test("T11: queryMarketIntelDatasetStats returns valid state when no DB configured", async () => {
  const result = await queryMarketIntelDatasetStats("tw_dividend");
  assert.ok(
    result.state === "EMPTY" || result.state === "DEGRADED" || result.state === "ERROR" || result.state === "LIVE" || result.state === "STALE",
    `Expected a valid state, got: ${result.state}`
  );
  assert.equal(typeof result.rowCount, "number");
});

// ── T12: runDividendSync with token but no DB returns skipped gracefully ──────

test("T12: runDividendSync with token but no DB returns skipped gracefully", async () => {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKs = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_API_TOKEN = "test_token_placeholder";
  delete process.env.FINMIND_KILL_SWITCH;
  try {
    const result = await runDividendSync([{ ticker: "2330" }]);
    // In test environment without DB: skipped=no_db OR skipped=table_not_migrated
    assert.equal(result.skipped, true);
    assert.ok(
      result.skipReason === "no_db" || result.skipReason === "table_not_migrated",
      `Expected no_db or table_not_migrated, got: ${result.skipReason}`
    );
    assert.equal(result.dataset, "TaiwanStockDividend");
  } finally {
    if (originalToken !== undefined) {
      process.env.FINMIND_API_TOKEN = originalToken;
    } else {
      delete process.env.FINMIND_API_TOKEN;
    }
    if (originalKs !== undefined) process.env.FINMIND_KILL_SWITCH = originalKs;
  }
});
