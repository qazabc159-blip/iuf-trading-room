import assert from "node:assert/strict";
import test from "node:test";

import {
  isV3CronWindowAt,
  taipeiDateOf,
  failStaleV3RunningRows,
  hasV3RunForTaipeiDate,
} from "../ai-recommendation-v2/orchestrator-v3.js";
import { getDailyBudgetUsd } from "../llm/llm-gateway.js";

// 2026-06-11 is a Wednesday. 08:45 TST = 00:45 UTC.
const WED_0845_TST = Date.parse("2026-06-11T00:45:00Z");
const WED_0829_TST = Date.parse("2026-06-11T00:29:00Z");
const WED_0916_TST = Date.parse("2026-06-11T01:16:00Z");
const WED_1400_TST = Date.parse("2026-06-11T06:00:00Z");
// 2026-06-13 is a Saturday.
const SAT_0845_TST = Date.parse("2026-06-13T00:45:00Z");

test("V3 cron window accepts weekday 08:30-09:15 TST", () => {
  assert.equal(isV3CronWindowAt(WED_0845_TST), true);
  assert.equal(isV3CronWindowAt(Date.parse("2026-06-11T00:30:00Z")), true); // 08:30 boundary
  assert.equal(isV3CronWindowAt(Date.parse("2026-06-11T01:15:00Z")), true); // 09:15 boundary
});

test("V3 cron window rejects out-of-window and weekend times", () => {
  assert.equal(isV3CronWindowAt(WED_0829_TST), false);
  assert.equal(isV3CronWindowAt(WED_0916_TST), false);
  assert.equal(isV3CronWindowAt(WED_1400_TST), false);
  assert.equal(isV3CronWindowAt(SAT_0845_TST), false);
});

test("taipeiDateOf converts UTC epoch to Taipei calendar date", () => {
  // 2026-06-10 23:30 UTC = 2026-06-11 07:30 TST → Taipei date rolls over before UTC does
  assert.equal(taipeiDateOf(Date.parse("2026-06-10T23:30:00Z")), "2026-06-11");
  assert.equal(taipeiDateOf(WED_0845_TST), "2026-06-11");
});

test("stale-running sweep and same-day-run guard are no-ops in memory mode", async () => {
  // CI runs without DATABASE_URL — both helpers must fail open without throwing.
  const swept = await failStaleV3RunningRows({ minAgeMs: 0, reason: "(test sweep)" });
  assert.equal(swept, 0);
  const hasRun = await hasV3RunForTaipeiDate("2026-06-11");
  assert.equal(hasRun, false);
});

test("LLM daily budget default raised to $10 with env override", () => {
  const prev = process.env["LLM_DAILY_BUDGET_USD"];
  try {
    delete process.env["LLM_DAILY_BUDGET_USD"];
    assert.equal(getDailyBudgetUsd(), 10.0);
    process.env["LLM_DAILY_BUDGET_USD"] = "7.5";
    assert.equal(getDailyBudgetUsd(), 7.5);
    process.env["LLM_DAILY_BUDGET_USD"] = "not-a-number";
    assert.equal(getDailyBudgetUsd(), 10.0);
  } finally {
    if (prev === undefined) delete process.env["LLM_DAILY_BUDGET_USD"];
    else process.env["LLM_DAILY_BUDGET_USD"] = prev;
  }
});
