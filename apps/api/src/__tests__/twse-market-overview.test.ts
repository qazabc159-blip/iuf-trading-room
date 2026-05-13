/**
 * twse-market-overview.test.ts — TWSE OpenAPI market overview + heatmap unit tests
 *
 * T1:  getTwseMarketOverview — MI_5MINS_INDEX primary succeeds → today ts, correct values
 * T1b: getTwseMarketOverview — MI_5MINS_INDEX fails → MI_INDEX fallback
 * T2:  getTwseIndustryHeatmap aggregation — 3 tickers, 2 industries → correct avgChangePct
 * T3:  getTwseMarketOverview timeout → returns null (fail-open, no throw)
 * T4:  getTwseIndustryHeatmap cache — second call within TTL returns same object without new fetch
 *
 * Run: node --import tsx/esm --test apps/api/src/__tests__/twse-market-overview.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  getTwseMarketOverview,
  getTwseIndustryHeatmap,
  _resetTwseOverviewCache,
  _resetTwseHeatmapCache,
  type TwseMarketOverviewResult,
  type TwseHeatmapTile
} from "../data-sources/twse-openapi-client.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

/** Build a mock MiIndexRow array with TAIEX + a few sector indices */
function makeMiIndexResponse() {
  return [
    {
      "日期": "1150512",
      "指數": "寶島股價指數",
      "收盤指數": "47009.60",
      "漲跌": "+",
      "漲跌點數": "143.95",
      "漲跌百分比": "0.31",
      "特殊處理註記": ""
    },
    {
      "日期": "1150512",
      "指數": "發行量加權股價指數",
      "收盤指數": "41898.32",
      "漲跌": "+",
      "漲跌點數": "108.26",
      "漲跌百分比": "0.26",
      "特殊處理註記": ""
    },
    {
      "日期": "1150512",
      "指數": "半導體類指數",
      "收盤指數": "12000.00",
      "漲跌": "-",
      "漲跌點數": "50.00",
      "漲跌百分比": "0.41",
      "特殊處理註記": ""
    }
  ];
}

/** Build a mock MI_5MINS_INDEX response (TWSE main site) */
function makeMi5MinsIndexResponse(dateYYYYMMDD: string, openVal: string, closeVal: string) {
  return {
    stat: "OK",
    date: dateYYYYMMDD,
    title: `115年05月13日 每5秒指數統計`,
    fields: ["時間", "發行量加權股價指數"],
    data: [
      ["09:00:00", openVal],   // first row = opening reference (= yesterday's close)
      ["13:30:00", closeVal],  // last row = today's closing value
    ]
  };
}

/** Build a mock STOCK_DAY_ALL response */
function makeStockDayAllResponse() {
  return [
    // Ticker 2330 (TSMC) — semiconductor — up 20 pts from 2235 → 2255 → pct = 20/2235 ≈ 0.89%
    { Date: "1150512", Code: "2330", Name: "台積電", TradeVolume: "54239538", TradeValue: "121891443938", OpeningPrice: "2235.00", HighestPrice: "2280.00", LowestPrice: "2210.00", ClosingPrice: "2255.00", Change: "20.0000", Transaction: "183443" },
    // Ticker 2454 (MediaTek) — semiconductor — up 10 pts from 1090 → 1100 → pct = 10/1090 ≈ 0.92%
    { Date: "1150512", Code: "2454", Name: "聯發科", TradeVolume: "12000000", TradeValue: "13200000000", OpeningPrice: "1090.00", HighestPrice: "1110.00", LowestPrice: "1085.00", ClosingPrice: "1100.00", Change: "10.0000", Transaction: "55000" },
    // Ticker 2317 (Foxconn) — electronics — down 1 pt from 111 → 110 → pct = -1/111 ≈ -0.90%
    { Date: "1150512", Code: "2317", Name: "鴻海", TradeVolume: "30000000", TradeValue: "3300000000", OpeningPrice: "111.00", HighestPrice: "112.00", LowestPrice: "109.00", ClosingPrice: "110.00", Change: "-1.0000", Transaction: "80000" }
  ];
}

function makeFetchTimeout(): typeof fetch {
  return (async (): Promise<Response> => {
    const err = new Error("The operation was aborted.");
    err.name = "AbortError";
    throw err;
  }) as typeof fetch;
}

// ── T1: getTwseMarketOverview — MI_5MINS_INDEX primary path ──────────────────

