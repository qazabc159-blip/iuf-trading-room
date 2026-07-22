// movers-missing-name-seed.test.ts — 2026-07-22
//
// Root cause: 4133/6598/4178 rendered as their raw ticker (no name) in
// overview movers/heatmap. buildSymbolNameLookup() in market-data.ts falls
// back to the raw normalized ticker when a symbol is absent from the
// `companies` list it's given (see market-data.ts buildSymbolNameLookup) --
// that fallback logic itself is correct/intentional (fail-open, not silent
// data fabrication). The actual gap is upstream: these are real, long-listed
// TWSE tickers (confirmed against the official TWSE t187ap03_L company
// registry: 4133=亞諾法 listed 2009, 4178=永笙-KY listed 2026, 6598=ABC-KY
// listed 2020) that were simply absent from this repo's `companies` table --
// a source-list gap, not a market-data.ts mapping bug. Fixed by adding all
// three to CANONICAL_COMPANIES_SEED (server.ts, POST
// /api/v1/admin/companies/seed) alongside the existing 1216/0050 precedent.
//
// This test proves the CONSUMING side (market-data.ts name resolution):
// once these three tickers exist in the companies list with their official
// TWSE short names, getMarketDataOverview() resolves real names instead of
// falling back to the raw ticker. It does not exercise the seed HTTP
// endpoint itself (that needs an Owner session + live Postgres) -- see PR
// notes for the live-verification follow-up.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getMarketDataOverview,
  resetMarketDataWorkspaceState,
  upsertManualQuotes,
} from "./market-data.js";

function makeSession(slug: string) {
  return {
    workspace: { id: `workspace-${slug}`, name: slug, slug },
    user: { id: `user-${slug}`, name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory",
  } as any;
}

const MOVERS_COMPANIES = [
  { ticker: "4133", name: "亞諾法" },
  { ticker: "4178", name: "永笙-KY" },
  { ticker: "6598", name: "ABC-KY" },
];

test("getMarketDataOverview: previously-nameless movers (4133/4178/6598) resolve to their real TWSE short name once present in companies", async () => {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const originalFinMindToken = process.env.FINMIND_API_TOKEN;
  const originalFinMindKill = process.env.FINMIND_KILL_SWITCH;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-movers-name-seed-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  process.env.FINMIND_API_TOKEN = "";
  process.env.FINMIND_KILL_SWITCH = "true";

  const slug = `movers-name-seed-${Date.now()}`;
  const session = makeSession(slug);
  const repo = {
    listCompaniesLite: async () =>
      MOVERS_COMPANIES.map((company, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        ticker: company.ticker,
        name: company.name,
        market: "生技醫療業",
        chainPosition: "生技醫療",
      })),
  } as any;

  try {
    resetMarketDataWorkspaceState(slug);
    const now = new Date().toISOString();
    await upsertManualQuotes({
      session,
      quotes: MOVERS_COMPANIES.map((company, index) => ({
        symbol: company.ticker,
        market: "TWSE",
        source: "manual",
        last: 50 + index,
        bid: null,
        ask: null,
        open: null,
        high: null,
        low: null,
        prevClose: 48 + index,
        volume: 500_000 - index,
        changePct: null,
        timestamp: now,
      })),
    });

    const overview = await getMarketDataOverview({ session, repo, includeStale: false, topLimit: 5 });

    for (const company of MOVERS_COMPANIES) {
      const row = overview.marketContext.heatmap.find((entry) => entry.symbol === company.ticker);
      assert.ok(row, `${company.ticker} must appear in the overview heatmap`);
      assert.equal(row!.name, company.name, `${company.ticker} must resolve to its real name, not the raw ticker`);
      assert.notEqual(row!.name, company.ticker, `${company.ticker} must not fall back to the raw ticker string`);
    }
  } finally {
    resetMarketDataWorkspaceState(slug);
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    if (originalFinMindToken === undefined) delete process.env.FINMIND_API_TOKEN;
    else process.env.FINMIND_API_TOKEN = originalFinMindToken;
    if (originalFinMindKill === undefined) delete process.env.FINMIND_KILL_SWITCH;
    else process.env.FINMIND_KILL_SWITCH = originalFinMindKill;
    await rm(storeDir, { recursive: true, force: true });
  }
});
