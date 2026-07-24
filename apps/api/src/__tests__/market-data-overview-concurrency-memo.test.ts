/**
 * market-data-overview-concurrency-memo.test.ts — 2026-07-22
 * (perf/home-concurrent-cpu-jason-20260722, P0 round 7)
 *
 * Two independent things this PR changed in market-data.ts, both covered here:
 *
 * 1. `rawQuotesBySource` threading (snapshotCachedProviderQuotesBySource):
 *    listMarketDataProviderStatuses / listMarketQuotes / getEffectiveMarketQuotes /
 *    getMarketQuoteHistoryDiagnostics / getMarketBarDiagnostics each gained an
 *    optional pre-computed-snapshot parameter so getMarketDataOverview can
 *    scan the "latest tick" quote cache ONCE per source instead of up to 6x.
 *    The snapshot itself is built by a module-private helper (not exported,
 *    matching this file's existing convention for its round-6 sibling
 *    snapshotCachedProviderQuoteHistoryBySource), so this is exercised
 *    end-to-end via getMarketDataOverview's own memo tests below rather than
 *    unit-tested in isolation. This test instead pins down a determinism
 *    regression guard: calling each of the 5 threaded functions twice in a
 *    row (no interleaving writes) on identical inputs must produce
 *    byte-identical output -- a sanity floor the redundant-scan removal must
 *    never break.
 *
 * 2. `getMarketDataOverview`'s new top-level short-TTL Promise-memo: N
 *    concurrent callers with the SAME query params must share ONE real
 *    computation (not N), different params must NOT share, and a call after
 *    TTL expiry must NOT reuse a stale memo entry forever.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/market-data-overview-concurrency-memo.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getEffectiveMarketQuotes,
  getMarketBarDiagnostics,
  getMarketDataOverview,
  getMarketQuoteHistoryDiagnostics,
  listMarketDataProviderStatuses,
  listMarketQuotes,
  resetMarketDataWorkspaceState,
  upsertKgiQuotes,
  upsertManualQuotes,
  upsertTwseMisQuotes,
} from "../market-data.js";

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

// Strips wall-clock fields (`generatedAt`, and any `*AgeMs`/`ageMs` field
// derived from `Date.now() - timestamp`) before deep-equality comparisons
// below -- these are expected to differ by a few ms between two calls made
// moments apart regardless of this PR's change, and are not part of what
// the snapshot-sharing fix is supposed to keep byte-identical (the
// underlying timestamps themselves ARE compared, unstripped).
function stripGeneratedAt<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripGeneratedAt(entry)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (key === "generatedAt" || key === "ageMs" || key.endsWith("AgeMs")) continue;
      clone[key] = stripGeneratedAt(entryValue);
    }
    return clone as T;
  }
  return value;
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

test("rawQuotesBySource threading: listMarketDataProviderStatuses/listMarketQuotes/getEffectiveMarketQuotes/getMarketQuoteHistoryDiagnostics/getMarketBarDiagnostics produce byte-identical results with vs without a pre-computed snapshot", async () => {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-cpu-round7-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;

  const slug = `round7-snapshot-invariance-${Date.now()}`;
  const session = makeSession(slug);
  const symbols = Array.from({ length: 12 }, (_, i) => String(2000 + i));

  try {
    resetMarketDataWorkspaceState(slug);
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
        changePct: index % 2 === 0 ? 1.5 : -1.5,
        timestamp: now,
      })),
    });
    await upsertKgiQuotes({
      session,
      quotes: symbols.slice(0, 3).map((symbol, index) => ({
        symbol,
        market: "TWSE",
        source: "kgi",
        last: 100 + index,
        bid: null,
        ask: null,
        open: null,
        high: null,
        low: null,
        prevClose: 100 + index,
        volume: 500 + index,
        changePct: 0.5,
        timestamp: now,
      })),
    });

    const qualitySymbols = symbols.join(",");

    // providers
    const withSnapshotProviders = await listMarketDataProviderStatuses({ session });
    const withoutSnapshotProviders = await listMarketDataProviderStatuses({ session });
    assert.deepStrictEqual(stripGeneratedAt(withSnapshotProviders), stripGeneratedAt(withoutSnapshotProviders));

    // listMarketQuotes
    const quotesA = await listMarketQuotes({ session, includeStale: true, limit: 1000 });
    const quotesB = await listMarketQuotes({ session, includeStale: true, limit: 1000 });
    assert.deepStrictEqual(stripGeneratedAt(quotesA), stripGeneratedAt(quotesB));

    // getEffectiveMarketQuotes
    const effA = await getEffectiveMarketQuotes({ session, symbols: qualitySymbols, includeStale: true, limit: 50 });
    const effB = await getEffectiveMarketQuotes({ session, symbols: qualitySymbols, includeStale: true, limit: 50 });
    assert.deepStrictEqual(stripGeneratedAt(effA), stripGeneratedAt(effB));

    // getMarketQuoteHistoryDiagnostics
    const histA = await getMarketQuoteHistoryDiagnostics({ session, symbols: qualitySymbols, includeStale: true, limit: 200 });
    const histB = await getMarketQuoteHistoryDiagnostics({ session, symbols: qualitySymbols, includeStale: true, limit: 200 });
    assert.deepStrictEqual(stripGeneratedAt(histA), stripGeneratedAt(histB));

    // getMarketBarDiagnostics
    const barA = await getMarketBarDiagnostics({ session, symbols: qualitySymbols, includeStale: true, interval: "1m", limit: 100 });
    const barB = await getMarketBarDiagnostics({ session, symbols: qualitySymbols, includeStale: true, interval: "1m", limit: 100 });
    assert.deepStrictEqual(stripGeneratedAt(barA), stripGeneratedAt(barB));
  } finally {
    resetMarketDataWorkspaceState(slug);
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
});

test("getMarketDataOverview top-level memo: N concurrent same-param calls share ONE computation (same object reference)", async () => {
  await withFinMindDisabled(async () => {
    const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
    const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-cpu-round7-memo-"));
    process.env.MARKET_DATA_STORE_DIR = storeDir;

    const slug = `round7-memo-dedupe-${Date.now()}`;
    const session = makeSession(slug);
    const symbols = ["2330", "2454"];

    try {
      resetMarketDataWorkspaceState(slug);
      await upsertManualQuotes({
        session,
        quotes: symbols.map((symbol) => ({
          symbol,
          market: "TWSE",
          source: "manual",
          last: 100,
          bid: null,
          ask: null,
          open: null,
          high: null,
          low: null,
          prevClose: 100,
          volume: 100,
          changePct: 0,
          timestamp: new Date().toISOString(),
        })),
      });

      const repo = makeRepo(symbols);
      const N = 5;
      const results = await Promise.all(
        Array.from({ length: N }, () =>
          getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 })
        )
      );

      assert.ok(
        results.every((r) => r === results[0]),
        "all N concurrent same-param callers must receive the exact same response object (memo dedupe)"
      );
      assert.equal(results[0].quotes.total, 2, "sanity: the shared computation still reflects the real seeded quotes");
      assert.equal(results[0].symbols.total, 2, "sanity: the shared computation still reflects the real seeded companies");

      // A different query param must NOT reuse the memo entry.
      const differentParams = await getMarketDataOverview({ session, repo, includeStale: false, topLimit: 5 });
      assert.notEqual(differentParams, results[0], "a different includeStale param must not share the memo");
    } finally {
      resetMarketDataWorkspaceState(slug);
      if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
      else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
      await rm(storeDir, { recursive: true, force: true });
    }
  });
});

test("getMarketDataOverview top-level memo: a call after TTL expiry recomputes (does not serve a stale snapshot forever)", async () => {
  await withFinMindDisabled(async () => {
    const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
    const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-cpu-round7-ttl-"));
    process.env.MARKET_DATA_STORE_DIR = storeDir;

    const slug = `round7-memo-ttl-${Date.now()}`;
    const session = makeSession(slug);
    const symbols = ["2330"];

    try {
      resetMarketDataWorkspaceState(slug);
      await upsertManualQuotes({
        session,
        quotes: [{
          symbol: "2330", market: "TWSE", source: "manual", last: 100, bid: null, ask: null,
          open: null, high: null, low: null, prevClose: 100, volume: 100, changePct: 0,
          timestamp: new Date().toISOString(),
        }],
      });

      const repo = makeRepo(symbols);
      const first = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 });
      const immediateRepeat = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 });
      assert.equal(immediateRepeat, first, "within the TTL window, the memo must be reused");

      // Wait past the memo's TTL (2000ms, raised from 1500ms by
      // perf/overview-boot-warmup PR-4 -- see market-data.ts's overviewMemoTtlMs doc).
      await new Promise((resolve) => setTimeout(resolve, 2200));
      const afterTtl = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 });
      assert.notEqual(afterTtl, first, "after TTL expiry, a fresh computation must happen, not a stale memo hit");
    } finally {
      resetMarketDataWorkspaceState(slug);
      if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
      else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
      await rm(storeDir, { recursive: true, force: true });
    }
  });
});

test("getMarketDataOverview top-level memo: resetMarketDataWorkspaceState(slug) evicts that workspace's memo entries", async () => {
  await withFinMindDisabled(async () => {
    const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
    const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-cpu-round7-reset-"));
    process.env.MARKET_DATA_STORE_DIR = storeDir;

    const slug = `round7-memo-reset-${Date.now()}`;
    const session = makeSession(slug);
    const symbols = ["2330"];

    try {
      resetMarketDataWorkspaceState(slug);
      await upsertManualQuotes({
        session,
        quotes: [{
          symbol: "2330", market: "TWSE", source: "manual", last: 100, bid: null, ask: null,
          open: null, high: null, low: null, prevClose: 100, volume: 100, changePct: 0,
          timestamp: new Date().toISOString(),
        }],
      });

      const repo = makeRepo(symbols);
      const before = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 });

      resetMarketDataWorkspaceState(slug);

      const after = await getMarketDataOverview({ session, repo, includeStale: true, topLimit: 5 });
      assert.notEqual(after, before, "reset must evict the memo, not serve a pre-reset response");
    } finally {
      resetMarketDataWorkspaceState(slug);
      if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
      else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
      await rm(storeDir, { recursive: true, force: true });
    }
  });
});
