import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUsableV3RecommendationDelivery,
  shouldEmitDailySmokeFailure,
  isProviderQuotaExhausted,
  PROVIDER_QUOTA_429_STREAK_THRESHOLD,
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
