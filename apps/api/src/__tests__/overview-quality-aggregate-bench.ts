/**
 * overview-quality-aggregate-bench.ts — PR-1 characterization
 * (perf/overview-quality-aggregate-pr1-jason2-20260723)
 *
 * Read-only prod-scale characterization for the /overview <2s architecture plan
 * (reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3, PR-1:
 * "特徵化，零行為變更"). Touches ZERO production code in market-data.ts — only
 * calls the already-exported public functions.
 *
 * Deliberately NOT added to `pnpm test`'s whitelist (see root package.json's
 * `test` script — an explicit file list, not a glob): seeding ~932K synthetic
 * ticks (matching reports/overview_latency_20260720/RCA_ROUND2_REAL_PROFILING's
 * measured prod scale of 1826 twse_mis symbols x ~510 ticks each) takes real
 * wall-clock time and has no place in the fast per-PR CI loop. Run manually:
 *
 *   node --import ./tests/setup-test-env.mjs --import tsx/esm \
 *     apps/api/src/__tests__/overview-quality-aggregate-bench.ts
 *
 * Captures the CURRENT (pre-aggregate-index) historyQuality/barQuality
 * `summary` output + wall-clock scan timing as a golden snapshot, for PR-3
 * (not this PR) to diff against once it swaps computeMarketDataOverview's
 * quality section to read the new aggregate index instead of the full scan.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getMarketBarDiagnostics,
  getMarketQuoteHistoryDiagnostics,
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

// Matches RCA_ROUND2's measured prod scale: keysForSource=1826 rawEntryCount=932158
// (932158 / 1826 ≈ 510.5).
const SYMBOL_COUNT = 1826;
const TICKS_PER_SYMBOL = 511;

async function main() {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-quality-bench-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;

  const slug = `overview-quality-bench-${Date.now()}`;
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

    // Same call shape computeMarketDataOverview uses for historyQuality/barQuality
    // (see market-data.ts computeMarketDataOverview, L4301-4320 as of this PR).
    const historyStart = Date.now();
    const historyQuality = await getMarketQuoteHistoryDiagnostics({
      session,
      symbols: qualitySymbols,
      includeStale: true,
      limit: Math.max(symbols.length * 4, 100),
    });
    const historyMs = Date.now() - historyStart;

    const barStart = Date.now();
    const barQuality = await getMarketBarDiagnostics({
      session,
      symbols: qualitySymbols,
      includeStale: true,
      interval: "1m",
      limit: Math.max(symbols.length * 2, 50),
    });
    const barMs = Date.now() - barStart;

    const golden = {
      capturedAt: new Date().toISOString(),
      note: "PR-1 characterization golden snapshot — pre-aggregate-index behavior. See reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3.",
      scale: {
        symbolCount: SYMBOL_COUNT,
        ticksPerSymbol: TICKS_PER_SYMBOL,
        totalTwseMisEntries: SYMBOL_COUNT * TICKS_PER_SYMBOL,
      },
      timingMs: {
        seed: seedMs,
        historyQualityScan: historyMs,
        barQualityScan: barMs,
      },
      historyQualitySummary: historyQuality.summary,
      barQualitySummary: barQuality.summary,
    };

    const outPath = path.resolve(
      process.cwd(),
      "evidence/overview_quality_aggregate_20260723/golden-quality-summary-pre-aggregate.json"
    );
    await writeFile(outPath, JSON.stringify(golden, null, 2), "utf8");
    console.log(`[bench] golden snapshot written to ${outPath}`);
    console.log(
      `[bench] historyQualityScan=${historyMs}ms barQualityScan=${barMs}ms (this is the O(#ticks) cost PR-3 will replace with an O(#symbols) aggregate read)`
    );
    console.log("[bench] historyQualitySummary:", JSON.stringify(golden.historyQualitySummary));
    console.log("[bench] barQualitySummary:", JSON.stringify(golden.barQualitySummary));
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
