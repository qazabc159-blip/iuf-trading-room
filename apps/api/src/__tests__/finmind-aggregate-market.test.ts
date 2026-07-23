/**
 * finmind-aggregate-market.test.ts — BG #2: FinMind primary chain unit tests
 *
 * Tests for finmind-aggregate-client.ts:
 *   FA1: getFinMindWholeMarketPrice returns rows when token present
 *   FA2: getFinMindIndustryHeatmap aggregates correctly by industry
 *   FA3: getFinMindMarketBreadth counts up/down/flat correctly
 *   FA4: getFinMindLeaders returns top N gainers/losers/active sorted correctly
 *   FA5: getFinMindInstitutionalSummary aggregates institutions + net rankings
 *   FA6: no token → functions return null (fail-open)
 *   FA7: promise coalescing — concurrent callers share one inflight fetch
 *   FA8: getFinMindMarketNews deduplicates titles + limits to N items
 *   FA9: getFinMindInstitutionalSummaryWithFallback — intraday (today not yet
 *        published) falls back to the most recent PRIOR trading day with an
 *        honest dataDate/isFallback label (2026-07-23 P0 fix)
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getFinMindWholeMarketPrice,
  getFinMindIndustryHeatmap,
  getFinMindMarketBreadth,
  getFinMindLeaders,
  getFinMindInstitutionalSummary,
  getFinMindInstitutionalSummaryWithFallback,
  getFinMindMarketNews,
  getFinMindMarginSummary,
  finMindAggregateHasToken,
  todayTaipei,
  _resetFinMindAggregateCache
} from "../data-sources/finmind-aggregate-client.js";

// ── Mock fetch ────────────────────────────────────────────────────────────────

const MOCK_TOKEN = "test-token-fa";

/** Build a FinMind-style response envelope */
function finmindEnvelope<T>(data: T[]): string {
  return JSON.stringify({ status: 200, msg: "Success", data });
}

/** Minimal whole-market price rows for testing */
function makePriceRows() {
  return [
    { date: "2026-05-13", stock_id: "2330", Trading_Volume: 1000000, Trading_money: 900000000, open: 900, max: 920, min: 890, close: 910, spread: 20, Trading_turnover: 5000 },
    { date: "2026-05-13", stock_id: "2317", Trading_Volume: 500000, Trading_money: 100000000, open: 200, max: 205, min: 195, close: 198, spread: -5, Trading_turnover: 2000 },
    { date: "2026-05-13", stock_id: "2454", Trading_Volume: 300000, Trading_money: 300000000, open: 1000, max: 1050, min: 990, close: 1020, spread: 30, Trading_turnover: 1500 },
    { date: "2026-05-13", stock_id: "2412", Trading_Volume: 200000, Trading_money: 50000000, open: 250, max: 252, min: 248, close: 250, spread: 0, Trading_turnover: 800 },
    { date: "2026-05-13", stock_id: "1301", Trading_Volume: 100000, Trading_money: 8000000, open: 80, max: 82, min: 79, close: 79, spread: -2, Trading_turnover: 400 },
  ];
}

function makeInstitutionalRows() {
  return [
    { date: "2026-05-13", stock_id: "2330", name: "外陸資", buy: 10000000, sell: 5000000 },
    { date: "2026-05-13", stock_id: "2317", name: "外陸資", buy: 2000000, sell: 3000000 },
    { date: "2026-05-13", stock_id: "2330", name: "投信", buy: 500000, sell: 200000 },
    { date: "2026-05-13", stock_id: "2454", name: "自營商", buy: 800000, sell: 400000 },
    { date: "2026-05-13", stock_id: "2412", name: "投信", buy: 100000, sell: 600000 },
  ];
}

// Wire shape uses "link", NOT "url" (real FinMind TaiwanStockNews field name —
// see #1343 / finmind-client.ts). Fixture intentionally mirrors the real wire
// field so this test would have caught the url/link mismatch bug.
function makeNewsRows() {
  return [
    { date: "2026-05-13 14:00:00", stock_id: "2330", title: "台積電法說會重點", link: "https://example.com/1", source_name: "財經日報" },
    { date: "2026-05-13 13:30:00", stock_id: "2317", title: "鴻海Q1獲利公告", link: null, source_name: null },
    { date: "2026-05-13 12:00:00", stock_id: "2330", title: "台積電法說會重點", link: "https://example.com/1", source_name: "財經日報" }, // duplicate title
    { date: "2026-05-13 11:00:00", stock_id: "2454", title: "聯發科新品發布", link: "https://example.com/3", source_name: "科技週刊" },
  ];
}

