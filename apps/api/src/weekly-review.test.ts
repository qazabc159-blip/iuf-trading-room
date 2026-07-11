import assert from "node:assert/strict";
import test from "node:test";

import { deriveBriefDeliveryDays } from "./weekly-review.js";

test("brief delivery never reports more published briefs than known trading days", () => {
  const result = deriveBriefDeliveryDays(
    ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"],
    ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"],
    "2026-06-15",
    "2026-06-19",
  );

  // 06-19 has a published brief but no official TAIEX close — trading_days
  // (the P1-8 denominator) comes only from the real calendar, so it stays at 4
  // and 06-19 is reported separately, not folded into a perfect-looking 5/5.
  assert.deepEqual(result.tradingDays, [
    "2026-06-15",
    "2026-06-16",
    "2026-06-17",
    "2026-06-18",
  ]);
  assert.equal(result.published.length, 4);
  assert.equal(result.tradingDays.length, 4);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.offCalendarPublished, ["2026-06-19"]);
});

// P1-8 (2026-07-11 product critique): 07/10 typhoon closure — the pipeline
// still published a brief (isTwTradingDay's calendar table wasn't seeded for
// the ad-hoc closure), and the old union-based denominator let that same
// erroneous publish inflate both numerator and denominator, showing a
// self-confirming "本週發布 5/5 個交易日" on a week with only 4 real trading
// days. This is the exact repro at the deriveBriefDeliveryDays level.
test("a brief published on a non-trading day does not inflate the delivery ratio (P1-8 typhoon repro)", () => {
  const result = deriveBriefDeliveryDays(
    // TAIEX has no close for 07/10 (typhoon) — only Mon/Tue/Wed/Thu published.
    ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"],
    // Pipeline mistakenly published a brief on 07/10 too.
    ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"],
    "2026-07-06",
    "2026-07-10",
  );

  assert.equal(result.tradingDays.length, 4);
  assert.equal(result.published.length, 4);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.offCalendarPublished, ["2026-07-10"]);
});

test("a genuinely missed trading day is reported as missing, not silently dropped", () => {
  const result = deriveBriefDeliveryDays(
    ["2026-06-15", "2026-06-16", "2026-06-17"],
    ["2026-06-15", "2026-06-17"],
    "2026-06-15",
    "2026-06-19",
  );

  assert.deepEqual(result.tradingDays, ["2026-06-15", "2026-06-16", "2026-06-17"]);
  assert.deepEqual(result.published, ["2026-06-15", "2026-06-17"]);
  assert.deepEqual(result.missing, ["2026-06-16"]);
  assert.deepEqual(result.offCalendarPublished, []);
});

test("brief delivery ignores published dates outside the review week", () => {
  const result = deriveBriefDeliveryDays(
    ["2026-06-15", "2026-06-16"],
    ["2026-06-14", "2026-06-15"],
    "2026-06-15",
    "2026-06-19",
  );

  assert.deepEqual(result.published, ["2026-06-15"]);
  assert.deepEqual(result.missing, ["2026-06-16"]);
});
