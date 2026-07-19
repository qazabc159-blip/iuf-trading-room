/**
 * effective-quotes-official-close-fallback.test.ts — 2026-07-19, round 2
 *
 * Bug this fixes: GET /api/v1/market-data/effective-quotes on a weekend, or
 * right after a deploy restart (which wipes the in-memory quote cache), was
 * returning every symbol as selectedQuote:null / fallbackReason:no_fresh_quote
 * — the desk-exact watchlist and quote header went fully blank — even though
 * quote_last_close (populated daily by twse-eod-cron) already had the last
 * trading day's official close for these symbols.
 *
 * ROUND 2 CORRECTION (2026-07-19): round 1's own fixtures below (the
 * "seed a stale manual quote so the item shows up as selectedQuote:null"
 * tests) were an EASIER scenario than what prod actually hit after #1307
 * deployed. Elva's prod re-test right after the deploy restart showed
 * `items: []` / `summary.total: 0` for symbols "2330,2454" — NOT individual
 * blocked items. resolveMarketQuotes()'s `grouped` map only emits an item for
 * a symbol once at least one provider has EVER cached a quote for it in this
 * process's lifetime — a deploy restart wipes providerQuoteCache entirely, so
 * requested symbols simply vanish from the array rather than appearing
 * blocked. Round 1's own docstring/Pete's review flagged this as a rare
 * "cold symbol" edge case; it turned out to BE the main prod symptom. See
 * the INVARIANT tests below tagged "ROUND 2" for the actual repro + fix
 * coverage, and _synthesizeItemForMissingSymbol's docstring in market-data.ts
 * for why this couldn't be caught by loadPersistedQuoteEntries()'s existing
 * on-restart reload (infra config drift — RAILWAY_VOLUME_MOUNT_PATH is
 * unset on the api service in prod, confirmed via `railway variables`/
 * `railway volume list` — not a logic bug in that function).
 *
 * Scope of these tests: the pure `_applyOfficialCloseFallback()` merge
 * function and the new pure `_synthesizeItemForMissingSymbol()` (INVARIANT
 * tests, no DB needed — same convention as mergeEodFallbackWithPersistedBars
 * in server.ts / quote-realtime-persisted-supersede.test.ts) plus
 * `_isMarketDataOffHours()` and end-to-end regression checks of
 * getEffectiveMarketQuotesWithOfficialCloseFallback() itself in memory mode
 * (PERSISTENCE_MODE unset in this test run → isDatabaseMode() is false →
 * the wrapper must (a) be a pure passthrough when nothing needs fixing, and
 * (b) still synthesize honest BLOCKED items — never silently drop a
 * requested symbol — even when quote_last_close itself is unreachable).
 *
 * Note on round-1 fixtures below: resolveMarketQuotes() only emits an item
 * for a symbol once at least one provider has EVER cached a quote for it
 * (its `grouped` map is built from quotes actually present, not the full
 * symbol universe) — a symbol with zero cached quotes anywhere doesn't
 * appear in the response at all, rather than appearing as a "blocked" item.
 * These particular fixtures reproduce the "present but blocked" shape only
 * (seed a deliberately-stale manual quote); the round-2 tests below cover
 * the "absent entirely" shape, which is the one that actually matched prod.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/effective-quotes-official-close-fallback.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  _applyOfficialCloseFallback,
  _isMarketDataOffHours,
  _parseRequestedSymbols,
  _synthesizeItemForMissingSymbol,
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

// ── ROUND 2 (2026-07-19): the actual prod failure mode ──────────────────────

test("ROUND 2 repro: a symbol never cached by any provider does not appear in getEffectiveMarketQuotes() output at all (items.length === 0), matching Elva's prod re-test", async () => {
  const slug = `official-close-round2-repro-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    // No manual/paper/kgi/twse_mis quotes upserted at all — this is exactly
    // the state right after a deploy restart (in-memory cache wiped, and
    // loadPersistedQuoteEntries()'s on-restart reload is a no-op in prod —
    // see file header docstring for why).
    const effective = await getEffectiveMarketQuotes({ session, symbols: "2330,2454" });
    assert.deepStrictEqual(effective.items, [], "requested symbols vanish entirely, not as blocked items");
    assert.equal(effective.summary.total, 0);
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

test("ROUND 2 INVARIANT: _parseRequestedSymbols mirrors resolveMarketQuotes()'s own symbol parsing (trim/uppercase/dedupe)", () => {
  assert.deepStrictEqual(_parseRequestedSymbols(" 2330 ,2454,2330,tsm "), ["2330", "2454", "TSM"]);
});

test("ROUND 2 INVARIANT: _synthesizeItemForMissingSymbol fills a never-cached symbol from quote_last_close with closed_snapshot freshness, usable flags false", () => {
  const item = _synthesizeItemForMissingSymbol({
    symbol: "2330",
    market: "TWSE",
    lastClose: { closePrice: 1050, tradeDate: "2026-07-17", source: "twse_eod" },
    offHours: true,
    providerStatuses: []
  });

  assert.equal(item.selectedSource, "official_close");
  assert.equal(item.selectedQuote?.last, 1050);
  assert.equal(item.selectedQuote?.source, "official_close");
  assert.equal(item.freshnessStatus, "closed_snapshot");
  assert.equal(item.closedSnapshotTradeDate, "2026-07-17");
  assert.equal(item.strategyUsable, false);
  assert.equal(item.paperUsable, false);
  assert.equal(item.liveUsable, false);
  assert.equal(item.readiness, "degraded");
  // All 5 known providers must still appear (honestly missing), plus official_close.
  assert.equal(item.candidates.length, 6);
  const officialCandidate = item.candidates.find((c) => c.source === "official_close");
  assert.equal(officialCandidate?.quote?.last, 1050);
  assert.equal(officialCandidate?.priority, 0);
});

test("ROUND 2 INVARIANT: _synthesizeItemForMissingSymbol honestly marks intraday-dead-feed fallback as stale, not closed_snapshot", () => {
  const item = _synthesizeItemForMissingSymbol({
    symbol: "2330",
    market: "TWSE",
    lastClose: { closePrice: 1050, tradeDate: "2026-07-17", source: "twse_eod" },
    offHours: false,
    providerStatuses: []
  });
  assert.equal(item.freshnessStatus, "stale");
  assert.equal(item.selectedQuote?.isStale, true);
  assert.equal(item.strategyUsable, false);
});

test("ROUND 2 INVARIANT: _synthesizeItemForMissingSymbol returns an explicit BLOCKED item (never silently absent) when quote_last_close also has nothing", () => {
  const item = _synthesizeItemForMissingSymbol({
    symbol: "9999",
    market: "TWSE",
    lastClose: undefined,
    offHours: true,
    providerStatuses: []
  });
  assert.equal(item.selectedSource, null);
  assert.equal(item.selectedQuote, null);
  assert.equal(item.freshnessStatus, "missing");
  assert.equal(item.readiness, "blocked");
  assert.ok(item.reasons.includes("missing_quote"));
  assert.equal(item.candidates.length, 5, "no official_close candidate when quote_last_close has nothing either");
  assert.equal(item.closedSnapshotTradeDate, null);
});

test("ROUND 2 INVARIANT: _synthesizeItemForMissingSymbol honestly reflects a connected provider's status even for a symbol it has no quote for", () => {
  const item = _synthesizeItemForMissingSymbol({
    symbol: "2330",
    market: "TWSE",
    lastClose: undefined,
    offHours: true,
    providerStatuses: [
      {
        source: "kgi",
        connected: true,
        lastMessageAt: null,
        latencyMs: null,
        latestQuoteAgeMs: null,
        freshnessStatus: "missing",
        readiness: "blocked",
        strategyUsable: false,
        paperUsable: false,
        liveUsable: false,
        staleAfterMs: null,
        subscribedSymbols: ["2454"],
        reasons: [],
        errorMessage: null
      } as any
    ]
  });
  const kgiCandidate = item.candidates.find((c) => c.source === "kgi")!;
  assert.equal(kgiCandidate.providerConnected, true, "must reflect the real connected status, not a blanket false");
  assert.equal(kgiCandidate.subscribed, false, "2330 itself is not in kgi's subscribedSymbols list");
  assert.equal(kgiCandidate.quote, null);
});

test("ROUND 2 end-to-end: getEffectiveMarketQuotesWithOfficialCloseFallback guarantees one item per requested symbol even when quote_last_close is unreachable (memory mode)", async () => {
  const slug = `official-close-round2-wrapper-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    // Never cached at all, and PERSISTENCE_MODE is unset in this test run
    // (isDatabaseMode() === false) — quote_last_close is unreachable, so
    // these must come back as honest BLOCKED items, not vanish.
    const wrapped = await getEffectiveMarketQuotesWithOfficialCloseFallback({
      session,
      symbols: "8881,8882",
    });

    assert.equal(wrapped.items.length, 2, "every requested symbol must get exactly one item");
    assert.equal(wrapped.summary.total, 2);
    assert.equal(wrapped.summary.blocked, 2);
    for (const symbol of ["8881", "8882"]) {
      const item = wrapped.items.find((i) => i.symbol === symbol);
      assert.ok(item, `${symbol} must be present`);
      assert.equal(item?.selectedQuote, null);
      assert.equal(item?.readiness, "blocked");
    }
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

// ── ROUND 3 (2026-07-20): includeStale=true stale-arbitration bug ───────────
//
// Prod repro (Elva, /m mobile watchlist): 2330 showed a stale "行情" quote of
// 875.00 and 0050 showed a stale "手動資料" quote of 100.15, while the real
// 7/17 official closes were 2,290 and 201.35. Root cause: /m calls
// getEffectiveQuotes with includeStale:true (apps/web/app/m/MobileKgiWatchlist.tsx),
// and resolveMarketQuotes()'s `eligible = quote !== null && (includeStale ||
// freshnessStatus === "fresh")` makes ANY existing quote object "eligible"
// once includeStale=true, regardless of age — the candidate list is then
// picked purely by SOURCE PRIORITY (kgi > twse_mis > tradingview > paper >
// manual), never by recency. A months-old residual manual/tradingview cache
// entry from a stale-but-nonzero source therefore wins over resolveMarket-
// Quotes()'s "no eligible fresh candidate" state — and _applyOfficialClose-
// Fallback's ORIGINAL guard (`selectedQuote !== null` => never touch) let
// that ancient value block the official_close fallback entirely, even
// though quote_last_close has yesterday's real close sitting right there.
//
// Fix: _applyOfficialCloseFallback now arbitrates by RECENCY once there is
// no fresh selection — official_close only replaces an existing stale
// selectedQuote when official_close's own timestamp is >= the stale
// selectedQuote's timestamp.

test("ROUND 3: an ancient stale manual quote (months old) loses to a more recent official_close — the exact reported bug", async () => {
  const slug = `official-close-round3-ancient-manual-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    const ancientTimestamp = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days old
    await upsertManualQuotes({
      session,
      quotes: [
        {
          symbol: "0050",
          market: "TWSE",
          source: "manual",
          last: 100.15,
          bid: null,
          ask: null,
          open: null,
          high: null,
          low: null,
          prevClose: null,
          volume: null,
          changePct: null,
          timestamp: ancientTimestamp,
        },
      ],
    });

    // Reproduces the /m watchlist's exact call shape (includeStale: true).
    const effective = await getEffectiveMarketQuotes({ session, symbols: "0050", includeStale: true });
    const before = effective.items.find((item) => item.symbol === "0050")!;
    assert.equal(before.selectedSource, "manual", "sanity: source-priority picks the ancient manual quote when includeStale=true");
    assert.notEqual(before.selectedQuote, null, "sanity: this is the bug's precondition — selectedQuote is non-null despite being 90 days old");
    assert.equal(before.freshnessStatus, "stale");

    const lastCloseMap = new Map([["0050", { closePrice: 201.35, tradeDate: "2026-07-17", source: "twse_eod" }]]);
    const augmented = _applyOfficialCloseFallback(effective.items, lastCloseMap, /* offHours */ true);
    const after = augmented.find((item) => item.symbol === "0050")!;

    assert.equal(after.selectedSource, "official_close", "official_close must win over the ancient manual residual");
    assert.equal(after.selectedQuote?.last, 201.35);
    assert.equal(after.closedSnapshotTradeDate, "2026-07-17");
    assert.equal(after.strategyUsable, false);
    assert.equal(after.paperUsable, false);
    assert.equal(after.liveUsable, false);
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

