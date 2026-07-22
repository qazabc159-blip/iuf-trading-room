// market-data-daily-context-guard.test.ts — 2026-07-22
//
// _shouldLoadDailyMarketContext gates getMarketDataOverview()'s call into
// buildDailyBarMarketContext(), a slow fallback path that unconditionally
// hits the network (loadFinMindTaiexIndexContext -> TWSE MI_5MINS_HIST fetch
// via getTaiexDailyCloses, plus a FinMind OHLCV self-heal sync when a token
// is configured). Before this fix the gate compared the live-quote heatmap
// (capped at 24 by buildMarketContext's own .slice) against
// MARKET_HEATMAP_LIMIT / 2 (90, a DIFFERENT function's cap) -- an
// unreachable threshold, so the condition was always true and every
// /overview request paid for the fallback network call regardless of
// whether the live quote heatmap was already fully populated.
//
// Two layers of proof:
// 1. Unit test on the extracted pure gate function across both boolean
//    states (thin/empty -> true, already-loaded -> false).
// 2. End-to-end test through getMarketDataOverview() itself with a
//    globalThis.fetch spy + a cold TAIEX month-cache, calling /overview
//    TWICE under identical (already-loaded) conditions and asserting ZERO
//    network calls on either call -- the literal "第二次不觸發外部請求"
//    profiling evidence requested for this fix.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { _resetTaiexHistCache } from "./data-sources/twse-openapi-client.js";
import {
  _shouldLoadDailyMarketContext,
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
        name: `測試公司${index}`,
        market: "TWSE",
        chainPosition: "半導體",
      })),
  } as any;
}

test("_shouldLoadDailyMarketContext: EMPTY state always requests the daily fallback", () => {
  assert.equal(_shouldLoadDailyMarketContext({ state: "EMPTY", heatmap: { length: 0 } }), true);
});

test("_shouldLoadDailyMarketContext: thin heatmap (below half of its own 24 cap) requests the daily fallback", () => {
  assert.equal(_shouldLoadDailyMarketContext({ state: "LIVE", heatmap: { length: 5 } }), true);
});

test("_shouldLoadDailyMarketContext: fully-loaded heatmap (at its own 24 cap) skips the daily fallback", () => {
  assert.equal(_shouldLoadDailyMarketContext({ state: "LIVE", heatmap: { length: 24 } }), false);
  // regression guard for the original bug: 24 is NOT below MARKET_HEATMAP_LIMIT/2 (90)
  // once compared against the correct (24-based) threshold -- this must stay false.
  assert.equal(_shouldLoadDailyMarketContext({ state: "LIVE", heatmap: { length: 12 } }), false);
});

async function fetchOverviewTwice(symbols: string[]) {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const originalFinMindToken = process.env.FINMIND_API_TOKEN;
  const originalFinMindKill = process.env.FINMIND_KILL_SWITCH;
  const originalFetch = globalThis.fetch;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-market-data-daily-context-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  process.env.FINMIND_API_TOKEN = "";
  process.env.FINMIND_KILL_SWITCH = "true";

  let twseFetchCalls = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("MI_5MINS_HIST")) {
      twseFetchCalls += 1;
      return new Response(JSON.stringify({ stat: "OK", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input as any, init);
  }) as typeof fetch;

  const slug = `daily-context-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session = makeSession(slug);

  try {
    _resetTaiexHistCache();
    resetMarketDataWorkspaceState(slug);
    const now = new Date().toISOString();
    await upsertManualQuotes({
      session,
      quotes: symbols.map((symbol, index) => ({
        symbol,
        market: "TWSE",
        source: "manual",
        last: 100 + index,
        bid: null,
        ask: null,
        open: null,
        high: null,
        low: null,
        prevClose: 100 + index,
        volume: 1_000_000 - index,
        changePct: 0.5,
        timestamp: now,
      })),
    });

    const repo = makeRepo(symbols);
    await getMarketDataOverview({ session, repo, includeStale: false, topLimit: 5 });
    await getMarketDataOverview({ session, repo, includeStale: false, topLimit: 5 });

    return twseFetchCalls;
  } finally {
    resetMarketDataWorkspaceState(slug);
    globalThis.fetch = originalFetch;
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    if (originalFinMindToken === undefined) delete process.env.FINMIND_API_TOKEN;
    else process.env.FINMIND_API_TOKEN = originalFinMindToken;
    if (originalFinMindKill === undefined) delete process.env.FINMIND_KILL_SWITCH;
    else process.env.FINMIND_KILL_SWITCH = originalFinMindKill;
    await rm(storeDir, { recursive: true, force: true });
  }
}

test("getMarketDataOverview: fully-loaded quote heatmap (31 symbols, capped at 24) triggers ZERO TWSE daily-fallback fetches across two consecutive calls", async () => {
  const symbols = Array.from({ length: 31 }, (_, index) => String(1101 + index));
  const twseFetchCalls = await fetchOverviewTwice(symbols);
  assert.equal(twseFetchCalls, 0, "already-loaded overview must not hit the daily-bar network fallback on either call");
});

test("getMarketDataOverview: thin quote heatmap (2 symbols, below the 12-row half-cap) still legitimately triggers the daily-bar network fallback", async () => {
  const symbols = ["1101", "1102"];
  const twseFetchCalls = await fetchOverviewTwice(symbols);
  assert.ok(twseFetchCalls > 0, "thin overview must still fall back to the daily-bar network path (regression guard against over-correcting the gate)");
});
