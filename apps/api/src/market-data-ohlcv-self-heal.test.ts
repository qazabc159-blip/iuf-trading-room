import assert from "node:assert/strict";
import test from "node:test";

import { selectDailyContextOhlcvSelfHealSymbols } from "./market-data.js";

test("selectDailyContextOhlcvSelfHealSymbols prioritizes stale homepage names and caps the batch", () => {
  const symbols = selectDailyContextOhlcvSelfHealSymbols({
    companies: [
      { ticker: "2330" },
      { ticker: "2317" },
      { ticker: "2454" },
      { ticker: "2002" },
      { ticker: "2603" }
    ],
    rows: [
      { symbol: "2330", date: "2026-05-06", volume: 90_000_000 },
      { symbol: "2454", date: "2026-05-08", volume: 30_000_000 },
      { symbol: "2002", date: "2026-05-07", volume: 50_000_000 },
      { symbol: "2603", date: "2026-05-06", volume: 70_000_000 }
    ],
    targetDate: "2026-05-08",
    limit: 3,
    prioritySymbols: ["2330", "2317", "2454", "2603", "2002"]
  });

  assert.deepEqual(symbols, ["2330", "2317", "2603"]);
});

test("selectDailyContextOhlcvSelfHealSymbols returns nothing when all rows are current", () => {
  const symbols = selectDailyContextOhlcvSelfHealSymbols({
    companies: [{ ticker: "2330" }, { ticker: "2317" }],
    rows: [
      { symbol: "2330", date: "2026-05-08", volume: 90_000_000 },
      { symbol: "2317", date: "2026-05-08", volume: 60_000_000 }
    ],
    targetDate: "2026-05-08",
    limit: 10
  });

  assert.deepEqual(symbols, []);
});
