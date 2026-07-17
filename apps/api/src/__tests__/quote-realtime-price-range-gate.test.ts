/**
 * quote-realtime-price-range-gate.test.ts — 2026-07-18
 *
 * Pete review Round 1 NEEDS_FIX on PR #1300: `verifyPriceWithinDailyRange()`
 * was defined + unit-tested in market-data-integrity-gate.test.ts, but that
 * only proved the helper itself works in isolation — it had ZERO production
 * call sites, so the PR's claim that "this invariant is CI-enforced going
 * forward" was false ("wired in definition, dead at call site"). This file
 * tests the ACTUAL production gate, `_gatePriceRangeInvariant()` — the
 * function every `/companies/:id/quote/realtime` response candidate is
 * piped through immediately before `c.json()` (7 call sites in server.ts,
 * asserted by source-grep below so the wiring itself can't silently regress).
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/quote-realtime-price-range-gate.test.ts
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { _gatePriceRangeInvariant } from "../server.js";

const serverSource = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

// ── Wiring proof: the gate is actually called at every response-building
// site in the real route, not just defined and left unused. ──

test("WIRING: _gatePriceRangeInvariant() is called at every /companies/:id/quote/realtime response site (not just defined)", () => {
  const callSiteCount = (serverSource.match(/_gatePriceRangeInvariant\(symbol,/g) ?? []).length;
  assert.ok(
    callSiteCount >= 7,
    `expected _gatePriceRangeInvariant to be wired into every quote/realtime response builder (>= 7 call sites: whitelist-check mis/fb, subscribe-failed mis/fb, tick-blocked mis/fb, live-tick-success), found ${callSiteCount}`
  );
  // Guard against the exact class of regression this test exists to prevent:
  // a future refactor that re-inlines `data: { ... }` at any of these sites
  // without routing it through the gate first.
  assert.doesNotMatch(
    serverSource,
    /return c\.json\(\{\s*data: \{\s*symbol,\s*lastPrice: mis\.lastPrice/,
    "an MIS-intraday response must never be built as a bare object literal again — it must go through _gatePriceRangeInvariant()"
  );
});

// ── Functional proof: feeding the ACTUAL production gate function a
// price>high tile (the exact 2330 P0 shape) really degrades it to NO_DATA —
// not just the isolated helper. ──

test("PRODUCTION PATH: a price>high candidate (2330 P0 shape) is degraded to NO_DATA by the real gate function used at every /quote/realtime response site", () => {
  // Exact shape one of the EOD-fallback response builders constructs at its
  // `c.json()` call site, with the impossible 2330 P0 numbers (最新價 2,470.0
  // > 當日最高 2,395.0) that should have been caught by the invariant.
  const candidate = {
    symbol: "2330",
    lastPrice: 2470.0,
    open: 2450.0,
    high: 2395.0,
    low: 2290.0,
    prevClose: 2420.0,
    changePct: 2.07,
    bid: null,
    ask: null,
    volume: 12345,
    freshness: "stale" as const,
    state: "STALE" as const,
    source: "twse_openapi_eod" as const,
    marketSession: "POST-CLOSE" as const,
    referenceReason: "closed_reference" as const,
    note: "twse_eod date=1150716",
    dataDate: "2026-07-16",
    updatedAt: new Date().toISOString(),
  };

  const gated = _gatePriceRangeInvariant("2330", candidate);

  assert.equal(gated.lastPrice, null, "最新價 must be nulled out — never ship the impossible number");
  assert.equal(gated.state, "NO_DATA", "state must degrade to NO_DATA, not silently keep STALE with a bad price");
  assert.match(String(gated.note), /price_range_invariant_violated/, "note must record why this was gated, for observability");
  // Never a crash / 500 — the function returns a plain degraded object, no throw.
  assert.equal(typeof gated, "object");
});

test("PRODUCTION PATH: the symmetric 3661 P0 shape is also gated (price below low is caught too, not just above high)", () => {
  const candidate = {
    symbol: "3661",
    lastPrice: 3770.0,
    open: 3700.0,
    high: 3655.0,
    low: 3480.0,
    prevClose: 3690.0,
    changePct: 2.17,
    bid: null,
    ask: null,
    volume: 5000,
    freshness: "stale" as const,
    state: "STALE" as const,
    source: "tpex_openapi_eod" as const,
    marketSession: "POST-CLOSE" as const,
    referenceReason: "closed_reference" as const,
    note: "tpex_eod date=1150716",
    dataDate: "2026-07-16",
    updatedAt: new Date().toISOString(),
  };

  const gated = _gatePriceRangeInvariant("3661", candidate);
  assert.equal(gated.lastPrice, null);
  assert.equal(gated.state, "NO_DATA");
});

test("PRODUCTION PATH: a valid candidate (price within [low, high]) passes through the gate completely unchanged", () => {
  const candidate = {
    symbol: "2330",
    lastPrice: 2290.0,
    open: 2470.0,
    high: 2395.0,
    low: 2290.0,
    prevClose: 2470.0,
    changePct: -7.29,
    bid: null,
    ask: null,
    volume: 12345,
    freshness: "stale" as const,
    state: "STALE" as const,
    source: "companies_ohlcv_eod" as const,
    marketSession: "POST-CLOSE" as const,
    referenceReason: "closed_reference" as const,
    note: "persisted_ohlcv_supersedes_live_eod date=2026-07-17 (live_eod_date=2026-07-16)",
    dataDate: "2026-07-17",
    updatedAt: new Date().toISOString(),
  };

  const gated = _gatePriceRangeInvariant("2330", candidate);
  assert.deepEqual(gated, candidate, "a valid candidate must pass through byte-identical — the gate must not touch good data");
});

test("PRODUCTION PATH: a candidate with no high/low at all (the live KGI tick success shape) passes through unchanged — nothing to gate", () => {
  const candidate = {
    symbol: "2330",
    lastPrice: 1052.0,
    bid: 1051.0,
    ask: 1052.0,
    volume: 100,
    freshness: "fresh" as const,
    state: "LIVE" as const,
    source: "kgi-gateway" as const,
    marketSession: "OPEN" as const,
    updatedAt: new Date().toISOString(),
  };

  const gated = _gatePriceRangeInvariant("2330", candidate);
  assert.deepEqual(gated, candidate);
});
