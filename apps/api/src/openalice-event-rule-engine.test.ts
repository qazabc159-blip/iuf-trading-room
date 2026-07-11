import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUsableV3RecommendationDelivery,
  shouldEmitDailySmokeFailure,
  isProviderQuotaExhausted,
  PROVIDER_QUOTA_429_STREAK_THRESHOLD,
  ruleAudience,
  dedupeSameDayEvents,
  type IufEventView,
} from "./openalice-event-rule-engine.js";

test("daily smoke alerts only fire for a same-day weekday failure after the smoke window opens", () => {
  const fridayAfterSmoke = Date.parse("2026-06-19T01:10:00.000Z");
  assert.equal(shouldEmitDailySmokeFailure({
    firedAt: "2026-06-19T01:07:00.000Z",
    overallStatus: "fail",
  }, fridayAfterSmoke), true);
});

test("daily smoke alerts do not recycle yesterday's failure after midnight", () => {
  const saturdayMidnightTaipei = Date.parse("2026-06-19T16:03:00.000Z");
  assert.equal(shouldEmitDailySmokeFailure({
    firedAt: "2026-06-19T01:07:00.000Z",
    overallStatus: "fail",
  }, saturdayMidnightTaipei), false);
});

test("daily smoke alerts do not fire on weekends or for passing runs", () => {
  const saturdayNoonTaipei = Date.parse("2026-06-20T04:00:00.000Z");
  assert.equal(shouldEmitDailySmokeFailure({
    firedAt: "2026-06-20T01:07:00.000Z",
    overallStatus: "fail",
  }, saturdayNoonTaipei), false);
  assert.equal(shouldEmitDailySmokeFailure({
    firedAt: "2026-06-19T01:07:00.000Z",
    overallStatus: "pass",
  }, Date.parse("2026-06-19T02:00:00.000Z")), false);
});

test("R11 treats a same-day insufficient_tools run with actionable cards as delivered", () => {
  assert.equal(hasUsableV3RecommendationDelivery({
    status: "insufficient_tools",
    generatedAt: "2026-06-22T00:32:07.722Z",
    items: [
      { ticker: "2449", action: "A可觀察布局" },
      { ticker: "6919", action: "C高風險排除", bucket: "C" },
    ],
  }, "2026-06-22"), true);
});

test("R11 still reports true zero-delivery and ignores yesterday's cards", () => {
  assert.equal(hasUsableV3RecommendationDelivery({
    status: "insufficient_tools",
    generatedAt: "2026-06-22T00:32:07.722Z",
    items: [{ ticker: "6919", action: "C高風險排除", bucket: "C" }],
  }, "2026-06-22"), false);

  assert.equal(hasUsableV3RecommendationDelivery({
    status: "complete",
    generatedAt: "2026-06-21T00:32:07.722Z",
    items: [{ ticker: "2449", action: "A可觀察布局" }],
  }, "2026-06-22"), false);
});

test("R16 fires only on a sustained provider 429 streak, tolerating a lone transient 429", () => {
  // 2026-06-26 repro: OpenAI account out of quota → continuous HTTP 429 in
  // llm_calls. A single burst 429 must not alarm; a streak must.
  assert.equal(PROVIDER_QUOTA_429_STREAK_THRESHOLD, 3);
  assert.equal(isProviderQuotaExhausted(0), false);
  assert.equal(isProviderQuotaExhausted(1), false);
  assert.equal(isProviderQuotaExhausted(2), false);
  assert.equal(isProviderQuotaExhausted(3), true);
  assert.equal(isProviderQuotaExhausted(42), true);
});

test("R16 threshold is null-safe against non-finite counts (COUNT(*) is always a real int)", () => {
  assert.equal(isProviderQuotaExhausted(NaN), false);
  assert.equal(isProviderQuotaExhausted(Number.POSITIVE_INFINITY), false);
});

// ── P1-2 audience classification (2026-07-11; refined same day after prod
// verify — see PR body per-rule attribution table) ─────────────────────────
// Reuses push/alert-push.ts's PAYLOAD_COPY allowlist as the single source of
// truth for actionable_market. R11/R14 were demoted to ops_internal on BOTH
// surfaces (removed from PAYLOAD_COPY too) after prod showed they're service/
// content-freshness status notices, not trader-actionable market signals.
test("ruleAudience: rules with a push payload are actionable_market", () => {
  const actionableRuleIds = [
    "R01_REVENUE_SURGE_YOY50",
    "R02_INSTITUTIONAL_CONSECUTIVE_BUY_5D",
    "R03_INSTITUTIONAL_CONSECUTIVE_SELL_5D",
    "R04_SHAREHOLDING_HHI_BREAKOUT",
    "R05_REVENUE_DECLINE_YOY30",
    "R06_MAJOR_SHAREHOLDER_THRESHOLD",
    "R07_MAJOR_ANNOUNCEMENT",
    "R08_AI_BRIEF_PUBLISHED",
  ];
  for (const ruleId of actionableRuleIds) {
    assert.equal(ruleAudience(ruleId), "actionable_market", `${ruleId} should be actionable_market`);
  }
});

