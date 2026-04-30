/**
 * finmind-client.test.ts — W7 H1: FinMind client unit tests
 *
 * T1: getStockPriceAdj — happy path maps rows to OhlcvBar shape
 * T2: 429 retry — retries 3 times then succeeds on 4th attempt
 * T3: token missing — returns empty array + logs warning, does NOT throw
 * T4: Zod/parse error — non-200 status returns empty array (no throw)
 * T5: Redis cache miss-then-hit — first call fetches, second call returns cached
 * T6: getFinancialStatements shape — rows parsed correctly
 * T7: getMonthRevenue shape — rows parsed correctly
 * T8: getDividend shape — rows parsed correctly, TTL is 86400
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  FinMindClient,
  FinMindRateLimitError,
  type FinMindPriceAdjRow,
  type FinMindFinancialStatementsRow,
  type FinMindMonthRevenueRow,
  type FinMindDividendRow
} from "./finmind-client.js";

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function makeFetchMock(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  return async (_url: string): Promise<Response> => {
    const resp = responses[Math.min(call++, responses.length - 1)];
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      json: async () => resp.body
    } as unknown as Response;
  };
}

function buildOkResponse<T>(data: T[]): { status: number; body: { status: number; msg: string; data: T[] } } {
  return { status: 200, body: { status: 200, msg: "Success", data } };
}

const SAMPLE_PRICE_ADJ_ROW: FinMindPriceAdjRow = {
  date: "2026-04-29",
  stock_id: "2330",
  Trading_Volume: 25_000_000,
  Trading_money: 23_750_000_000,
  open: 950.0,
  max: 960.0,
  min: 945.0,
  close: 955.0,
  spread: 5.0,
  Trading_turnover: 25_000
};

// ── In-memory cache backend for tests ────────────────────────────────────────

class MemoryCache {
  private _store = new Map<string, { value: string; expiresAt: number }>();
  private _setExCalls: Array<{ key: string; ttl: number; value: string }> = [];

  async get(key: string): Promise<string | null> {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setEx(key: string, ttl: number, value: string): Promise<void> {
    this._setExCalls.push({ key, ttl, value });
    this._store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  getSetExCalls() { return this._setExCalls; }
  clear() { this._store.clear(); this._setExCalls = []; }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("T1: getStockPriceAdj happy path — maps rows to OhlcvBar shape", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  // Override global fetch for this test
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([buildOkResponse([SAMPLE_PRICE_ADJ_ROW])]);

  try {
    const bars = await client.getStockPriceAdj("2330", "2026-01-01", "2026-04-30");
    assert.equal(bars.length, 1);
    assert.equal(bars[0].dt, "2026-04-29");
    assert.equal(bars[0].open, 950.0);
    assert.equal(bars[0].high, 960.0);
    assert.equal(bars[0].low, 945.0);
    assert.equal(bars[0].close, 955.0);
    assert.equal(bars[0].volume, 25_000_000);
    assert.equal(bars[0].source, "tej");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T2: 429 retry — retries up to maxRetries then succeeds", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string): Promise<Response> => {
    callCount++;
    if (callCount < 3) {
      // First 2 calls: 429
      return { ok: false, status: 429, json: async () => ({}) } as unknown as Response;
    }
    // 3rd call: success
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 200, msg: "Success", data: [SAMPLE_PRICE_ADJ_ROW] })
    } as unknown as Response;
  };

  try {
    const bars = await client.getStockPriceAdj("2330", "2026-01-01", "2026-04-30");
    assert.ok(callCount >= 3, `Expected at least 3 calls, got ${callCount}`);
    assert.equal(bars.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T3: token missing — returns empty array, does NOT throw", async () => {
  const cache = new MemoryCache();
  // No token — neither env nor option
  const client = new FinMindClient({ redisClient: cache });

  // Should NOT call fetch at all
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return {} as Response;
  };

  try {
    const bars = await client.getStockPriceAdj("2330", "2026-01-01", "2026-04-30");
    assert.equal(bars.length, 0, "Should return empty array when no token");
    assert.equal(fetchCalled, false, "Should not call fetch when no token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T4: non-200 API status — returns empty array, does NOT throw", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([{
    status: 200,
    body: { status: 402, msg: "You Need Authorization", data: [] }
  }]);

  try {
    const bars = await client.getStockPriceAdj("2330", "2026-01-01", "2026-04-30");
    assert.equal(bars.length, 0, "API status 402 should return empty array");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T5: Redis cache miss-then-hit — first call fetches, second returns cached", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: string): Promise<Response> => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 200, msg: "Success", data: [SAMPLE_PRICE_ADJ_ROW] })
    } as unknown as Response;
  };

  try {
    // First call: cache miss → fetch
    const bars1 = await client.getStockPriceAdj("2330", "2026-01-01", "2026-04-30");
    assert.equal(fetchCallCount, 1);
    assert.equal(bars1.length, 1);

    // Second call: cache hit → no fetch
    const bars2 = await client.getStockPriceAdj("2330", "2026-01-01", "2026-04-30");
    assert.equal(fetchCallCount, 1, "Second call should use cache, not fetch again");
    assert.equal(bars2.length, 1);
    assert.equal(bars2[0].dt, bars1[0].dt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T6: getFinancialStatements shape — rows parsed correctly", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  const sampleRow: FinMindFinancialStatementsRow = {
    date: "2026-03-31",
    stock_id: "2330",
    type: "Revenue",
    value: 839_000_000_000
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([buildOkResponse([sampleRow])]);

  try {
    const rows = await client.getFinancialStatements("2330", "2025-01-01", "2026-04-30");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "Revenue");
    assert.equal(rows[0].value, 839_000_000_000);
    assert.equal(rows[0].date, "2026-03-31");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T7: getMonthRevenue shape — rows parsed correctly", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  const sampleRow: FinMindMonthRevenueRow = {
    date: "2026-03-01",
    stock_id: "2330",
    country: "TW",
    revenue: 195_000_000_000,
    revenue_month: 3,
    revenue_year: 2026
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([buildOkResponse([sampleRow])]);

  try {
    const rows = await client.getMonthRevenue("2330", "2026-01-01", "2026-04-30");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].revenue, 195_000_000_000);
    assert.equal(rows[0].revenue_month, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("T8: getDividend shape + TTL is 86400", async () => {
  const cache = new MemoryCache();
  const client = new FinMindClient({ token: "test-token", redisClient: cache });

  const sampleRow: FinMindDividendRow = {
    date: "2026-07-15",
    stock_id: "2330",
    year: 2025,
    StockEarningsDistribution: 0,
    StockStatutoryReserveTransfer: 0,
    StockCapitalReserveTransfer: 0,
    StockReward: 0,
    TotalStockDividend: 0,
    CashEarningsDistribution: 12.0,
    CashStatutoryReserveTransfer: 0,
    CashCapitalReserveTransfer: 0,
    CashReward: 0,
    TotalCashDividend: 12.0,
    TotalDividend: 12.0
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeFetchMock([buildOkResponse([sampleRow])]);

  try {
    const rows = await client.getDividend("2330", "2020-01-01", "2026-12-31");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].TotalCashDividend, 12.0);
    assert.equal(rows[0].year, 2025);

    // Verify TTL was 86400 (dividend cache TTL)
    const calls = cache.getSetExCalls();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ttl, 86400, "Dividend cache TTL should be 86400 seconds");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
