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

  assert.deepEqual(result.tradingDays, [
    "2026-06-15",
    "2026-06-16",
    "2026-06-17",
    "2026-06-18",
    "2026-06-19",
  ]);
  assert.equal(result.published.length, 5);
  assert.equal(result.tradingDays.length, 5);
  assert.deepEqual(result.missing, []);
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