test("ROUND 3: a near-fresh stale candidate (timestamped today, just past the staleness threshold) still wins over yesterday's official_close", async () => {
  // Direct fixture on the pure function (not resolveMarketQuotes) so the
  // "just barely stale, still today" timestamp is exact and not dependent on
  // MANUAL_QUOTE_STALE_MS env timing.
  const todayStaleTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
  const item = {
    symbol: "2330",
    market: "TWSE" as const,
    selectedSource: "manual" as const,
    selectedQuote: {
      symbol: "2330",
      market: "TWSE" as const,
      source: "manual" as const,
      last: 2295,
      bid: null,
      ask: null,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      changePct: null,
      volume: null,
      timestamp: todayStaleTimestamp,
      ageMs: 5 * 60 * 1000,
      isStale: true,
    },
    freshnessStatus: "stale" as const,
    fallbackReason: "no_fresh_quote" as const,
    staleReason: "age_exceeded" as const,
    readiness: "blocked" as const,
    strategyUsable: false,
    paperUsable: false,
    liveUsable: false,
    synthetic: false,
    providerConnected: false,
    staleAfterMs: 60_000,
    sourcePriority: 1,
    reasons: ["stale:age_exceeded"],
    candidates: [],
    closedSnapshotTradeDate: null,
  };

  // Yesterday's official close — strictly older than the 5-minutes-ago stale quote.
  const lastCloseMap = new Map([["2330", { closePrice: 2290, tradeDate: "2026-07-17", source: "twse_eod" }]]);
  const augmented = _applyOfficialCloseFallback([item as any], lastCloseMap, false);

  assert.deepStrictEqual(augmented, [item], "a same-day stale quote must still beat yesterday's official close");
});