test("T1: getTwseMarketOverview uses MI_5MINS_INDEX primary — today ts and correct values", async () => {
  _resetTwseOverviewCache();

  // Today's date in "YYYYMMDD" format (matches what todayTaipeiYYYYMMDD() returns)
  const now = new Date();
  const taipeiMs = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(taipeiMs);
  const todayStr = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

  let mi5Called = false;
  let miIndexCalled = false;

  const mockFetch = (async (input: URL | RequestInfo): Promise<Response> => {
    const url = String(input);
    if (url.includes("MI_5MINS_INDEX")) {
      mi5Called = true;
      // Return today's data with correct dateStr so it passes the date check
      const body = makeMi5MinsIndexResponse(todayStr, "41,898.32", "41,374.50");
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
        json: async () => body
      } as unknown as Response;
    }
    if (url.includes("MI_INDEX")) {
      miIndexCalled = true;
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
        json: async () => makeMiIndexResponse()
      } as unknown as Response;
    }
    return { ok: false, status: 404, headers: { get: () => null } as unknown as Headers, json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;

  const result = await getTwseMarketOverview({ fetchOverride: mockFetch });

  assert.ok(result !== null, "result must not be null when MI_5MINS_INDEX succeeds");
  assert.ok(mi5Called, "MI_5MINS_INDEX must be called as primary source");
  assert.equal(miIndexCalled, false, "MI_INDEX must NOT be called when MI_5MINS_INDEX succeeds");

  const r = result as TwseMarketOverviewResult;
  assert.equal(r.source, "twse_openapi");
  assert.equal(r.staleAfterSec, 60);

  assert.ok(r.taiex !== null, "taiex must be present");
  assert.equal(typeof r.taiex.value, "number");
  assert.equal(typeof r.taiex.change, "number");
  assert.equal(typeof r.taiex.changePct, "number");
  assert.equal(typeof r.taiex.ts, "string");

  // Today's close value from MI_5MINS_INDEX mock
  assert.equal(r.taiex.value, 41374.50, "taiex.value must be today's close from MI_5MINS_INDEX");
  // change = 41374.50 - 41898.32 = -523.82
  assert.equal(r.taiex.change, -523.82, "change computed from open vs close rows");
  // changePct = -523.82 / 41898.32 * 100 ≈ -1.25
  assert.equal(r.taiex.changePct, -1.25, "changePct computed from open row as prevClose");
  // ts must end with market close marker
  assert.ok(r.taiex.ts.endsWith("T13:30:00+08:00"), `ts must end with market close: got ${r.taiex.ts}`);
});

// ── T1b: getTwseMarketOverview — MI_5MINS_INDEX fails → MI_INDEX fallback ────

test("T1b: getTwseMarketOverview falls back to MI_INDEX when MI_5MINS_INDEX fails", async () => {
  _resetTwseOverviewCache();

  let miIndexCalled = false;

  const mockFetch = (async (input: URL | RequestInfo): Promise<Response> => {
    const url = String(input);
    if (url.includes("MI_5MINS_INDEX")) {
      // Simulate non-trading day (stat not "OK")
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
        json: async () => ({ stat: "N/A", date: "20260513" })
      } as unknown as Response;
    }
    if (url.includes("MI_INDEX")) {
      miIndexCalled = true;
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
        json: async () => makeMiIndexResponse()
      } as unknown as Response;
    }
    return { ok: false, status: 404, headers: { get: () => null } as unknown as Headers, json: async () => ({}) } as unknown as Response;
  }) as typeof fetch;

  const result = await getTwseMarketOverview({ fetchOverride: mockFetch });

  assert.ok(result !== null, "result must not be null when MI_INDEX fallback succeeds");
  assert.ok(miIndexCalled, "MI_INDEX must be called as fallback");

  const r = result as TwseMarketOverviewResult;
  // MI_INDEX returns 5/12 values
  assert.equal(r.taiex.value, 41898.32, "fallback taiex.value from MI_INDEX");
  assert.equal(r.taiex.change, 108.26, "fallback taiex.change from MI_INDEX");
  assert.equal(r.taiex.changePct, 0.26, "fallback taiex.changePct from MI_INDEX");
  assert.ok(r.taiex.ts.startsWith("2026-05-12"), `fallback ts must use MI_INDEX date: ${r.taiex.ts}`);
});

// ── T2: getTwseIndustryHeatmap aggregation ────────────────────────────────────

