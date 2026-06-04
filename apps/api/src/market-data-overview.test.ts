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

function makeRepo(symbols: string[]) {
  return {
    listCompaniesLite: async () =>
      symbols.map((ticker, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        ticker,
        name: ticker === "2330" ? "台積電" : `測試公司${index}`,
        market: "TWSE",
        chainPosition: "半導體",
      })),
  } as any;
}

test("market-data overview recomputes changePct from last and prevClose when cached pct conflicts", async () => {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const originalFinMindToken = process.env.FINMIND_API_TOKEN;
  const originalFinMindKill = process.env.FINMIND_KILL_SWITCH;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-market-data-overview-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  process.env.FINMIND_API_TOKEN = "";
  process.env.FINMIND_KILL_SWITCH = "true";

  const slug = `overview-consistency-${Date.now()}`;
  const session = makeSession(slug);
  const symbols = ["2330", ...Array.from({ length: 30 }, (_, index) => String(1101 + index))];

  try {
    resetMarketDataWorkspaceState(slug);
    const now = new Date().toISOString();
    await upsertManualQuotes({
      session,
      quotes: symbols.map((symbol, index) => ({
        symbol,
        market: "TWSE",
        source: "manual",
        last: symbol === "2330" ? 2400 : 100 + index,
        bid: null,
        ask: null,
        open: null,
        high: null,
        low: null,
        prevClose: symbol === "2330" ? 2380 : 100 + index,
        volume: 1_000_000 - index,
        // Deliberately wrong for 2330: production saw this kind of mixed-source conflict.
        changePct: symbol === "2330" ? -1.03 : 0,
        timestamp: now,
      })),
    });

    const overview = await getMarketDataOverview({
      session,
      repo: makeRepo(symbols),
      includeStale: false,
      topLimit: 5,
    });
    const tsmc = overview.marketContext.heatmap.find((row) => row.symbol === "2330");

    assert.ok(tsmc, "2330 must be present in overview heatmap");
    assert.equal(tsmc.change, 20);
    assert.equal(tsmc.changePct, 0.84);
    assert.equal(overview.marketContext.breadth.up >= 1, true);
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
