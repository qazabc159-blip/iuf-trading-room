/**
 * openalice-orchestrator.test.ts — Brain calibration + budget governance tests (2026-06-25)
 * Run via: node --import ./tests/setup-test-env.mjs --import tsx --test tests/openalice-orchestrator.test.ts
 *
 * Tests run in memory mode (no DB required).
 *
 * Coverage:
 *   OA-CAL-A1: getOrchestratorObservability SQL SELECT includes outcome column
 *   OA-CAL-B1: _extractTickersForTest — payload has tickers → source="payload"
 *   OA-CAL-B2: _extractTickersForTest — payload missing, trigger_ref has ticker → source="trigger_ref_fallback"
 *   OA-CAL-B3: _extractTickersForTest — both missing → source="none", empty tickers
 *   OA-CAL-B4: _extractTickersForTest — payload has singular "ticker" key → source="payload"
 *   OA-CAL-B5: trigger_ref ticker whitespace-only is ignored → source="none"
 *   OA-CAL-C1: SYSTEM_PROMPT contains Traditional Chinese requirement for reasoning
 *   OA-CAL-C2: SYSTEM_PROMPT forbids guarantee/follow-trade language
 *   OA-CAL-C3: SYSTEM_PROMPT instructs LLM to put ticker in action_payload.tickers
 *
 * Budget governance (OA-GOV-*):
 *   OA-GOV-1: daily cap defaults to 8, env-overridable
 *   OA-GOV-2: daily cap reached → skip reason = deep_analyze_daily_cap_reached
 *   OA-GOV-3: budget insufficient → skip reason = budget_insufficient (not done-empty)
 *   OA-GOV-4: per-ticker dedup → skip reason = already_analyzed_today
 *   OA-GOV-5: priority ordering — ORDER BY clause uses confidence DESC secondary sort
 *   OA-GOV-6: sentinel detection — "報告生成失敗" string marks exhausted synthesis
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  _extractTickersForTest,
  _getDeepAnalyzeDailyCapForTest,
  _EMPTY_REPORT_SENTINEL_FOR_TEST,
  _DEEP_ANALYZE_MIN_BUDGET_USD_FOR_TEST,
} from "../apps/api/src/openalice-action-executor.ts";

// ── Load orchestrator source for static-analysis tests ────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR_SOURCE = readFileSync(
  join(__dirname, "../apps/api/src/openalice-orchestrator.ts"),
  "utf-8"
);

// ── Problem B tests: ticker extraction logic ───────────────────────────────────

test("OA-CAL-B1: ticker in action_payload.tickers → source=payload", () => {
  const result = _extractTickersForTest(
    { tickers: ["2330", "2317"] },
    { ticker: "9999" } // trigger_ref ticker ignored when payload has tickers
  );
  assert.equal(result.source, "payload");
  assert.deepEqual(result.tickers, ["2330", "2317"]);
});

test("OA-CAL-B2: payload missing tickers, trigger_ref has ticker → trigger_ref_fallback", () => {
  const result = _extractTickersForTest(
    {}, // LLM omitted tickers from action_payload
    { ticker: "2330", ruleName: "價格突破5日均線" }
  );
  assert.equal(result.source, "trigger_ref_fallback");
  assert.deepEqual(result.tickers, ["2330"]);
});

test("OA-CAL-B3: both payload and trigger_ref missing tickers → none", () => {
  const result = _extractTickersForTest(
    { message: "some alert" },
    { ruleName: "系統健康異常", severity: "critical" }
  );
  assert.equal(result.source, "none");
  assert.deepEqual(result.tickers, []);
});

test("OA-CAL-B4: payload has singular 'ticker' key → source=payload", () => {
  const result = _extractTickersForTest(
    { ticker: "0050" },
    {}
  );
  assert.equal(result.source, "payload");
  assert.deepEqual(result.tickers, ["0050"]);
});

test("OA-CAL-B5: trigger_ref ticker whitespace-only is ignored → none", () => {
  const result = _extractTickersForTest(
    {},
    { ticker: "   " }
  );
  assert.equal(result.source, "none");
  assert.deepEqual(result.tickers, []);
});

// ── Problem C tests: SYSTEM_PROMPT language enforcement (static source check) ──

test("OA-CAL-C1: SYSTEM_PROMPT requires Traditional Chinese for reasoning field", () => {
  assert.ok(
    ORCHESTRATOR_SOURCE.includes("繁體中文") || ORCHESTRATOR_SOURCE.includes("Traditional Chinese"),
    "SYSTEM_PROMPT should instruct LLM to use Traditional Chinese for reasoning"
  );
});

test("OA-CAL-C2: SYSTEM_PROMPT forbids profit guarantee or follow-trade language", () => {
  assert.ok(
    ORCHESTRATOR_SOURCE.includes("profit guarantee") ||
      ORCHESTRATOR_SOURCE.includes("NEVER mention specific returns"),
    "SYSTEM_PROMPT should forbid profit guarantees and follow-trade suggestions"
  );
});

test("OA-CAL-C3: SYSTEM_PROMPT instructs LLM to put ticker in action_payload.tickers", () => {
  assert.ok(
    ORCHESTRATOR_SOURCE.includes("action_payload.tickers"),
    "SYSTEM_PROMPT should instruct LLM to include tickers in action_payload"
  );
});

// ── Problem A tests: observability includes outcome field (static source check) ─

test("OA-CAL-A1: recentRows SQL SELECT includes outcome column", () => {
  assert.ok(
    ORCHESTRATOR_SOURCE.includes(
      "SELECT id, trigger_type, action_type, confidence, priority, status, reasoning, outcome, created_at"
    ),
    "recentRows SQL SELECT should include outcome column"
  );
});

test("OA-CAL-A2: recentRows map includes outcome field", () => {
  assert.ok(
    ORCHESTRATOR_SOURCE.includes("outcome: r.outcome ?? null"),
    "recentRows map should include outcome field"
  );
});

// OA-CAL-D: priority_alert severity must satisfy iuf_events CHECK (info|warning|critical).
// 2026-06-25 bug: prio-3 mapped to "high" → every priority_alert INSERT failed the
// CHECK constraint → alerts never written. Guard every mapped value against the allowed set.
test("OA-CAL-D1: PRIORITY_ALERT_SEVERITY_MAP values all satisfy iuf_events severity CHECK", () => {
  const EXECUTOR_SOURCE = readFileSync(
    join(__dirname, "../apps/api/src/openalice-action-executor.ts"),
    "utf-8"
  );
  const allowed = new Set(["info", "warning", "critical"]);
  const block = EXECUTOR_SOURCE.match(/PRIORITY_ALERT_SEVERITY_MAP[^{]*\{([^}]*)\}/);
  assert.ok(block, "PRIORITY_ALERT_SEVERITY_MAP must exist");
  const values = [...block![1].matchAll(/"[0-9]"\s*:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(values.length >= 5, "map should cover priorities 1-5");
  for (const v of values) {
    assert.ok(allowed.has(v), `severity "${v}" must be one of info|warning|critical (iuf_events CHECK)`);
  }
});

// ── Budget governance tests (OA-GOV-*) ────────────────────────────────────────
// Static source assertions — no DB required. Verify structure of the governance
// gates that prevent 22+/day deep_analyze noise and empty-report "done" outcomes.

const EXECUTOR_SOURCE = readFileSync(
  join(__dirname, "../apps/api/src/openalice-action-executor.ts"),
  "utf-8"
);

test("OA-GOV-1: daily cap defaults to 8, env-overridable via OPENALICE_DEEP_ANALYZE_DAILY_CAP", () => {
  // Default cap
  const original = process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"];
  delete process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"];
  assert.equal(_getDeepAnalyzeDailyCapForTest(), 8, "default cap should be 8");

  // Env override
  process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"] = "3";
  assert.equal(_getDeepAnalyzeDailyCapForTest(), 3, "env override to 3 should work");

  // Restore
  if (original !== undefined) {
    process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"] = original;
  } else {
    delete process.env["OPENALICE_DEEP_ANALYZE_DAILY_CAP"];
  }
});

test("OA-GOV-2: daily cap gate returns skip with reason=deep_analyze_daily_cap_reached", () => {
  // Verify source contains the governance gate and the exact skip reason string.
  assert.ok(
    EXECUTOR_SOURCE.includes("deep_analyze_daily_cap_reached"),
    "executor must contain skip reason 'deep_analyze_daily_cap_reached'"
  );
  assert.ok(
    EXECUTOR_SOURCE.includes("dailyCapState.doneCount >= dailyCapState.cap"),
    "executor must check doneCount against cap"
  );
});

test("OA-GOV-3: budget insufficient gate returns skip with reason=budget_insufficient (not done-empty)", () => {
  // Verify the pre-flight budget check exists and uses the right skip reason.
  assert.ok(
    EXECUTOR_SOURCE.includes("budget_insufficient"),
    "executor must contain skip reason 'budget_insufficient'"
  );
  assert.ok(
    EXECUTOR_SOURCE.includes("getRemainingBudgetUsd"),
    "executor must call getRemainingBudgetUsd before runReactLoop"
  );
  // Min budget threshold exported and non-trivial
  assert.ok(
    _DEEP_ANALYZE_MIN_BUDGET_USD_FOR_TEST > 0,
    "DEEP_ANALYZE_MIN_BUDGET_USD must be > 0"
  );
  assert.ok(
    _DEEP_ANALYZE_MIN_BUDGET_USD_FOR_TEST <= 1,
    "DEEP_ANALYZE_MIN_BUDGET_USD should be <= $1 (conservative threshold)"
  );
});

test("OA-GOV-4: per-ticker dedup gate returns skip with reason=already_analyzed_today", () => {
  assert.ok(
    EXECUTOR_SOURCE.includes("already_analyzed_today"),
    "executor must contain skip reason 'already_analyzed_today'"
  );
  assert.ok(
    EXECUTOR_SOURCE.includes("isTickerDeepAnalyzedToday"),
    "executor must call isTickerDeepAnalyzedToday per ticker"
  );
});

test("OA-GOV-5: fetchProposedDecisions uses confidence DESC as secondary sort (prioritise high-confidence)", () => {
  assert.ok(
    EXECUTOR_SOURCE.includes("ORDER BY priority ASC, confidence DESC, created_at DESC"),
    "fetchProposedDecisions must sort by priority ASC, confidence DESC, created_at DESC"
  );
});

test("OA-GOV-6: sentinel string '報告生成失敗' is detected and NOT stored as status=done", () => {
  // The sentinel is the string written by react-loop when synthesis returns null.
  // Governance fix: executor must check for this string and mark budget_exhausted_no_report,
  // then collapse to skipped if all analyses failed.
  assert.equal(
    _EMPTY_REPORT_SENTINEL_FOR_TEST,
    "報告生成失敗",
    "sentinel constant must match react-loop message exactly"
  );
  assert.ok(
    EXECUTOR_SOURCE.includes("budget_exhausted_no_report"),
    "executor must map sentinel outcome to 'budget_exhausted_no_report' status"
  );
  assert.ok(
    EXECUTOR_SOURCE.includes("no_real_report_produced"),
    "executor must collapse all-exhausted results to skipped outcome"
  );
});
