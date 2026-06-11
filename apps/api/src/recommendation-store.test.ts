import assert from "node:assert/strict";
import test from "node:test";

import type { AppSession } from "@iuf-trading-room/contracts";
import type { TradingRoomRepository } from "@iuf-trading-room/domain";
import {
  _resetAthenaFixtureCache,
  getTodayRecommendations,
} from "./recommendation-store.js";

function fakeSession(): AppSession {
  return {
    workspace: { id: "00000000-0000-0000-0000-000000000001", slug: "default", name: "Default" },
    user: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Owner",
      email: "owner@example.com",
      role: "Owner",
    },
    persistenceMode: "memory",
  };
}

function fakeRepo(tickers: string[]): Pick<TradingRoomRepository, "listCompaniesLite"> {
  return {
    listCompaniesLite: async () =>
      tickers.map((ticker) => ({
        id: `company-${ticker}`,
        ticker,
        name: ticker,
        market: "TWSE",
        chainPosition: "",
        beneficiaryTier: "",
        updatedAt: "2026-06-05T00:00:00.000Z",
      })),
  };
}

function buildFinMindRows(stockId: string): Array<Record<string, unknown>> {
  const seed = Number(stockId.slice(-2)) || 10;
  const rows: Array<Record<string, unknown>> = [];
  const cursor = new Date(Date.UTC(2025, 9, 1));
  let tradingDay = 0;
  while (rows.length < 180) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    tradingDay += 1;
    const close = 80 + seed + tradingDay * 0.35;
    rows.push({
      date: cursor.toISOString().slice(0, 10),
      stock_id: stockId,
      Trading_Volume: 1_000_000 + tradingDay * 1000,
      open: close - 0.8,
      max: close + 1.6,
      min: close - 2.0,
      close,
    });
  }
  return rows;
}

function finMindResponseForUrl(requestUrl: string): Response | null {
  if (!requestUrl.includes("finmindtrade.com")) return null;
  const parsed = new URL(requestUrl);
  const stockId = parsed.searchParams.get("data_id") ?? "2330";
  return Response.json({
    status: 200,
    msg: "success",
    data: buildFinMindRows(stockId),
  });
}

test("recommendations today derives trade plans without HTTP self-fetching company OHLCV", async () => {
  _resetAthenaFixtureCache();

  const oldFetch = globalThis.fetch;
  const oldToken = process.env["FINMIND_API_TOKEN"];
  process.env["FINMIND_API_TOKEN"] = "test-token";

  const httpCalls: string[] = [];
  globalThis.fetch = async (url: URL | RequestInfo) => {
    const requestUrl = String(url);
    httpCalls.push(requestUrl);

    const finMind = finMindResponseForUrl(requestUrl);
    if (finMind) return finMind;

    if (requestUrl.includes("/api/v1/market/leaders/twse")) {
      return Response.json({
        topGainers: [
          { symbol: "2330", name: "TSMC", last: 1000, changePct: 1.2, volume: 1000 },
          { symbol: "2454", name: "MediaTek", last: 1300, changePct: 0.8, volume: 900 },
        ],
        topLosers: [],
        mostActive: [
          { symbol: "2317", name: "Hon Hai", last: 160, changePct: 0.3, volume: 2000 },
        ],
        source: "test",
        asOf: "2026-06-05T08:00:00.000Z",
      });
    }

    if (requestUrl.includes("/api/v1/market-intel/announcements")) {
      return Response.json({
        data: {
          items: [
            {
              id: "news-1",
              date: "2026-06-05",
              title: "TSMC AI supply-chain context",
              ticker: "2330",
              companyName: "TSMC",
              source: "test",
            },
          ],
        },
      });
    }

    throw new Error(`unexpected HTTP call: ${requestUrl}`);
  };

  try {
    const result = await getTodayRecommendations({
      internalBaseUrl: "https://api.invalid",
      sessionCookie: "",
      session: fakeSession(),
      repo: fakeRepo(["3707", "2426", "6205", "2486", "2330", "2454", "2317"]) as TradingRoomRepository,
    });

    const incomplete = result.items.filter((item) => {
      const pricedTargets = item.targets.filter((target) => target.price !== null && target.price !== undefined);
      const hasTechnicalSource = item.sourceTrail.some((source) => source.type === "technical" && source.source !== "companies_ohlcv_mock");
      return !item.entryZone.primary || item.invalidation.price == null || pricedTargets.length < 2 || !hasTechnicalSource;
    });
    const leaderSupplement = result.items.find((item) => item.ticker === "2330");

    assert.equal(result.isMock, false);
    assert.ok(result.items.length >= 5, "should surface at least five real-backed recommendations");
    assert.deepEqual(incomplete.map((item) => item.ticker), []);
    assert.ok(leaderSupplement, "leader supplemental ticker should be present");
    assert.equal(
      leaderSupplement.sourceTrail.some((source) => source.type === "fixture"),
      false,
      "supplemental market candidates must not pretend to be Athena fixture entries"
    );
    assert.equal(
      httpCalls.filter((requestUrl) => requestUrl.includes("/api/v1/companies/")).length,
      0,
      "company OHLCV must come from the data layer, not API self-fetch"
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken) process.env["FINMIND_API_TOKEN"] = oldToken;
    else delete process.env["FINMIND_API_TOKEN"];
  }
});

test("recommendations today uses real-backed core market candidates when leaders and news are empty", async () => {
  _resetAthenaFixtureCache();

  const oldFetch = globalThis.fetch;
  const oldToken = process.env["FINMIND_API_TOKEN"];
  process.env["FINMIND_API_TOKEN"] = "test-token";

  globalThis.fetch = async (url: URL | RequestInfo) => {
    const requestUrl = String(url);

    const finMind = finMindResponseForUrl(requestUrl);
    if (finMind) return finMind;

    if (requestUrl.includes("/api/v1/market/leaders/twse")) {
      return Response.json({
        topGainers: [],
        topLosers: [],
        mostActive: [],
        source: "test-empty",
        asOf: "2026-06-05T08:00:00.000Z",
      });
    }

    if (requestUrl.includes("/api/v1/market-intel/announcements")) {
      return Response.json({ data: { items: [] } });
    }

    throw new Error(`unexpected HTTP call: ${requestUrl}`);
  };

  try {
    const result = await getTodayRecommendations({
      internalBaseUrl: "https://api.invalid",
      sessionCookie: "",
      session: fakeSession(),
      repo: fakeRepo(["3707", "2426", "6205", "2486", "2330", "2454", "2317", "2308", "3711", "2412"]) as TradingRoomRepository,
    });

    const backstop = result.items.find((item) => item.ticker === "2330");

    assert.equal(result.isMock, false);
    assert.ok(result.items.length >= 5, "empty leaders/news must not leave the product with only four cards");
    assert.ok(backstop, "core market backstop should supply at least one extra real-backed card");
    assert.equal(backstop.quant.strategySource, "core_market_watchlist");
    assert.equal(
      backstop.sourceTrail.some((source) => source.type === "fixture"),
      false,
      "core market backstop must not be labelled as Athena fixture output"
    );
    assert.ok(
      backstop.sourceTrail.some((source) => source.type === "technical" && source.source !== "companies_ohlcv_mock"),
      "core market backstop must still have a real technical source"
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken) process.env["FINMIND_API_TOKEN"] = oldToken;
    else delete process.env["FINMIND_API_TOKEN"];
  }
});
