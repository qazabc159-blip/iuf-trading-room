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

test("recommendations today derives trade plans without HTTP self-fetching company OHLCV", async () => {
  _resetAthenaFixtureCache();

  const oldFetch = globalThis.fetch;
  const oldToken = process.env["FINMIND_API_TOKEN"];
  delete process.env["FINMIND_API_TOKEN"];

  const httpCalls: string[] = [];
  globalThis.fetch = async (url: URL | RequestInfo) => {
    const requestUrl = String(url);
    httpCalls.push(requestUrl);

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
      const hasTechnicalSource = item.sourceTrail.some((source) => source.type === "technical");
      return !item.entryZone.primary || item.invalidation.price == null || pricedTargets.length < 2 || !hasTechnicalSource;
    });

    assert.equal(result.isMock, false);
    assert.ok(result.items.length >= 5, "should surface at least five real-backed recommendations");
    assert.deepEqual(incomplete.map((item) => item.ticker), []);
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