// Store original fetch
const originalFetch = globalThis.fetch;
let fetchCallCount = 0;

function mockFetch(responseMap: Record<string, string>) {
  fetchCallCount = 0;
  globalThis.fetch = async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCallCount++;

    // Find matching dataset key
    for (const [key, body] of Object.entries(responseMap)) {
      if (url.includes(key)) {
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({ status: 404, msg: "not found", data: [] }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

before(() => {
  // Set mock token
  process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.FINMIND_API_TOKEN;
  _resetFinMindAggregateCache();
});

beforeEach(() => {
  _resetFinMindAggregateCache();
});

// ── FA1: getFinMindWholeMarketPrice ───────────────────────────────────────────

describe("FA1: getFinMindWholeMarketPrice", () => {
  it("returns rows from TaiwanStockPrice whole-market query", async () => {
    const priceRows = makePriceRows();
    mockFetch({
      "TaiwanStockPrice": finmindEnvelope(priceRows)
    });

    const rows = await getFinMindWholeMarketPrice("2026-05-13");
    assert.equal(rows.length, 5, "should return 5 rows");
    assert.equal(rows[0].stock_id, "2330");
    assert.equal(rows[0].close, 910);
    assert.equal(rows[0].spread, 20);
    // Token must not appear in any logged/returned value (we check url contained token by existence only)
    // Just verify data shape
    assert.ok(fetchCallCount >= 1, "fetch should have been called");
  });
});

// ── FA2: getFinMindIndustryHeatmap ────────────────────────────────────────────

describe("FA2: getFinMindIndustryHeatmap", () => {
  it("aggregates changePct by industry from price rows", async () => {
    const priceRows = makePriceRows();
    mockFetch({
      "TaiwanStockPrice": finmindEnvelope(priceRows)
    });

    const tickerToIndustry = new Map<string, string>([
      ["2330", "半導體"],
      ["2317", "電子代工"],
      ["2454", "半導體"],  // 2 stocks in 半導體
      ["2412", "電信"],
      ["1301", "化工"]
    ]);

    const tiles = await getFinMindIndustryHeatmap(tickerToIndustry, "2026-05-13");
    assert.ok(tiles !== null, "should return tiles array");
    assert.ok(tiles!.length >= 4, "should have 4+ industries");

    const semitile = tiles!.find(t => t.industry === "半導體");
    assert.ok(semitile, "should have 半導體 tile");
    assert.equal(semitile!.stockCount, 2, "半導體 should have 2 stocks (2330 + 2454)");
    assert.ok(semitile!.gainerCount === 2, "both 半導體 stocks gained (spread > 0)");
    assert.equal(semitile!.source, "finmind");

    const chemical = tiles!.find(t => t.industry === "化工");
    assert.ok(chemical, "should have 化工 tile");
    assert.equal(chemical!.loserCount, 1, "1301 lost (spread -2)");
  });

  it("returns null when no rows returned (FinMind empty)", async () => {
    mockFetch({
      "TaiwanStockPrice": finmindEnvelope([])
    });
    const tiles = await getFinMindIndustryHeatmap(new Map(), "2026-05-13");
    assert.equal(tiles, null, "should return null on empty rows");
  });
});

// ── FA3: getFinMindMarketBreadth ──────────────────────────────────────────────

describe("FA3: getFinMindMarketBreadth", () => {
  it("counts up/down/flat correctly", async () => {
    mockFetch({
      "TaiwanStockPrice": finmindEnvelope(makePriceRows())
    });

    const result = await getFinMindMarketBreadth("2026-05-13");
    assert.ok(result !== null, "should return breadth result");
    // Rows: 2330 spread+20 (up), 2317 spread-5 (down), 2454 spread+30 (up), 2412 spread=0 (flat), 1301 spread-2 (down)
    assert.equal(result!.up, 2, "2 gainers (2330, 2454)");
    assert.equal(result!.down, 2, "2 losers (2317, 1301)");
    assert.equal(result!.flat, 1, "1 flat (2412)");
    assert.equal(result!.total, 5);
    assert.equal(result!.source, "finmind");
    assert.ok(result!.asOf?.includes("2026-05-13"), "asOf should include date");
  });
});

// ── FA4: getFinMindLeaders ────────────────────────────────────────────────────

describe("FA4: getFinMindLeaders", () => {
  it("returns top N gainers sorted by changePct desc", async () => {
    mockFetch({
      "TaiwanStockPrice": finmindEnvelope(makePriceRows())
    });

    const result = await getFinMindLeaders("2026-05-13", 3);
    assert.ok(result !== null);
    // 2454 spread=30, prevClose=990 → +3.03%. 2330 spread=20, prevClose=890 → +2.25%
    assert.ok(result!.topGainers.length <= 3);
    assert.equal(result!.topGainers[0].stockId, "2454", "highest gainer should be 2454");
    assert.ok(result!.topGainers[0].changePct > result!.topGainers[1].changePct, "gainers sorted desc");

    // Losers: 1301 spread=-2, prevClose=81 → -2.47%. 2317 spread=-5, prevClose=203 → -2.46%
    assert.ok(result!.topLosers.length >= 2);
    // 1301 should be bigger loser
    const loserPcts = result!.topLosers.map(r => r.changePct);
    assert.ok(loserPcts[0] < loserPcts[1] || loserPcts.length === 1, "losers sorted asc (most negative first)");

    // Most active by Trading_money
    assert.equal(result!.mostActive[0].stockId, "2330", "most active by volume should be 2330 (900M)");
    assert.equal(result!.source, "finmind");
  });
});

// ── FA5: getFinMindInstitutionalSummary ───────────────────────────────────────

describe("FA5: getFinMindInstitutionalSummary", () => {
  it("aggregates institutions and computes net buy/sell stocks", async () => {
    mockFetch({
      "TaiwanStockInstitutionalInvestorsBuySell": finmindEnvelope(makeInstitutionalRows())
    });

    const result = await getFinMindInstitutionalSummary("2026-05-13");
    assert.ok(result !== null, "should return institutional summary");

    // 外陸資: buy=12M, sell=8M, net=+4M
    const foreign = result!.institutions.find(i => i.name === "外陸資");
    assert.ok(foreign, "should have 外陸資");
    assert.equal(foreign!.buy, 12000000, "外陸資 total buy = 10M+2M");
    assert.equal(foreign!.sell, 8000000, "外陸資 total sell = 5M+3M");
    assert.equal(foreign!.net, 4000000, "外陸資 net = 4M");

    // Top net buy: 2330 net = (10M-5M)+(500K-200K) = 5.3M
    assert.ok(result!.topNetBuy.length >= 1);
    assert.equal(result!.topNetBuy[0].stockId, "2330", "2330 should be top net buy");
    assert.equal(result!.source, "finmind");
  });
});

// ── FA6: no token → null / empty ─────────────────────────────────────────────

describe("FA6: no token — fail-open", () => {
  before(() => {
    delete process.env.FINMIND_API_TOKEN;
  });

  after(() => {
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
  });

  it("finMindAggregateHasToken returns false", () => {
    assert.equal(finMindAggregateHasToken(), false);
  });

  it("getFinMindWholeMarketPrice returns empty when no token", async () => {
    const rows = await getFinMindWholeMarketPrice("2026-05-13");
    assert.deepEqual(rows, []);
  });

  it("getFinMindIndustryHeatmap returns null when no token", async () => {
    const tiles = await getFinMindIndustryHeatmap(new Map(), "2026-05-13");
    assert.equal(tiles, null);
  });

  it("getFinMindMarketBreadth returns null when no token", async () => {
    const result = await getFinMindMarketBreadth("2026-05-13");
    assert.equal(result, null);
  });

  it("getFinMindLeaders returns null when no token", async () => {
    const result = await getFinMindLeaders("2026-05-13");
    assert.equal(result, null);
  });

  it("getFinMindInstitutionalSummary returns null when no token", async () => {
    const result = await getFinMindInstitutionalSummary("2026-05-13");
    assert.equal(result, null);
  });
});

// ── FA7: promise coalescing ───────────────────────────────────────────────────

describe("FA7: promise coalescing", () => {
  it("concurrent calls for same date share one inflight fetch", async () => {
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
    let fetchCount = 0;
    globalThis.fetch = async (_input: string | URL | Request): Promise<Response> => {
      fetchCount++;
      // Slow fetch to allow concurrent calls to pile up
      await new Promise(resolve => setTimeout(resolve, 20));
      return new Response(finmindEnvelope(makePriceRows()), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    // Fire 3 concurrent requests for same date
    const [r1, r2, r3] = await Promise.all([
      getFinMindWholeMarketPrice("2026-05-13"),
      getFinMindWholeMarketPrice("2026-05-13"),
      getFinMindWholeMarketPrice("2026-05-13")
    ]);

    assert.equal(fetchCount, 1, "only 1 fetch should fire (promise coalescing)");
    assert.equal(r1.length, 5);
    assert.equal(r2.length, 5);
    assert.equal(r3.length, 5);
  });
});

// ── FA8: news deduplication ───────────────────────────────────────────────────

describe("FA8: getFinMindMarketNews deduplication", () => {
  it("deduplicates by title and limits to N items", async () => {
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
    mockFetch({
      "TaiwanStockNews": finmindEnvelope(makeNewsRows())
    });

    // 4 rows but 1 duplicate title → 3 unique
    const result = await getFinMindMarketNews("2026-05-13", 10);
    assert.ok(result !== null);
    assert.equal(result!.items.length, 3, "3 unique news items (1 duplicate removed)");

    // Sorted by date desc
    assert.equal(result!.items[0].title, "台積電法說會重點", "most recent first");
    assert.equal(result!.source, "finmind");
  });

  it("limits to specified N items", async () => {
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
    mockFetch({
      "TaiwanStockNews": finmindEnvelope(makeNewsRows())
    });

    const result = await getFinMindMarketNews("2026-05-13", 2);
    assert.ok(result !== null);
    assert.equal(result!.items.length, 2, "should return max 2 items");
  });

  it("maps wire field 'link' -> items[].url, dropping non-http(s)/missing values", async () => {
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
    mockFetch({
      "TaiwanStockNews": finmindEnvelope([
        { date: "2026-05-13 14:00:00", stock_id: "2330", title: "有效連結新聞", link: "https://example.com/valid", source_name: "財經日報" },
        { date: "2026-05-13 13:00:00", stock_id: "2317", title: "缺連結新聞", link: null, source_name: null },
        { date: "2026-05-13 12:00:00", stock_id: "2454", title: "惡意協議新聞", link: "javascript:alert(1)", source_name: "科技週刊" },
      ])
    });

    const result = await getFinMindMarketNews("2026-05-13", 10);
    assert.ok(result !== null);
    assert.equal(result!.items.length, 3);

    const byTitle = new Map(result!.items.map((item) => [item.title, item]));
    assert.equal(byTitle.get("有效連結新聞")!.url, "https://example.com/valid", "real http(s) link passes through");
    assert.equal(byTitle.get("缺連結新聞")!.url, null, "missing link -> null, not undefined/crash");
    assert.equal(byTitle.get("惡意協議新聞")!.url, null, "non-http(s) protocol dropped, not passed through");
  });
});

// ── FA9: getFinMindInstitutionalSummaryWithFallback — intraday fallback ───────
//
// FinMind only publishes 三大法人 buy/sell data AFTER TWSE's afternoon close,
// so a bare getFinMindInstitutionalSummary() (always "today") returns empty
// for the entire morning/early-afternoon session, every trading day — not a
// transient failure, a structural gap. These tests use a fixed `nowMs`
// (never the real wall clock) so they're deterministic regardless of what
// day CI actually runs on, and derive expected dates from the SAME
// `todayTaipei()`/`mostRecentTradingDayYYYYMMDD()` functions production
// code uses, rather than re-implementing (and risking drifting from) the
// Taipei-date/calendar conversion logic.
function makeInstitutionalRowsForDate(date: string) {
  return [
    { date, stock_id: "2330", name: "外陸資", buy: 10_000_000, sell: 5_000_000 },
    { date, stock_id: "2330", name: "投信", buy: 500_000, sell: 200_000 },
  ];
}

describe("FA9: getFinMindInstitutionalSummaryWithFallback", () => {
  before(() => {
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
  });

  it("intraday (today not yet published) falls back to the previous trading day (Wed -> Tue, no weekend to skip)", async () => {
    // 2026-07-08 is a Wednesday (verified: `date -u -d 2026-07-08 +%A`).
    const nowMs = Date.UTC(2026, 6, 8, 6, 0, 0); // 06:00 UTC = 14:00 Taipei — clear of the UTC-midnight boundary
    const todayIso = todayTaipei(nowMs);
    assert.equal(todayIso, "2026-07-08", "sanity: nowMs must resolve to the intended Taipei date");

    const { mostRecentTradingDayYYYYMMDD } = await import("../data-sources/twse-openapi-client.js");
    const expectedPriorYYYYMMDD = await mostRecentTradingDayYYYYMMDD("20260707");
    const expectedPriorIso = `${expectedPriorYYYYMMDD.slice(0, 4)}-${expectedPriorYYYYMMDD.slice(4, 6)}-${expectedPriorYYYYMMDD.slice(6, 8)}`;
    assert.equal(expectedPriorIso, "2026-07-07", "sanity: Tuesday is itself a trading day, no walk-back needed");

    mockFetch({
      "TaiwanStockInstitutionalInvestorsBuySell&start_date=2026-07-08": finmindEnvelope([]), // not published yet
      "TaiwanStockInstitutionalInvestorsBuySell&start_date=2026-07-07": finmindEnvelope(makeInstitutionalRowsForDate("2026-07-07")),
    });

    const result = await getFinMindInstitutionalSummaryWithFallback(nowMs);
    assert.ok(result !== null, "should fall back to prior trading day's real data, not return null");
    assert.equal(result!.isFallback, true);
    assert.equal(result!.dataDate, expectedPriorIso, "dataDate must honestly reflect the prior trading day, not today");
    assert.ok(result!.asOf?.startsWith(expectedPriorIso), "asOf must be dated the prior trading day, not claim today/live");

    const foreign = result!.institutions.find((i) => i.name === "外陸資");
    assert.ok(foreign, "should aggregate the fallback day's real institutional rows");
    assert.equal(foreign!.net, 5_000_000);
  });

  it("intraday Monday walks back over the weekend to Friday (skips Sat/Sun, not just yesterday)", async () => {
    // 2026-07-13 is a Monday (verified: `date -u -d 2026-07-13 +%A`).
    const nowMs = Date.UTC(2026, 6, 13, 6, 0, 0);
    const todayIso = todayTaipei(nowMs);
    assert.equal(todayIso, "2026-07-13", "sanity: nowMs must resolve to the intended Taipei Monday");

    const { mostRecentTradingDayYYYYMMDD } = await import("../data-sources/twse-openapi-client.js");
    const expectedPriorYYYYMMDD = await mostRecentTradingDayYYYYMMDD("20260712"); // yesterday = Sunday
    const expectedPriorIso = `${expectedPriorYYYYMMDD.slice(0, 4)}-${expectedPriorYYYYMMDD.slice(4, 6)}-${expectedPriorYYYYMMDD.slice(6, 8)}`;
    assert.equal(expectedPriorIso, "2026-07-10", "sanity: must walk back past Sun+Sat to Friday, not stop at Sunday");

    mockFetch({
      "TaiwanStockInstitutionalInvestorsBuySell&start_date=2026-07-13": finmindEnvelope([]),
      "TaiwanStockInstitutionalInvestorsBuySell&start_date=2026-07-10": finmindEnvelope(makeInstitutionalRowsForDate("2026-07-10")),
    });

    const result = await getFinMindInstitutionalSummaryWithFallback(nowMs);
    assert.ok(result !== null);
    assert.equal(result!.isFallback, true);
    assert.equal(result!.dataDate, "2026-07-10", "must land on Friday, never a non-trading weekend date");
  });

  it("when today's data IS already published, returns it directly (isFallback:false) with exactly one fetch (no wasted fallback lookup)", async () => {
    const nowMs = Date.UTC(2026, 6, 8, 6, 0, 0);
    const todayIso = todayTaipei(nowMs);
    assert.equal(todayIso, "2026-07-08");

    mockFetch({
      "TaiwanStockInstitutionalInvestorsBuySell&start_date=2026-07-08": finmindEnvelope(makeInstitutionalRowsForDate("2026-07-08")),
    });

    const result = await getFinMindInstitutionalSummaryWithFallback(nowMs);
    assert.ok(result !== null);
    assert.equal(result!.isFallback, false);
    assert.equal(result!.dataDate, "2026-07-08");
    assert.equal(fetchCallCount, 1, "must not attempt a fallback lookup when today's data already succeeded");
  });

  it("no token -> null (fail-open, same convention as getFinMindInstitutionalSummary)", async () => {
    delete process.env.FINMIND_API_TOKEN;
    const result = await getFinMindInstitutionalSummaryWithFallback(Date.UTC(2026, 6, 8, 6, 0, 0));
    assert.equal(result, null);
    process.env.FINMIND_API_TOKEN = MOCK_TOKEN;
  });
});
