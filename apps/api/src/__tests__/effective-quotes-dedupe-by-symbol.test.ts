/**
 * effective-quotes-dedupe-by-symbol.test.ts — 2026-07-20
 * (quote_close_0050_forensics_20260720)
 *
 * Bug this fixes: GET /api/v1/market-data/effective-quotes?symbols=2330,0050,2454
 * returned 4 items for 3 requested symbols — 0050 (元大台灣50 ETF) appeared
 * twice. Live prod repro (curl, 2026-07-20 09:3x TST): resolveMarketQuotes()
 * groups quotes by buildQuoteIdentityKey(symbol, market) — the SAME real
 * symbol had two different `market` tags in the quote cache: a stale
 * "manual" quote tagged market:"TWSE" (the TWSE-EOD-QUOTE-CRON's leftover
 * Friday close) and a fresh "twse_mis" quote tagged market:"OTHER" (the
 * full-universe MIS sweep, root-caused in server.ts's
 * _mapMisSweepCompanyMarket — see that function's docstring for why
 * `companies.market = "ETF"` for 0050 fell through to the wrong default).
 * Two different (symbol, market) keys for one real security → two items.
 *
 * This ALSO explains "0050 shows no fresh MIS source intraday": a caller
 * that filters `?market=TWSE` only ever sees the "TWSE"-tagged stale manual
 * item — the fresh "OTHER"-tagged twse_mis item is silently excluded by the
 * market filter entirely.
 *
 * server.ts's _mapMisSweepCompanyMarket is fixed at the source in this same
 * change (its default now matches its sibling _misSwpExPrefix's "TWSE"
 * default instead of falling through to "OTHER"), so this specific
 * mismatch won't recur going forward. This test file covers the
 * belt-and-suspenders fix at the API response boundary: _dedupeItemsBySymbol
 * (new pure function in market-data.ts), wired into
 * getEffectiveMarketQuotesWithOfficialCloseFallback so "N symbols requested
 * in → at most N items out" holds even if some future provider bug
 * reintroduces a symbol/market mismatch.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/effective-quotes-dedupe-by-symbol.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  _dedupeItemsBySymbol,
  _synthesizeItemForMissingSymbol,
  getEffectiveMarketQuotesWithOfficialCloseFallback,
  resetMarketDataWorkspaceState,
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

test("UNIT _dedupeItemsBySymbol: a fresh item beats a stale item for the same symbol, regardless of market tag", () => {
  const staleTwse = _synthesizeItemForMissingSymbol({
    symbol: "0050",
    market: "TWSE",
    lastClose: { closePrice: 100.15, tradeDate: "2026-07-17", source: "twse_eod" },
    offHours: false,
    providerStatuses: [],
  });
  assert.equal(staleTwse.freshnessStatus, "stale");

  // A synthetic "fresh" duplicate tagged with a DIFFERENT market — mirrors
  // the real bug's shape (same real symbol, two different market tags).
  const freshOther = {
    ...staleTwse,
    market: "OTHER" as const,
    freshnessStatus: "fresh" as const,
    readiness: "degraded" as const,
    sourcePriority: 4,
  };

  const result = _dedupeItemsBySymbol([staleTwse, freshOther]);
  assert.equal(result.length, 1, "must collapse to exactly one item per symbol");
  assert.equal(result[0].freshnessStatus, "fresh", "the fresher of the two duplicates must win");
  assert.equal(result[0].market, "OTHER");

  // Order-independence: same result regardless of which duplicate appears first.
  const resultReversed = _dedupeItemsBySymbol([freshOther, staleTwse]);
  assert.equal(resultReversed.length, 1);
  assert.equal(resultReversed[0].freshnessStatus, "fresh");
});

test("UNIT _dedupeItemsBySymbol: no-op passthrough when every requested symbol already has exactly one item", () => {
  const a = _synthesizeItemForMissingSymbol({
    symbol: "2330",
    market: "TWSE",
    lastClose: undefined,
    offHours: false,
    providerStatuses: [],
  });
  const b = _synthesizeItemForMissingSymbol({
    symbol: "2454",
    market: "TWSE",
    lastClose: undefined,
    offHours: false,
    providerStatuses: [],
  });
  const result = _dedupeItemsBySymbol([a, b]);
  assert.equal(result.length, 2);
  assert.deepStrictEqual(result.map((item) => item.symbol), ["2330", "2454"]);
});

test("INTEGRATION: live-repro shape — ?symbols=2330,0050,2454 with a stale manual TWSE quote + a fresh twse_mis OTHER-tagged quote for 0050 returns exactly 3 items, not 4", async () => {
  const slug = `dedupe-0050-repro-${Date.now()}`;
  const session = makeSession(slug);
  resetMarketDataWorkspaceState(slug);

  try {
    const now = new Date();
    const staleTs = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 min ago — stale for both manual/twse_mis (60s default threshold)
    const freshTs = now.toISOString();

    // Baseline clean symbols — one item each, must survive dedupe untouched.
    await upsertManualQuotes({
      session,
      quotes: [
        {
          symbol: "2330", market: "TWSE", source: "manual", last: 2290, bid: null, ask: null,
          open: null, high: null, low: null, prevClose: null, volume: null, changePct: null,
          timestamp: freshTs,
        },
        {
          symbol: "2454", market: "TWSE", source: "manual", last: 3370, bid: null, ask: null,
          open: null, high: null, low: null, prevClose: null, volume: null, changePct: null,
          timestamp: freshTs,
        },
        // Stale manual "TWSE"-tagged 0050 — mirrors the TWSE-EOD-QUOTE-CRON leftover.
        {
          symbol: "0050", market: "TWSE", source: "manual", last: 100.15, bid: null, ask: null,
          open: null, high: null, low: null, prevClose: null, volume: null, changePct: null,
          timestamp: staleTs,
        },
      ],
    });

    // Fresh twse_mis "OTHER"-tagged 0050 — mirrors the pre-fix _mapMisSweepCompanyMarket bug.
    await upsertTwseMisQuotes({
      session,
      quotes: [
        {
          symbol: "0050", market: "OTHER", source: "twse_mis", last: 98.8, bid: 98.8, ask: 98.85,
          open: 100.2, high: 100.6, low: 98.3, prevClose: 100.15, volume: 129700, changePct: -1.35,
          timestamp: freshTs,
        },
      ],
    });

    const result = await getEffectiveMarketQuotesWithOfficialCloseFallback({
      session,
      symbols: "2330,0050,2454",
      includeStale: true,
    });

    assert.equal(result.items.length, 3, "N symbols requested in → N items out, strictly");
    const symbols = result.items.map((item) => item.symbol).sort();
    assert.deepStrictEqual(symbols, ["0050", "2330", "2454"]);

    const zeroFiftyOccurrences = result.items.filter((item) => item.symbol === "0050");
    assert.equal(zeroFiftyOccurrences.length, 1, "0050 must not appear twice");
    assert.equal(zeroFiftyOccurrences[0]?.selectedSource, "twse_mis", "the fresh MIS tick must win over the stale manual fallback");
    assert.equal(zeroFiftyOccurrences[0]?.freshnessStatus, "fresh");
    assert.equal(result.summary.total, 3, "summary must be recomputed after dedupe, not stale from the pre-dedupe 4-item array");
  } finally {
    resetMarketDataWorkspaceState(slug);
  }
});
