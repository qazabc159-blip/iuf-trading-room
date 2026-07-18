/**
 * effective-quotes-official-close-fallback.test.ts — 2026-07-19
 *
 * Bug this fixes: GET /api/v1/market-data/effective-quotes on a weekend, or
 * right after a deploy restart (which wipes the in-memory quote cache), was
 * returning every symbol as selectedQuote:null / fallbackReason:no_fresh_quote
 * — the desk-exact watchlist and quote header went fully blank — even though
 * quote_last_close (populated daily by twse-eod-cron) already had the last
 * trading day's official close for these symbols.
 *
 * Scope of these tests: the pure `_applyOfficialCloseFallback()` merge
 * function (INVARIANT tests, no DB needed — same convention as
 * mergeEodFallbackWithPersistedBars in server.ts /
 * quote-realtime-persisted-supersede.test.ts) plus `_isMarketDataOffHours()`
 * and one end-to-end regression check of
 * getEffectiveMarketQuotesWithOfficialCloseFallback() itself in memory mode
 * (PERSISTENCE_MODE unset in this test run → isDatabaseMode() is false →
 * the wrapper must be a pure passthrough of getEffectiveMarketQuotes()).
 *
 * Note on fixtures: resolveMarketQuotes() only emits an item for a symbol
 * once at least one provider has EVER cached a quote for it (its `grouped`
 * map is built from quotes actually present, not the full symbol
 * universe) — a symbol with zero cached quotes anywhere doesn't appear in
 * the response at all, rather than appearing as a "blocked" item. The prod
 * incident this fixes had stale/reloaded provider quotes present (from
 * before the cache wipe / prior polling cycles) that simply aged past
 * their staleAfterMs window, which is why every candidate showed up with a
 * non-eligible (not necessarily null) quote and selectedQuote:null. These
 * fixtures reproduce that shape: seed a deliberately-stale manual quote so
 * the item is present in the response with selectedQuote:null.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/effective-quotes-official-close-fallback.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  _applyOfficialCloseFallback,
  _isMarketDataOffHours,
  getEffectiveMarketQuotes,
  getEffectiveMarketQuotesWithOfficialCloseFallback,
  resetMarketDataWorkspaceState,
  upsertManualQuotes,
} from "../market-data.js";

function makeSession(slug: string) {
  return {
    workspace: { id: `workspace-${slug}`, name: slug, slug },
    user: { id: `user-${slug}`, name: "Test User", email: "test@example.com", role: "Owner" },
    persistenceMode: "memory",
  } as any;
}

const STALE_TIMESTAMP = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days old

async function seedStaleBlockedQuotes(session: any, symbols: string[]) {
  await upsertManualQuotes({
    session,
    quotes: symbols.map((symbol) => ({
      symbol,
      market: "TWSE" as const,
      source: "manual" as const,
      last: 1,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: null,
      changePct: null,
      timestamp: STALE_TIMESTAMP,
    })),
  });
}

test("INVARIANT: weekend/restart fixture — official_close fills a blocked item with closed_snapshot freshness, keeps paper/live/strategy usable false", async () => {
  const slug = `official-close-weekend-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    await seedStaleBlockedQuotes(session, ["2330", "2454"]);

    const effective = await getEffectiveMarketQuotes({ session, symbols: "2330,2454" });
    assert.equal(effective.items.length, 2);
    for (const item of effective.items) {
      assert.equal(item.selectedQuote, null, `${item.symbol} must start blocked (only a stale quote present)`);
    }

    const lastCloseMap = new Map([
      ["2330", { closePrice: 1050, tradeDate: "2026-07-17", source: "twse_eod" }],
      ["2454", { closePrice: 88.5, tradeDate: "2026-07-17", source: "twse_eod" }],
    ]);

    const augmented = _applyOfficialCloseFallback(effective.items, lastCloseMap, /* offHours */ true);

    const tsmc = augmented.find((item) => item.symbol === "2330")!;
    assert.equal(tsmc.selectedSource, "official_close");
    assert.equal(tsmc.selectedQuote?.last, 1050);
    assert.equal(tsmc.selectedQuote?.source, "official_close");
    assert.equal(tsmc.freshnessStatus, "closed_snapshot", "must be honestly labelled, never fresh");
    assert.equal(tsmc.closedSnapshotTradeDate, "2026-07-17");
    assert.equal(tsmc.strategyUsable, false);
    assert.equal(tsmc.paperUsable, false);
    assert.equal(tsmc.liveUsable, false);
    assert.equal(tsmc.readiness, "degraded");
    const officialCandidate = tsmc.candidates.find((c) => c.source === "official_close");
    assert.ok(officialCandidate, "official_close must appear in the candidates list for transparency");
    assert.equal(officialCandidate?.priority, 0, "official_close must be the lowest-priority candidate");

    const mtk = augmented.find((item) => item.symbol === "2454")!;
    assert.equal(mtk.selectedQuote?.last, 88.5);
    assert.equal(mtk.freshnessStatus, "closed_snapshot");
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

