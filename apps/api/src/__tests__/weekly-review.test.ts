/**
 * weekly-review.test.ts — B4 復盤閉環 unit tests (week math + report assembly contracts)
 *
 * Run: node --import tsx/esm --test apps/api/src/__tests__/weekly-review.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveReviewWeek } from "../weekly-review.js";

test("resolveReviewWeek: mid-week anchor resolves to its Monday-Friday window", () => {
  // 2026-06-12 is a Friday
  assert.deepEqual(resolveReviewWeek("2026-06-12"), { weekStart: "2026-06-08", weekEnd: "2026-06-12" });
  // Wednesday anchor, same week
  assert.deepEqual(resolveReviewWeek("2026-06-10"), { weekStart: "2026-06-08", weekEnd: "2026-06-12" });
  // Monday anchor is its own weekStart
  assert.deepEqual(resolveReviewWeek("2026-06-08"), { weekStart: "2026-06-08", weekEnd: "2026-06-12" });
});

test("resolveReviewWeek: Sunday anchor belongs to the week that just ended", () => {
  // 2026-06-14 is a Sunday → ISO week starting 6/8
  assert.deepEqual(resolveReviewWeek("2026-06-14"), { weekStart: "2026-06-08", weekEnd: "2026-06-12" });
});

test("resolveReviewWeek: month/year boundaries hold", () => {
  // 2026-06-01 is a Monday
  assert.deepEqual(resolveReviewWeek("2026-06-01"), { weekStart: "2026-06-01", weekEnd: "2026-06-05" });
  // 2026-01-01 is a Thursday → week starts 2025-12-29
  assert.deepEqual(resolveReviewWeek("2026-01-01"), { weekStart: "2025-12-29", weekEnd: "2026-01-02" });
});

test("resolveReviewWeek: invalid anchor falls back to current week (shape only)", () => {
  const r = resolveReviewWeek("not-a-date");
  assert.match(r.weekStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.weekEnd, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.weekStart < r.weekEnd);
});
