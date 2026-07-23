/**
 * overview-quality-aggregate-pr3-consumer.test.ts — 2026-07-23
 * (perf/overview-quality-aggregate-pr3-jason2-20260723, PR-3 "收割 PR")
 *
 * Plan: reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3
 * 案 A, PR-3 step. computeMarketDataOverview's quality section now reads PR-2's
 * historyAggregateCache (via the new, module-private buildOverviewQualitySummaries)
 * instead of calling getMarketQuoteHistoryDiagnostics/getMarketBarDiagnostics --
 * eliminating the O(#ticks) full-cache scan from /overview entirely. The two
 * /diagnostics routes (server.ts) still call those two functions directly and
 * are completely unchanged.
 *
 * Two things this file proves (CI-scale, not the 1826x511 prod-scale bench --
 * see overview-quality-aggregate-bench-pr3.ts for that):
 *
 * 1. REAL WIRING, not just a standalone helper (2026-07-18 Pete #1300 round-2
 *    lesson: a correct helper with no verified call site is not "done" --
 *    see .claude/agent-memory/backend-strategy-jason/pattern_pr1300_company_page_stale_close_date_mix_20260718.md).
 *    getMarketDataOverview()'s actual `.quality.history`/`.quality.bars` output
 *    must equal an independently-reconstructed call into
 *    _buildOverviewQualitySummariesForTest with the same live cache state --
 *    not merely "the helper computes something plausible in isolation".
 *
 * 2. The KNOWN, DELIBERATE improvement PR-2's parity test flagged as PR-3's job
 *    (see its "Known open scope" comment): the OLD path fed
 *    getMarketQuoteHistoryDiagnostics/getMarketBarDiagnostics a GLOBALLY-sorted,
 *    multi-symbol history array sliced to a request-level limit BEFORE grouping
 *    by symbol -- so a symbol whose surviving ticks all landed outside that
 *    global top-N-by-recency window got silently dropped from the diagnostics
 *    `items`/`summary.total` entirely, even though its full retained history
 *    was sitting untouched in the cache. This reproduces that exact scenario
 *    (a "quiet" symbol whose own ticks are older than a flood of noise from
 *    other symbols, but still within the freshness window) and asserts: (a)
 *    the OLD full-scan path really does drop it (documents the pre-existing
 *    behavior being replaced, does not silently assume it), (b) the NEW
 *    aggregate-based summary counts it, and (c) the underlying aggregate specifically shows the multi-bucket history the old slice couldn't see.
 *
 * Run: node --import ./tests/setup-test-env.mjs --import tsx --test apps/api/src/__tests__/overview-quality-aggregate-pr3-consumer.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { QuoteSource } from "@iuf-trading-room/contracts";

import {
  _buildOverviewQualitySummariesForTest,
  _getHistoryAggregateForTest,
  getMarketBarDiagnostics,
  getMarketDataOverview,
  getMarketQuoteHistoryDiagnostics,
  listMarketQuotes,
  resetMarketDataWorkspaceState,
  upsertTwseMisQuotes,
} from "../market-data.js";

const ALL_SOURCES: QuoteSource[] = ["manual", "paper", "tradingview", "kgi", "twse_mis"];

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
        chainPosition: `sector-${index % 20}`, // spread across sectors so buildMarketContext's
        // heatmap (capped at 24) clears the >=12 threshold and the daily-bar network fallback
        // path (_shouldLoadDailyMarketContext) is not exercised by this test.
      })),
  } as any;
}

async function buildRawQuotesBySource(session: any): Promise<Map<QuoteSource, any[]>> {
  const map = new Map<QuoteSource, any[]>();
  for (const source of ALL_SOURCES) {
    const quotes = await listMarketQuotes({ session, source, includeStale: true, limit: 1_000_000 });
    map.set(source, quotes);
  }
  return map;
}

async function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-agg-pr3-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  try {
    return await fn();
  } finally {
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
}

async function withFinMindDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const originalToken = process.env.FINMIND_API_TOKEN;
  const originalKillSwitch = process.env.FINMIND_KILL_SWITCH;
  process.env.FINMIND_API_TOKEN = "";
  process.env.FINMIND_KILL_SWITCH = "true";
  try {
    return await fn();
  } finally {
    if (originalToken === undefined) delete process.env.FINMIND_API_TOKEN;
    else process.env.FINMIND_API_TOKEN = originalToken;
    if (originalKillSwitch === undefined) delete process.env.FINMIND_KILL_SWITCH;
    else process.env.FINMIND_KILL_SWITCH = originalKillSwitch;
  }
}

test("wiring: getMarketDataOverview's quality.history/quality.bars equal an independently-reconstructed buildOverviewQualitySummaries call against the same live cache state", async () => {
  await withFinMindDisabled(() =>
    withTempStore(async () => {
      const slug = `agg-pr3-wiring-${Date.now()}`;
      const session = makeSession(slug);
      resetMarketDataWorkspaceState(slug);
      try {
        const symbols = Array.from({ length: 30 }, (_, i) => String(4000 + i));
        const now = new Date().toISOString();
        await upsertTwseMisQuotes({
          session,
          quotes: symbols.map((symbol, index) => ({
            symbol,
            market: "TWSE",
            source: "twse_mis",
            last: 100 + index,
            bid: 99 + index,
            ask: 101 + index,
            open: 98 + index,
            high: 105 + index,
            low: 95 + index,
            prevClose: 100 + index,
            volume: 1000 + index,
            changePct: index % 2 === 0 ? 1.2 : -1.2,
            timestamp: now,
          })),
        });

        const repo = makeRepo(symbols);
        const overview = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 });

        // Independently reconstruct the exact same inputs computeMarketDataOverview
        // used (same live cache, no writes happened in between).
        const quotes = await listMarketQuotes({ session, includeStale: true, limit: 1000 });
        const qualitySymbols = [...new Set(quotes.map((quote) => quote.symbol))].join(",");
        const rawQuotesBySource = await buildRawQuotesBySource(session);
        const independent = _buildOverviewQualitySummariesForTest(slug, qualitySymbols, rawQuotesBySource);

        assert.deepStrictEqual(overview.quality.history, independent.history, "overview.quality.history must match the real production wiring, not just a standalone helper call");
        assert.deepStrictEqual(overview.quality.bars, independent.bars, "overview.quality.bars must match the real production wiring, not just a standalone helper call");
        // Sanity: this isn't a vacuous all-zero comparison.
        assert.equal(overview.quality.history.total, 30);
        assert.equal(overview.quality.bars.total, 30);
      } finally {
        resetMarketDataWorkspaceState(slug);
      }
    })
  );
});

test("known open-item direction guard: a symbol whose own ticks are older than a flood of noise from other symbols (but still within the freshness window) is silently DROPPED by the OLD request-level-sliced full-scan path, but IS counted (with its real multi-bucket history) by the NEW aggregate path", async () => {
  await withTempStore(async () => {
    const slug = `agg-pr3-slice-regression-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const nowMs = Date.now();
      const noiseSymbols = Array.from({ length: 50 }, (_, i) => String(5000 + i));
      const targetSymbol = "9999";

      // Noise: 50 symbols x 20 very recent ticks each (1s apart, ending "now") --
      // floods the top of the global timestamp-desc sort with 1000 recent entries.
      for (let tick = 0; tick < 20; tick++) {
        const timestamp = new Date(nowMs - (19 - tick) * 1000).toISOString();
        await upsertTwseMisQuotes({
          session,
          quotes: noiseSymbols.map((symbol) => ({
            symbol,
            market: "TWSE" as const,
            source: "twse_mis" as const,
            last: 100,
            bid: null,
            ask: null,
            open: null,
            high: null,
            low: null,
            prevClose: null,
            volume: 1000,
            changePct: null,
            timestamp,
          })),
        });
      }

      // Target: 5 ticks spanning 3 distinct 1-minute buckets, all OLDER than every
      // noise tick above, but still within the default 10-minute freshness window
      // (getHistoryStaleMs/getBarStaleMs) -- 3 to 5 minutes ago.
      const targetTimestamps = [
        new Date(nowMs - 5 * 60_000).toISOString(),
        new Date(nowMs - 5 * 60_000 + 5_000).toISOString(),
        new Date(nowMs - 4 * 60_000).toISOString(),
        new Date(nowMs - 4 * 60_000 + 5_000).toISOString(),
        new Date(nowMs - 3 * 60_000).toISOString(),
      ];
      for (const timestamp of targetTimestamps) {
        await upsertTwseMisQuotes({
          session,
          quotes: [{
            symbol: targetSymbol,
            market: "TWSE" as const,
            source: "twse_mis" as const,
            last: 200,
            bid: null,
            ask: null,
            open: null,
            high: null,
            low: null,
            prevClose: null,
            volume: 500,
            changePct: null,
            timestamp,
          }],
        });
      }

      const allSymbols = [...noiseSymbols, targetSymbol];
      const qualitySymbolsJoined = allSymbols.join(","); // 51 symbols total

      // Mirror computeMarketDataOverview's exact limit formula
      // (quotes.length = 51, one "latest tick" cache entry per symbol).
      const quotesLength = 51;
      const historyLimit = Math.max(quotesLength * 4, 100); // 204
      const barLimit = Math.max(quotesLength * 2, 50); // 102

      // OLD path (unchanged full-scan diagnostics functions, called exactly as
      // computeMarketDataOverview used to call them pre-PR-3).
      const oldHistory = await getMarketQuoteHistoryDiagnostics({
        session,
        symbols: qualitySymbolsJoined,
        includeStale: true,
        limit: historyLimit,
      });
      const oldBars = await getMarketBarDiagnostics({
        session,
        symbols: qualitySymbolsJoined,
        includeStale: true,
        interval: "1m",
        limit: barLimit,
      });

      assert.equal(
        oldHistory.items.some((item) => item.symbol === targetSymbol),
        false,
        "documents the PRE-EXISTING behavior being replaced: the old request-level slice silently drops a real, fresh symbol whose ticks are simply older than a flood of noise from other symbols"
      );
      assert.equal(
        oldBars.items.some((item) => item.symbol === targetSymbol),
        false,
        "same drop on the bar-diagnostics side"
      );
      assert.ok(
        oldHistory.summary.total < allSymbols.length,
        "old summary.total undercounts because the dropped symbol never appears in items"
      );

      // NEW path: the aggregate has no request-level slice, so the target's full
      // 5-tick / 3-bucket history is retained regardless of how much noise other
      // symbols generated.
      const rawQuotesBySource = await buildRawQuotesBySource(session);
      const newSummaries = _buildOverviewQualitySummariesForTest(slug, qualitySymbolsJoined, rawQuotesBySource);

      assert.equal(newSummaries.history.total, allSymbols.length, "new aggregate-based summary counts EVERY symbol that has a current quote, including the one the old slice dropped");
      assert.equal(newSummaries.bars.total, allSymbols.length);

      const targetAggregate = _getHistoryAggregateForTest(slug, "twse_mis", "TWSE", targetSymbol);
      assert.equal(targetAggregate?.count, 5, "the aggregate itself retained the target's full history, untouched by any request-level slice");
      assert.equal(targetAggregate?.hasTwoDistinctBars, true, "the target's retained history really does span >=2 distinct 1-minute buckets -- this is real data the old slice just never got to see, not a fabricated improvement");
    } finally {
      resetMarketDataWorkspaceState(slug);
    }
  });
});