test("ruleAudience: pipeline/system self-monitoring rules are ops_internal", () => {
  const opsRuleIds = [
    "R09_HALLUCINATION_REJECTED",
    "R10_KGI_GATEWAY_STATE_CHANGE",
    "R11_V3_REC_CRON_EXHAUSTED", // demoted 2026-07-11: service status, not a market signal
    "R12_LLM_BUDGET_NEAR_LIMIT",
    "R13_DAILY_SMOKE_FAILED",
    "R14_THEME_REFRESH_STALE", // demoted 2026-07-11: content-freshness status, not a market signal
    "R15_S1_EOD_NO_POSITIONS",
    "R16_LLM_PROVIDER_QUOTA_EXHAUSTED",
  ];
  for (const ruleId of opsRuleIds) {
    assert.equal(ruleAudience(ruleId), "ops_internal", `${ruleId} should be ops_internal`);
  }
});

test("ruleAudience: unknown rule ids fail safe as ops_internal (never surfaces unclassified noise as actionable)", () => {
  assert.equal(ruleAudience("R99_SOME_FUTURE_RULE"), "ops_internal");
});

// R_OPENALICE_DECISION is written by a DIFFERENT producer
// (openalice-action-executor.ts) and is not in the RULES array at all — its
// own generating prompt defines it as an operator/system catch-all
// ("Surface a critical alert to the operator, e.g. system health failure,
// budget exceeded"), not a structured per-ticker market signal. This is also
// the regression test for the actual prod bug (36/50 rows in the default
// GET /api/v1/alerts response): the SQL filter used to be built as
// `rule_id NOT IN (known_ops_ids)`, so any rule id absent from the RULES
// array — like this one — silently passed the actionable_market filter.
test("ruleAudience: R_OPENALICE_DECISION (a different producer, not in RULES) fails safe as ops_internal", () => {
  assert.equal(ruleAudience("R_OPENALICE_DECISION"), "ops_internal");
});

// ── P1-2 granularity: same-day dedup (2026-07-11) ──────────────────────────
function fakeEvent(overrides: Partial<IufEventView>): IufEventView {
  return {
    id: "id",
    ruleId: "R08_AI_BRIEF_PUBLISHED",
    ruleName: "AI brief published",
    severity: "info",
    ticker: null,
    payload: {},
    triggeredAt: "2026-07-10T01:00:00.000Z",
    acknowledged: false,
    audience: "actionable_market",
    label: "今日簡報已發布",
    ...overrides,
  };
}

test("dedupeSameDayEvents: collapses same ruleId+ticker+Taipei-day duplicates to the newest", () => {
  const events = [
    fakeEvent({ id: "3", triggeredAt: "2026-07-10T09:00:00.000Z" }), // newest
    fakeEvent({ id: "2", triggeredAt: "2026-07-10T05:00:00.000Z" }),
    fakeEvent({ id: "1", triggeredAt: "2026-07-10T01:00:00.000Z" }), // oldest
  ];
  const result = dedupeSameDayEvents(events);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "3");
});

test("dedupeSameDayEvents: different tickers under the same ruleId+day are distinct alerts, never collapsed", () => {
  const events = [
    fakeEvent({ id: "a", ruleId: "R01_REVENUE_SURGE_YOY50", ticker: "2330", triggeredAt: "2026-07-10T02:00:00.000Z" }),
    fakeEvent({ id: "b", ruleId: "R01_REVENUE_SURGE_YOY50", ticker: "2454", triggeredAt: "2026-07-10T01:00:00.000Z" }),
  ];
  const result = dedupeSameDayEvents(events);
  assert.equal(result.length, 2);
});

test("dedupeSameDayEvents: same ruleId+ticker on different Taipei days are distinct alerts", () => {
  const events = [
    fakeEvent({ id: "today", triggeredAt: "2026-07-10T09:00:00.000Z" }), // 17:00 Taipei 07/10
    fakeEvent({ id: "yesterday", triggeredAt: "2026-07-09T09:00:00.000Z" }), // 17:00 Taipei 07/09
  ];
  const result = dedupeSameDayEvents(events);
  assert.equal(result.length, 2);
});

test("dedupeSameDayEvents: uses Taipei calendar day, not UTC day, at the UTC midnight boundary", () => {
  // 2026-07-10T17:00:00Z is already 2026-07-11 01:00 in Taipei (+8).
  const events = [
    fakeEvent({ id: "late-utc", triggeredAt: "2026-07-10T17:00:00.000Z" }), // Taipei 07/11 01:00
    fakeEvent({ id: "next-utc-day", triggeredAt: "2026-07-10T18:00:00.000Z" }), // Taipei 07/11 02:00 — same Taipei day as above
  ];
  const result = dedupeSameDayEvents(events);
  assert.equal(result.length, 1, "both fall on Taipei 07/11 — should collapse to one");
});
