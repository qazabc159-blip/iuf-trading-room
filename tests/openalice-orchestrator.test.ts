/**
 * openalice-orchestrator.test.ts — Brain calibration tests (2026-06-25)
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
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { _extractTickersForTest } from "../apps/api/src/openalice-action-executor.ts";

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
