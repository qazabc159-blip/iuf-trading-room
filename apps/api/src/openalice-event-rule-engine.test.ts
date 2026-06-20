import assert from "node:assert/strict";
import test from "node:test";

import { shouldEmitDailySmokeFailure } from "./openalice-event-rule-engine.js";

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