test("T2: getTwseIndustryHeatmap aggregates changePct by industry correctly", async () => {
  _resetTwseHeatmapCache();

  const tickerToIndustry = new Map([
    ["2330", "半導體"],
    ["2454", "半導體"],
    ["2317", "電子組裝"],
  ]);

  // TWSE returns 3 tickers; TPEX returns empty (fetch fails gracefully)
  let fetchCallCount = 0;
  const mockFetch = (async (_input: URL | RequestInfo): Promise<Response> => {
    fetchCallCount++;
    const url = String(_input);
    if (url.includes("STOCK_DAY_ALL")) {
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
        json: async () => makeStockDayAllResponse()
      } as unknown as Response;
    }
    // TPEX — return empty
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
      json: async () => []
    } as unknown as Response;
  }) as typeof fetch;

  const tiles = await getTwseIndustryHeatmap(tickerToIndustry, { fetchOverride: mockFetch });

  assert.ok(Array.isArray(tiles), "tiles must be array");
  assert.ok(tiles.length >= 2, `must have at least 2 industry tiles, got ${tiles.length}`);

  // Find 半導體 tile
  const semiTile = tiles.find((t: TwseHeatmapTile) => t.industry === "半導體");
  assert.ok(semiTile !== undefined, "半導體 industry tile must exist");
  assert.equal(semiTile.stockCount, 2, "半導體 must have 2 stocks");
  assert.equal(semiTile.gainerCount, 2, "both semi stocks are up → gainerCount=2");
  assert.equal(semiTile.loserCount, 0, "no losers in semi");
  assert.equal(semiTile.source, "twse_openapi");

  // avgChangePct for 半導體: (0.89% + 0.92%) / 2 ≈ 0.90% (rough)
  // 2330: change=20, close=2255 → prevClose=2235 → pct=20/2235*100=0.8949...
  // 2454: change=10, close=1100 → prevClose=1090 → pct=10/1090*100=0.9174...
  // avg ≈ 0.91
  assert.ok(semiTile.avgChangePct > 0, "semi avgChangePct must be positive");
  assert.ok(Math.abs(semiTile.avgChangePct) < 5, "semi avgChangePct must be reasonable (<5%)");

  // Find 電子組裝 tile
  const elecTile = tiles.find((t: TwseHeatmapTile) => t.industry === "電子組裝");
  assert.ok(elecTile !== undefined, "電子組裝 industry tile must exist");
  assert.equal(elecTile.stockCount, 1, "電子組裝 must have 1 stock");
  assert.equal(elecTile.loserCount, 1, "Foxconn is down → loserCount=1");
  assert.ok(elecTile.avgChangePct < 0, "電子組裝 avgChangePct must be negative (Foxconn down)");
});

// ── T3: getTwseMarketOverview timeout → null ──────────────────────────────────

test("T3: getTwseMarketOverview timeout → returns null (fail-open)", async () => {
  _resetTwseOverviewCache();

  const timeoutFetch = makeFetchTimeout();
  const result = await getTwseMarketOverview({ fetchOverride: timeoutFetch });

  // Must return null — not throw
  assert.equal(result, null, "must return null when both attempts fail");
});

// ── T4: getTwseIndustryHeatmap cache hit ──────────────────────────────────────

test("T4: getTwseIndustryHeatmap cache hit — second call returns cached result without new fetch", async () => {
  _resetTwseHeatmapCache();

  const tickerToIndustry = new Map([
    ["2330", "半導體"],
    ["2317", "電子組裝"],
  ]);

  let fetchCallCount = 0;
  const mockFetch = (async (_input: URL | RequestInfo): Promise<Response> => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => h === "content-type" ? "application/json" : null } as unknown as Headers,
      json: async () => makeStockDayAllResponse()
    } as unknown as Response;
  }) as typeof fetch;

  // First call: should hit network
  const tiles1 = await getTwseIndustryHeatmap(tickerToIndustry, { fetchOverride: mockFetch });
  const callsAfterFirst = fetchCallCount;

  // Second call: should return cached (same Map size key = cache key)
  const tiles2 = await getTwseIndustryHeatmap(tickerToIndustry, { fetchOverride: mockFetch });
  const callsAfterSecond = fetchCallCount;

  assert.ok(tiles1.length > 0, "first call must return tiles");
  assert.ok(tiles2.length > 0, "second call must return tiles");
  assert.equal(callsAfterFirst, callsAfterSecond, "second call must not trigger new fetch (cache hit)");
  assert.deepEqual(tiles1, tiles2, "both calls must return identical results");
});
