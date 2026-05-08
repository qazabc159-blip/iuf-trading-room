import assert from "node:assert/strict";
import test from "node:test";

import {
  FinMindClient,
  type FinMindPriceAdjRow
} from "./finmind-client.js";

class MemoryCache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setEx(key: string, ttl: number, value: string): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }
}

const BASE_PRICE_ROW: FinMindPriceAdjRow = {
  date: "2026-05-01",
  stock_id: "2330",
  Trading_Volume: 25_000_000,
  Trading_money: 23_750_000_000,
  open: 950,
  max: 960,
  min: 945,
  close: 955,
  spread: 5,
  Trading_turnover: 25_000
};

test("recent latest OHLCV appends newer TaiwanStockPrice rows when adjusted data lags", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });
  const dayMs = 24 * 60 * 60 * 1000;
  const startDate = new Date(Date.now() - 7 * dayMs).toISOString().slice(0, 10);
  const adjustedDate = new Date(Date.now() - 2 * dayMs).toISOString().slice(0, 10);
  const rawDate = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const adjustedRow: FinMindPriceAdjRow = {
    ...BASE_PRICE_ROW,
    date: adjustedDate,
    close: 950,
    Trading_Volume: 20_000_000
  };
  const rawRow: FinMindPriceAdjRow = {
    ...BASE_PRICE_ROW,
    date: rawDate,
    close: 975,
    Trading_Volume: 32_000_000
  };
  const datasets: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, _init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const dataset = url.searchParams.get("dataset") ?? "";
    datasets.push(dataset);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 200,
        msg: "Success",
        data: dataset === "TaiwanStockPriceAdj" ? [adjustedRow] : [rawRow]
      })
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const bars = await client.getStockPriceAdj("2330", startDate, null);
    assert.deepEqual(datasets, ["TaiwanStockPriceAdj", "TaiwanStockPrice"]);
    assert.equal(bars.length, 2);
    assert.equal(bars[0].dt, adjustedDate);
    assert.equal(bars[1].dt, rawDate);
    assert.equal(bars[1].close, 975);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