test("INVARIANT: intraday live feed present — official_close fallback never overrides an already-resolved item (byte-compatible regression)", async () => {
  const slug = `official-close-intraday-live-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    await upsertManualQuotes({
      session,
      quotes: [
        {
          symbol: "2330",
          market: "TWSE",
          source: "manual",
          last: 1234,
          bid: null,
          ask: null,
          open: null,
          high: null,
          low: null,
          prevClose: 1200,
          volume: 1000,
          changePct: 2.83,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    // End-to-end: with PERSISTENCE_MODE unset (memory mode) in this test
    // run, isDatabaseMode() is false, so the full wrapper must be a pure
    // passthrough of getEffectiveMarketQuotes() — this is the "intraday
    // live-quote path is byte-compatible with current behavior" regression
    // guarantee at the exact function wired into the HTTP route.
    const wrapped = await getEffectiveMarketQuotesWithOfficialCloseFallback({ session, symbols: "2330" });
    const live = wrapped.items.find((item) => item.symbol === "2330")!;
    assert.notEqual(live.selectedQuote, null, "manual quote must resolve as the selected source");
    assert.equal(live.selectedSource, "manual");
    assert.equal(live.freshnessStatus, "fresh");
    assert.equal(live.selectedQuote?.last, 1234);

    // Even if the DB "happens to" have an official close for this symbol
    // too, an item that already has a selectedQuote must be passed through
    // completely untouched by the merge function itself.
    const effective = await getEffectiveMarketQuotes({ session, symbols: "2330" });
    const lastCloseMap = new Map([["2330", { closePrice: 999, tradeDate: "2026-07-18", source: "twse_eod" }]]);
    const augmented = _applyOfficialCloseFallback(effective.items, lastCloseMap, true);
    assert.deepStrictEqual(augmented, effective.items, "official_close must never override a resolved live quote");
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

test("INVARIANT: DB also has no official close for a blocked symbol — stays honest no_quote, unchanged", () => {
  const blockedItem = {
    symbol: "9999",
    market: "TWSE" as const,
    selectedSource: null,
    selectedQuote: null,
    freshnessStatus: "missing" as const,
    fallbackReason: "no_quote" as const,
    staleReason: "no_quote" as const,
    readiness: "blocked" as const,
    strategyUsable: false,
    paperUsable: false,
    liveUsable: false,
    synthetic: false,
    providerConnected: false,
    staleAfterMs: null,
    sourcePriority: null,
    reasons: ["missing_quote"],
    candidates: [],
    closedSnapshotTradeDate: null,
  };

  const augmented = _applyOfficialCloseFallback([blockedItem as any], new Map(), true);
  assert.deepStrictEqual(augmented, [blockedItem]);
});

test("INVARIANT: intraday session with all live feeds dead — official_close is honestly marked stale, not closed_snapshot, and still not usable", async () => {
  const slug = `official-close-intraday-broken-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    await seedStaleBlockedQuotes(session, ["2330"]);
    const effective = await getEffectiveMarketQuotes({ session, symbols: "2330" });
    assert.equal(effective.items[0]?.selectedQuote, null);

    const lastCloseMap = new Map([["2330", { closePrice: 1050, tradeDate: "2026-07-17", source: "twse_eod" }]]);

    const augmented = _applyOfficialCloseFallback(effective.items, lastCloseMap, /* offHours */ false);
    const tsmc = augmented[0]!;
    assert.equal(tsmc.freshnessStatus, "stale", "intraday fallback must be honestly stale, not closed_snapshot");
    assert.equal(tsmc.selectedQuote?.isStale, true);
    assert.equal(tsmc.strategyUsable, false);
    assert.equal(tsmc.paperUsable, false);
    assert.equal(tsmc.liveUsable, false);
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

test("_isMarketDataOffHours: weekend is always off-hours regardless of time of day", async () => {
  // 2024-01-06 is a Saturday. 02:00 UTC = 10:00 Taipei (would be mid-session
  // on a weekday), but a Saturday must still be off-hours.
  const saturdayMs = Date.UTC(2024, 0, 6, 2, 0, 0);
  assert.equal(await _isMarketDataOffHours(saturdayMs), true);
});

test("_isMarketDataOffHours: weekday during 09:00-13:30 Taipei session is NOT off-hours", async () => {
  // 2024-01-09 is a Tuesday. 02:00 UTC = 10:00 Taipei (mid-session).
  const tuesdayMorningMs = Date.UTC(2024, 0, 9, 2, 0, 0);
  assert.equal(await _isMarketDataOffHours(tuesdayMorningMs), false);
});

test("_isMarketDataOffHours: weekday outside 09:00-13:30 Taipei session IS off-hours", async () => {
  // 2024-01-09 is a Tuesday. 12:00 UTC = 20:00 Taipei (well after close).
  const tuesdayEveningMs = Date.UTC(2024, 0, 9, 12, 0, 0);
  assert.equal(await _isMarketDataOffHours(tuesdayEveningMs), true);
});