test("ROUND 3: fresh live source is never touched even when quote_last_close has a newer-looking timestamp available", async () => {
  const slug = `official-close-round3-fresh-untouched-${Date.now()}`;
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
          last: 2295,
          bid: null,
          ask: null,
          open: null,
          high: null,
          low: null,
          prevClose: null,
          volume: null,
          changePct: null,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const effective = await getEffectiveMarketQuotes({ session, symbols: "2330", includeStale: true });
    const live = effective.items.find((item) => item.symbol === "2330")!;
    assert.equal(live.freshnessStatus, "fresh");

    const lastCloseMap = new Map([["2330", { closePrice: 2290, tradeDate: "2026-07-17", source: "twse_eod" }]]);
    const augmented = _applyOfficialCloseFallback(effective.items, lastCloseMap, true);
    assert.deepStrictEqual(augmented, effective.items, "a fresh selection must never be replaced by official_close");
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});

test("ROUND 2 regression: getEffectiveMarketQuotesWithOfficialCloseFallback stays a pure passthrough when there is nothing to fix", async () => {
  const slug = `official-close-round2-passthrough-${Date.now()}`;
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

    const wrapped = await getEffectiveMarketQuotesWithOfficialCloseFallback({ session, symbols: "2330" });
    assert.equal(wrapped.items.length, 1);
    assert.equal(wrapped.items[0]?.selectedSource, "manual");
    assert.equal(wrapped.summary.total, 1);
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});
