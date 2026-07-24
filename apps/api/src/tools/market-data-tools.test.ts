import assert from "node:assert/strict";
import test from "node:test";

import { revenuePeriodKey } from "./market-data-tools.js";

test("monthly revenue uses the accounting period instead of the publication date", () => {
  assert.equal(revenuePeriodKey({
    date: "2026-06-10",
    revenue_year: 2026,
    revenue_month: 5,
  }), "2026-05");
});

test("monthly revenue period falls back to date when FinMind omits period fields", () => {
  assert.equal(revenuePeriodKey({ date: "2026-04-01" }), "2026-04");
});
