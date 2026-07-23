/**
 * overview-quality-aggregate-parity.test.ts — 2026-07-23
 * (perf/overview-quality-aggregate-pr2-jason2-20260723, PR-2)
 *
 * Plan: reports/design_redesign_20260722/OVERVIEW_2S_ARCH_PLAN_20260722.md §3,
 * PR-2 ("純新增聚合，無消費者"). market-data.ts gained a per-(source,symbol)
 * `historyAggregateCache`, incrementally maintained inside `pushQuoteEntry`'s
 * `!isDuplicateHistoryEntry` branch (the single write choke point that already
 * owns `history`). NOTHING reads it in production yet -- no endpoint or
 * consumer was changed in this PR, only exposed via the test-only
 * `_getHistoryAggregateForTest` accessor (matches this file's existing
 * `_`-prefixed export convention).
 *
 * These tests assert the aggregate's derived fields (count / firstTimestamp /
 * lastTimestamp / synthetic / hasTwoDistinctBars) match an independent
 * full-scan reduction over the exact sequence of entries actually pushed
 * (accounting for de-duplication and splice-eviction), across multiple
 * seeded scenarios: plain append, duplicate suppression, splice eviction
 * (small MANUAL_QUOTE_HISTORY_LIMIT), 1-minute-bucket crossing, synthetic vs
 * non-synthetic source, multi-(source,symbol) isolation, and
 * resetMarketDataWorkspaceState clearing.
 *
 * Known open scope (flagged for PR-3, not tested here): this aggregate
 * reflects the FULL retained per-(source,symbol) history (bounded only by
 * getQuoteHistoryLimit's cap), matching what listCachedProviderQuoteHistory
 * itself holds. The CURRENT computeMarketDataOverview call path additionally
 * slices the merged, globally-sorted, multi-symbol history array down to a
 * request-level `limit` (Math.max(quotes.length*4, 100) for history) BEFORE
 * grouping by symbol -- see PR-1's golden snapshot / bench script for
 * empirical characterization of when that slice does and doesn't drop
 * symbols. Reconciling (or deliberately dropping) that slice-based sampling
 * behavior is PR-3's job when it wires this aggregate up as a consumer, not
 * this PR's.
 *
 * Run: node --import ./tests/setup-test-env.mjs --import tsx --test apps/api/src/__tests__/overview-quality-aggregate-parity.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  _getHistoryAggregateForTest,
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

const BUCKET_MS = 60_000;

// Independent (non-shared-code) full-scan reduction over the sequence of entries
// that actually survived de-duplication -- the "ground truth" the incremental
// aggregate is compared against. Deliberately reimplemented here rather than
// importing any market-data.ts helper, so this test can't pass by construction
// (i.e. by accidentally sharing a bug with the code under test).
function expectedAggregateFromSurvivingEntries(
  entries: { timestamp: string }[],
  synthetic: boolean
) {
  assert.ok(entries.length > 0, "test setup bug: expected at least 1 surviving entry");
  const bucketStarts = new Set(
    entries.map((entry) => Math.floor(new Date(entry.timestamp).getTime() / BUCKET_MS) * BUCKET_MS)
  );
  return {
    count: entries.length,
    firstTimestamp: entries[0].timestamp,
    lastTimestamp: entries.at(-1)!.timestamp,
    synthetic,
    hasTwoDistinctBars: bucketStarts.size >= 2,
  };
}

async function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  const originalStoreDir = process.env.MARKET_DATA_STORE_DIR;
  const storeDir = await mkdtemp(path.join(tmpdir(), "iuf-overview-agg-parity-"));
  process.env.MARKET_DATA_STORE_DIR = storeDir;
  try {
    return await fn();
  } finally {
    if (originalStoreDir === undefined) delete process.env.MARKET_DATA_STORE_DIR;
    else process.env.MARKET_DATA_STORE_DIR = originalStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
}

test("plain append sequence: count/first/last track every non-duplicate push, all within one 1m bucket -> hasTwoDistinctBars stays false", async () => {
  await withTempStore(async () => {
    const slug = `agg-parity-plain-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const baseMs = Date.parse("2026-07-23T02:00:00.000Z");
      const pushed: { timestamp: string }[] = [];
      for (let i = 0; i < 5; i++) {
        const timestamp = new Date(baseMs + i * 1000).toISOString(); // 5s apart, same minute
        pushed.push({ timestamp });
        await upsertTwseMisQuotes({
          session,
          quotes: [
            {
              symbol: "2330",
              market: "TWSE",
              source: "twse_mis",
              last: 100 + i,
              bid: null,
              ask: null,
              open: null,
              high: null,
              low: null,
              prevClose: null,
              volume: 1000,
              changePct: null,
              timestamp,
            },
          ],
        });
      }

      const actual = _getHistoryAggregateForTest(slug, "twse_mis", "TWSE", "2330");
      const expected = expectedAggregateFromSurvivingEntries(pushed, false);
      assert.deepStrictEqual(
        { count: actual?.count, firstTimestamp: actual?.firstTimestamp, lastTimestamp: actual?.lastTimestamp, synthetic: actual?.synthetic, hasTwoDistinctBars: actual?.hasTwoDistinctBars },
        expected
      );
    } finally {
      resetMarketDataWorkspaceState(slug);
    }
  });
});

test("duplicate entries (identical timestamp/last/bid/ask/volume) do not advance the aggregate", async () => {
  await withTempStore(async () => {
    const slug = `agg-parity-dup-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const t0 = "2026-07-23T02:00:00.000Z";
      const quote = {
        symbol: "2454",
        market: "TWSE" as const,
        source: "twse_mis" as const,
        last: 500,
        bid: 499,
        ask: 501,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        volume: 200,
        changePct: null,
      };

      await upsertTwseMisQuotes({ session, quotes: [{ ...quote, timestamp: t0 }] });
      // Same tick re-sent 3x (real MIS-sweep re-send-without-change behavior) --
      // must NOT advance count/lastTimestamp.
      await upsertTwseMisQuotes({ session, quotes: [{ ...quote, timestamp: t0 }] });
      await upsertTwseMisQuotes({ session, quotes: [{ ...quote, timestamp: t0 }] });
      await upsertTwseMisQuotes({ session, quotes: [{ ...quote, timestamp: t0 }] });

      const afterDupes = _getHistoryAggregateForTest(slug, "twse_mis", "TWSE", "2454");
      assert.equal(afterDupes?.count, 1);
      assert.equal(afterDupes?.firstTimestamp, t0);
      assert.equal(afterDupes?.lastTimestamp, t0);

      // A genuinely new tick (different `last`) DOES advance it.
      const t1 = "2026-07-23T02:00:05.000Z";
      await upsertTwseMisQuotes({ session, quotes: [{ ...quote, last: 501, timestamp: t1 }] });
      const afterNewTick = _getHistoryAggregateForTest(slug, "twse_mis", "TWSE", "2454");
      assert.equal(afterNewTick?.count, 2);
      assert.equal(afterNewTick?.firstTimestamp, t0);
      assert.equal(afterNewTick?.lastTimestamp, t1);
    } finally {
      resetMarketDataWorkspaceState(slug);
    }
  });
});

test("splice eviction (small MANUAL_QUOTE_HISTORY_LIMIT): count stays capped, firstTimestamp advances to the oldest SURVIVING entry", async () => {
  const originalLimit = process.env.MANUAL_QUOTE_HISTORY_LIMIT;
  process.env.MANUAL_QUOTE_HISTORY_LIMIT = "3";
  await withTempStore(async () => {
    const slug = `agg-parity-splice-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const baseMs = Date.parse("2026-07-23T02:00:00.000Z");
      const allPushed: { timestamp: string }[] = [];
      for (let i = 0; i < 7; i++) {
        const timestamp = new Date(baseMs + i * 1000).toISOString();
        allPushed.push({ timestamp });
        await upsertManualQuotes({
          session,
          quotes: [
            {
              symbol: "2603",
              market: "TWSE",
              source: "manual",
              last: 10 + i,
              bid: null,
              ask: null,
              open: null,
              high: null,
              low: null,
              prevClose: null,
              volume: 100,
              changePct: null,
              timestamp,
            },
          ],
        });
      }

      // limit=3, 7 pushes -> only the last 3 survive (indices 4,5,6).
      const survivors = allPushed.slice(-3);
      const actual = _getHistoryAggregateForTest(slug, "manual", "TWSE", "2603");
      const expected = expectedAggregateFromSurvivingEntries(survivors, true);
      assert.deepStrictEqual(
        { count: actual?.count, firstTimestamp: actual?.firstTimestamp, lastTimestamp: actual?.lastTimestamp, synthetic: actual?.synthetic, hasTwoDistinctBars: actual?.hasTwoDistinctBars },
        expected
      );
      assert.equal(actual?.count, 3);
    } finally {
      resetMarketDataWorkspaceState(slug);
      if (originalLimit === undefined) delete process.env.MANUAL_QUOTE_HISTORY_LIMIT;
      else process.env.MANUAL_QUOTE_HISTORY_LIMIT = originalLimit;
    }
  });
});

test("hasTwoDistinctBars: false while all ticks share one 1m bucket, flips true (and stays true) once a 2nd distinct bucket is touched, even after splice eviction would otherwise drop the original bucket's entries", async () => {
  const originalLimit = process.env.MANUAL_QUOTE_HISTORY_LIMIT;
  process.env.MANUAL_QUOTE_HISTORY_LIMIT = "2";
  await withTempStore(async () => {
    const slug = `agg-parity-bucket-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const minute0 = Date.parse("2026-07-23T02:00:00.000Z");
      const push = (isoTimestamp: string, last: number) =>
        upsertManualQuotes({
          session,
          quotes: [
            {
              symbol: "1301",
              market: "TWSE",
              source: "manual",
              last,
              bid: null,
              ask: null,
              open: null,
              high: null,
              low: null,
              prevClose: null,
              volume: 100,
              changePct: null,
              timestamp: isoTimestamp,
            },
          ],
        });

      await push(new Date(minute0 + 0).toISOString(), 1);
      let agg = _getHistoryAggregateForTest(slug, "manual", "TWSE", "1301");
      assert.equal(agg?.hasTwoDistinctBars, false);

      await push(new Date(minute0 + 10_000).toISOString(), 2); // still minute 0
      agg = _getHistoryAggregateForTest(slug, "manual", "TWSE", "1301");
      assert.equal(agg?.hasTwoDistinctBars, false);

      // limit=2, this 3rd push evicts the very first (minute 0) entry -- but this
      // tick itself lands in minute 1, so the crossing IS observed at push time
      // (the aggregate updates using the freshly-pushed entry, not a stale view).
      await push(new Date(minute0 + 60_000).toISOString(), 3); // minute 1
      agg = _getHistoryAggregateForTest(slug, "manual", "TWSE", "1301");
      assert.equal(agg?.count, 2); // capped by limit
      assert.equal(agg?.hasTwoDistinctBars, true);

      // Further pushes staying in minute 1 must NOT reset the flag back to false.
      await push(new Date(minute0 + 65_000).toISOString(), 4);
      agg = _getHistoryAggregateForTest(slug, "manual", "TWSE", "1301");
      assert.equal(agg?.hasTwoDistinctBars, true);
    } finally {
      resetMarketDataWorkspaceState(slug);
      if (originalLimit === undefined) delete process.env.MANUAL_QUOTE_HISTORY_LIMIT;
      else process.env.MANUAL_QUOTE_HISTORY_LIMIT = originalLimit;
    }
  });
});

test("synthetic flag: manual source = true, kgi source = false, independent per (source,symbol) key", async () => {
  await withTempStore(async () => {
    const slug = `agg-parity-synthetic-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const t0 = "2026-07-23T02:00:00.000Z";
      await upsertManualQuotes({
        session,
        quotes: [
          {
            symbol: "2317",
            market: "TWSE",
            source: "manual",
            last: 100,
            bid: null,
            ask: null,
            open: null,
            high: null,
            low: null,
            prevClose: null,
            volume: 100,
            changePct: null,
            timestamp: t0,
          },
        ],
      });
      await upsertKgiQuotes({
        session,
        quotes: [
          {
            symbol: "2317",
            market: "TWSE",
            source: "kgi",
            last: 100,
            bid: null,
            ask: null,
            open: null,
            high: null,
            low: null,
            prevClose: null,
            volume: 100,
            changePct: null,
            timestamp: t0,
          },
        ],
      });

      const manualAgg = _getHistoryAggregateForTest(slug, "manual", "TWSE", "2317");
      const kgiAgg = _getHistoryAggregateForTest(slug, "kgi", "TWSE", "2317");
      assert.equal(manualAgg?.synthetic, true);
      assert.equal(kgiAgg?.synthetic, false);
      // Same symbol, two independent source buckets -- neither's count leaked into the other.
      assert.equal(manualAgg?.count, 1);
      assert.equal(kgiAgg?.count, 1);
    } finally {
      resetMarketDataWorkspaceState(slug);
    }
  });
});

test("multi-symbol isolation: pushing many (source,symbol) keys does not cross-contaminate counts, and resetMarketDataWorkspaceState clears all of them for that workspace", async () => {
  await withTempStore(async () => {
    const slug = `agg-parity-multi-${Date.now()}`;
    const session = makeSession(slug);
    resetMarketDataWorkspaceState(slug);
    try {
      const symbols = Array.from({ length: 20 }, (_, i) => String(3000 + i));
      const t0 = "2026-07-23T02:00:00.000Z";
      // Symbol i gets (i % 4) + 1 ticks.
      for (const [index, symbol] of symbols.entries()) {
        const tickCount = (index % 4) + 1;
        for (let t = 0; t < tickCount; t++) {
          await upsertTwseMisQuotes({
            session,
            quotes: [
              {
                symbol,
                market: "TWSE",
                source: "twse_mis",
                last: 100 + t,
                bid: null,
                ask: null,
                open: null,
                high: null,
                low: null,
                prevClose: null,
                volume: 100,
                changePct: null,
                timestamp: new Date(Date.parse(t0) + t * 1000).toISOString(),
              },
            ],
          });
        }
      }

      for (const [index, symbol] of symbols.entries()) {
        const expectedCount = (index % 4) + 1;
        const agg = _getHistoryAggregateForTest(slug, "twse_mis", "TWSE", symbol);
        assert.equal(agg?.count, expectedCount, `symbol ${symbol} expected count ${expectedCount}`);
      }

      resetMarketDataWorkspaceState(slug);
      for (const symbol of symbols) {
        assert.equal(_getHistoryAggregateForTest(slug, "twse_mis", "TWSE", symbol), undefined);
      }
    } finally {
      resetMarketDataWorkspaceState(slug);
    }
  });
});
