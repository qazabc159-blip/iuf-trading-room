/**
 * overview-quality-aggregate-bench-pr3.ts — PR-3 harvest bench
 * (perf/overview-quality-aggregate-pr3-jason2-20260723)
 *
 * Read-only prod-scale characterization for the /overview <2s architecture plan
 * (reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3, PR-3:
 * "收割 PR"). Mirrors PR-1's overview-quality-aggregate-bench.ts EXACTLY (same
 * SYMBOL_COUNT/TICKS_PER_SYMBOL/seed shape) so its output is directly diffable
 * against PR-1's committed golden snapshot
 * (evidence/overview_quality_aggregate_20260723/golden-quality-summary-pre-aggregate.json)
 * -- same scale, same symbol universe, apples-to-apples.
 *
 * Deliberately NOT added to `pnpm test`'s whitelist (same reasoning as PR-1's
 * bench: seeding ~933K synthetic ticks has no place in the fast per-PR CI loop).
 * Run manually:
 *
 *   node --import ./tests/setup-test-env.mjs --import tsx/esm \
 *     apps/api/src/__tests__/overview-quality-aggregate-bench-pr3.ts
 *
 * Two things this captures:
 * 1. Part A -- direct apples-to-apples quality-computation comparison against
 *    PR-1's golden: OLD (getMarketQuoteHistoryDiagnostics/getMarketBarDiagnostics,
 *    re-measured fresh in this same run, not just read from the old golden file)
 *    vs NEW (_buildOverviewQualitySummariesForTest), same 1826-symbol universe,
 *    same limit formulas computeMarketDataOverview uses.
 * 2. Part B -- full end-to-end getMarketDataOverview() wall-clock timing at the
 *    same prod-scale seed, proving the actual /overview response time.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { QuoteSource } from "@iuf-trading-room/contracts";

import {
  _buildOverviewQualitySummariesForTest,
  getMarketBarDiagnostics,
  getMarketDataOverview,
  getMarketQuoteHistoryDiagnostics,
  listMarketQuotes,
  resetMarketDataWorkspaceState,
  upsertTwseMisQuotes,
} from "../market-data.js";

function makeSession(slug: string) {
  return {
    workspace: { id: `workspace-${slug}`, name: slug, slug },
    user: { id: `user-${slug}`, name: "Bench User", email: "bench@example.com", role: "Owner" },
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
        // Spread across 20 sectors so buildMarketContext's heatmap (capped at 24)
        // clears the >=12 threshold and _shouldLoadDailyMarketContext's network
        // fallback path (unrelated to this PR) is not exercised by this bench.
        chainPosition: `sector-${index % 20}`,
      })),
  } as any;
}

const ALL_SOURCES: QuoteSource[] = ["manual", "paper", "tradingview", "kgi", "twse_mis"];

async function buildRawQuotesBySource(session: any): Promise<Map<QuoteSource, any[]>> {
  const map = new Map<QuoteSource, any[]>();
  for (const source of ALL_SOURCES) {
    const quotes = await listMarketQuotes({ session, source, includeStale: true, limit: 1_000_000 });
    map.set(source, quotes);
  }
  return map;
}

// Matches PR-1's bench + RCA_ROUND2's measured prod scale exactly.
const SYMBOL_COUNT = 1826;
const TICKS_PER_SYMBOL = 511;

async function main() {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-quality-bench-pr3-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  process.env.FINMIND_API_TOKEN = "";
  process.env.FINMIND_KILL_SWITCH = "true";

  const slug = `overview-quality-bench-pr3-${Date.now()}`;
  const session = makeSession(slug);

  try {
    resetMarketDataWorkspaceState(slug);

    const symbols = Array.from({ length: SYMBOL_COUNT }, (_, i) => String(1000 + i));
    const baseTimeMs = Date.now() - TICKS_PER_SYMBOL * 1000;

    console.log(
      `[bench] seeding ${SYMBOL_COUNT} symbols x ${TICKS_PER_SYMBOL} ticks = ${SYMBOL_COUNT * TICKS_PER_SYMBOL} twse_mis entries...`
    );
    const seedStart = Date.now();
    for (let tick = 0; tick < TICKS_PER_SYMBOL; tick++) {
      const timestamp = new Date(baseTimeMs + tick * 1000).toISOString();
      await upsertTwseMisQuotes({
        session,
        quotes: symbols.map((symbol) => ({
          symbol,
          market: "TWSE" as const,
          source: "twse_mis" as const,
          last: 100 + (tick % 10),
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
    const seedMs = Date.now() - seedStart;
    console.log(`[bench] seed done in ${seedMs}ms`);

    const qualitySymbols = symbols.join(",");

    // ---- Part A: direct quality-computation comparison (same shape as PR-1) ----
    const oldHistoryStart = Date.now();
    const oldHistory = await getMarketQuoteHistoryDiagnostics({
      session,
      symbols: qualitySymbols,
      includeStale: true,
      limit: Math.max(symbols.length * 4, 100),
    });
    const oldHistoryMs = Date.now() - oldHistoryStart;

    const oldBarStart = Date.now();
    const oldBars = await getMarketBarDiagnostics({
      session,
      symbols: qualitySymbols,
      includeStale: true,
      interval: "1m",
      limit: Math.max(symbols.length * 2, 50),
    });
    const oldBarMs = Date.now() - oldBarStart;

    const rawQuotesBySourceStart = Date.now();
    const rawQuotesBySource = await buildRawQuotesBySource(session);
    const rawQuotesBySourceMs = Date.now() - rawQuotesBySourceStart;

    const newStart = Date.now();
    const newSummaries = _buildOverviewQualitySummariesForTest(slug, qualitySymbols, rawQuotesBySource);
    const newMs = Date.now() - newStart;

    console.log(
      `[bench] Part A -- OLD historyQualityScan=${oldHistoryMs}ms barQualityScan=${oldBarMs}ms (full O(#ticks) scan, unchanged /diagnostics path) | NEW buildOverviewQualitySummaries=${newMs}ms (O(#symbols) aggregate read; rawQuotesBySource reconstruction for this bench harness=${rawQuotesBySourceMs}ms, NOT part of the O(#symbols) cost itself -- computeMarketDataOverview already has this snapshot for free from its own top-level rawQuotesBySource, see round 7)`
    );

    // ---- Part B: full end-to-end getMarketDataOverview() wall-clock timing ----
    const repo = makeRepo(symbols);
    const E2E_RUNS = 5;
    const e2eTimingsMs: number[] = [];
    let firstRunQuality: unknown = null;
    for (let i = 0; i < E2E_RUNS; i++) {
      // Vary topLimit per call so getMarketDataOverview's own top-level TTL memo (round 7)
      // can't serve a cached response -- we want N independent fresh computations,
      // not N memo hits. This does NOT touch/reset the seeded quote/history/
      // aggregate caches (only resetMarketDataWorkspaceState does that).
      const start = Date.now();
      const overview = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: i + 1 });
      const elapsed = Date.now() - start;
      e2eTimingsMs.push(elapsed);
      if (i === 0) {
        firstRunQuality = overview.quality;
        console.log(`[bench] Part B run 0 quality section:`, JSON.stringify(overview.quality));
      }
    }
    const e2eSorted = [...e2eTimingsMs].sort((a, b) => a - b);
    const e2eMedianMs = e2eSorted[Math.floor(e2eSorted.length / 2)];

    console.log(`[bench] Part B -- getMarketDataOverview() E2E timings (ms): ${e2eTimingsMs.join(", ")} | median=${e2eMedianMs}ms`);

    const golden = {
      capturedAt: new Date().toISOString(),
      note: "PR-3 harvest bench — post-aggregate-index behavior + full E2E overview timing. See reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3.",
      scale: {
        symbolCount: SYMBOL_COUNT,
        ticksPerSymbol: TICKS_PER_SYMBOL,
        totalTwseMisEntries: SYMBOL_COUNT * TICKS_PER_SYMBOL,
      },
      partA_directQualityComparison: {
        timingMs: {
          seed: seedMs,
          old_historyQualityScan: oldHistoryMs,
          old_barQualityScan: oldBarMs,
          new_buildOverviewQualitySummaries: newMs,
        },
        old_historyQualitySummary: oldHistory.summary,
        old_barQualitySummary: oldBars.summary,
        new_historyQualitySummary: newSummaries.history,
        new_barQualitySummary: newSummaries.bars,
      },
      partB_endToEndOverviewTiming: {
        runsMs: e2eTimingsMs,
        medianMs: e2eMedianMs,
        qualityFromFirstRun: firstRunQuality,
      },
    };

    const outPath = path.resolve(
      process.cwd(),
      "evidence/overview_quality_aggregate_20260723/pr3-bench-result.json"
    );
    await writeFile(outPath, JSON.stringify(golden, null, 2), "utf8");
    console.log(`[bench] PR-3 bench result written to ${outPath}`);
  } finally {
    resetMarketDataWorkspaceState(slug);
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
