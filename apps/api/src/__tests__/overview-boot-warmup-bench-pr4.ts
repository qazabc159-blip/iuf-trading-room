/**
 * overview-boot-warmup-bench-pr4.ts — PR-4 boot-warmup evidence
 * (perf/overview-boot-warmup-pr4-jason2-20260724)
 *
 * Read-only prod-scale characterization for the /overview <2s architecture plan
 * (reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3, PR-4:
 * "boot warmup"). Unlike PR-1/PR-3's benches (which seed prod-scale ticks
 * directly into the IN-MEMORY cache via upsertTwseMisQuotes -- never exercising
 * ensurePersistedQuoteHistoryLoaded's cold JSONL-replay path), this bench seeds
 * the persisted JSONL file DIRECTLY on disk (bypassing the in-memory cache) to
 * simulate exactly what a fresh process after `deploy`/restart sees: an empty
 * in-memory cache with a day's worth of history sitting on the volume, waiting
 * to be replayed by ensurePersistedQuoteHistoryLoaded() on first touch. This is
 * the cold path the live 6.35s outlier (evidence/sprint_2026_07_23/
 * BRUCE_PROD_VERIFY_5MERGE_20260723.md §10) was never root-caused against.
 *
 * Deliberately NOT added to `pnpm test`'s whitelist (same reasoning as PR-1/
 * PR-3's benches — prod-scale seeding has no place in the fast per-PR CI loop).
 * Run manually:
 *
 *   node --import ./tests/setup-test-env.mjs --import tsx/esm \
 *     apps/api/src/__tests__/overview-boot-warmup-bench-pr4.ts
 *
 * Three things this captures:
 * 1. Part A — BEFORE: a brand-new workspace whose only state is the persisted
 *    JSONL file (as if just restored from `/data` after a restart), timing the
 *    FIRST getMarketDataOverview() call cold — no boot warmup ran.
 * 2. Part B — AFTER: an identically-seeded but separate workspace, first runs
 *    the exact warmup call server.ts's boot callback fires (untimed, simulating
 *    it happening before traffic), THEN waits past the (now 2000ms) top-level
 *    memo TTL, THEN times a getMarketDataOverview() call with the SAME params —
 *    proving the speed-up comes from the underlying per-symbol caches staying
 *    resident (matching Bruce's own diagnosis), not from a trivial memo hit.
 * 3. Part C — concurrent event-loop heartbeat during Part B's (untimed) warmup
 *    call: a 20ms `setTimeout` chain records the max observed gap between
 *    ticks, as a proxy for "how long would a concurrent /health request be
 *    queued behind this synchronous work". This same blocking exists today on
 *    whichever request happens to trigger ensurePersistedQuoteHistoryLoaded
 *    first (this PR does not add a new blocking source, it only moves the
 *    trigger from "first real user request" to "boot, before traffic").
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Market, QuoteSource } from "@iuf-trading-room/contracts";

import { appendPersistedQuoteEntries } from "../market-data-store.js";
import { getMarketDataOverview, resetMarketDataWorkspaceState } from "../market-data.js";

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
        chainPosition: `sector-${index % 20}`,
      })),
  } as any;
}

// Matches PR-1/PR-3's bench scale exactly (RCA_ROUND2 measured prod scale:
// keysForSource=1826 rawEntryCount=932158).
const SYMBOL_COUNT = 1826;
const TICKS_PER_SYMBOL = 511;

async function seedPersistedJsonl(workspaceSlug: string, symbols: string[]) {
  const baseTimeMs = Date.now() - TICKS_PER_SYMBOL * 1000;
  // Batch writes (appendPersistedQuoteEntries appends per call) — one call per
  // tick across all symbols, matching how a real trading day accumulates.
  for (let tick = 0; tick < TICKS_PER_SYMBOL; tick++) {
    const timestamp = new Date(baseTimeMs + tick * 1000).toISOString();
    await appendPersistedQuoteEntries(
      workspaceSlug,
      symbols.map((symbol) => ({
        symbol,
        market: "TWSE" as Market,
        source: "twse_mis" as QuoteSource,
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
        updatedAt: timestamp,
      }))
    );
  }
}

async function main() {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-boot-warmup-bench-pr4-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  process.env.FINMIND_API_TOKEN = "";
  process.env.FINMIND_KILL_SWITCH = "true";

  const symbols = Array.from({ length: SYMBOL_COUNT }, (_, i) => String(1000 + i));
  const repo = makeRepo(symbols);
  const runId = Date.now();
  const slugBefore = `overview-boot-warmup-before-${runId}`;
  const slugAfter = `overview-boot-warmup-after-${runId}`;

  try {
    console.log(
      `[bench] seeding persisted JSONL for 2 workspaces x ${SYMBOL_COUNT} symbols x ${TICKS_PER_SYMBOL} ticks = ${SYMBOL_COUNT * TICKS_PER_SYMBOL} entries each (this is real disk I/O + JSON.stringify, expect this step to take a while)...`
    );
    const seedStart = Date.now();
    await seedPersistedJsonl(slugBefore, symbols);
    await seedPersistedJsonl(slugAfter, symbols);
    console.log(`[bench] seed done in ${Date.now() - seedStart}ms`);

    // ---- Part A: BEFORE — cold first request, no boot warmup ----
    resetMarketDataWorkspaceState(slugBefore);
    const sessionBefore = makeSession(slugBefore);
    const beforeStart = Date.now();
    await getMarketDataOverview({ session: sessionBefore, repo, includeStale: true, topLimit: 20 });
    const beforeMs = Date.now() - beforeStart;
    console.log(`[bench] Part A -- BEFORE (no warmup) cold first /overview: ${beforeMs}ms`);

    // ---- Part B + C: AFTER — boot warmup (untimed) + heartbeat, then a
    // post-TTL request with the SAME params ----
    resetMarketDataWorkspaceState(slugAfter);
    const sessionAfter = makeSession(slugAfter);

    // Part C heartbeat: 20ms setTimeout chain running concurrently with the
    // warmup call below. Records the max gap between ticks as a proxy for how
    // long a concurrent /health request would queue behind the warmup's
    // synchronous work.
    let heartbeatRunning = true;
    let lastTick = Date.now();
    let maxGapMs = 0;
    let tickCount = 0;
    const heartbeatLoop = () => {
      if (!heartbeatRunning) return;
      const now = Date.now();
      const gap = now - lastTick;
      if (gap > maxGapMs) maxGapMs = gap;
      lastTick = now;
      tickCount++;
      setTimeout(heartbeatLoop, 20);
    };
    setTimeout(heartbeatLoop, 20);

    const warmupStart = Date.now();
    await getMarketDataOverview({ session: sessionAfter, repo, includeStale: true, topLimit: 20 });
    const warmupMs = Date.now() - warmupStart;
    heartbeatRunning = false;
    console.log(
      `[bench] Part B -- boot warmup call (untimed in real boot, timed here for reference): ${warmupMs}ms`
    );
    console.log(
      `[bench] Part C -- concurrent 20ms heartbeat during warmup: ${tickCount} ticks observed, max observed gap between ticks = ${maxGapMs}ms (proxy for worst-case /health queuing delay if a request arrived mid-warmup)`
    );

    // Wait past the (2000ms, post-PR-4) top-level memo TTL so this next call
    // cannot be served by a trivial memo hit — it must prove the underlying
    // per-symbol caches (not the top-level memo) are what stayed warm.
    await new Promise((resolve) => setTimeout(resolve, 2200));

    const firstRealStart = Date.now();
    await getMarketDataOverview({ session: sessionAfter, repo, includeStale: true, topLimit: 20 });
    const firstRealMs = Date.now() - firstRealStart;
    console.log(
      `[bench] Part B -- AFTER (post-warmup, past TTL) "first real request": ${firstRealMs}ms`
    );

    console.log(
      `\n[bench] SUMMARY: BEFORE (cold, no warmup) = ${beforeMs}ms | AFTER (post-warmup, past TTL, same params) = ${firstRealMs}ms | target = <2000ms`
    );
  } finally {
    resetMarketDataWorkspaceState(slugBefore);
    resetMarketDataWorkspaceState(slugAfter);
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
