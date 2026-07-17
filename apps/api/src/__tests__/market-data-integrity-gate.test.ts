/**
 * market-data-integrity-gate.test.ts — 2026-07-17（楊董升級：治本閘門）
 *
 * Invariant tests for the CLASS of bug (not a single symbol) that produced
 * the string of 2026-07-17 heatmap incidents: #1294 endpoint wedge, #1295
 * comma-truncation, #1297 no_data gating (3707), 2395 fake-0% residual, and
 * the banner/tile date mismatch. Each test below asserts one structural
 * invariant that must hold for ANY symbol/day, not a one-off patch.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/market-data-integrity-gate.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyQuoteTuple,
  isPriceMagnitudePlausible,
  crossValidateWithIndependentSource,
  needsIndependentCrossCheck,
  resolveAuthoritativeTradeDate,
} from "../market-data-integrity-gate.js";

// ── Invariant #1: a price without an internally-consistent % move is never "verified" ──

test("INVARIANT: a tile with a price but null change/changePct is never verified (the class of bug behind 3707/2395)", () => {
  const noChangePct = verifyQuoteTuple({ source: "twse_eod", tradeDate: "2026-07-17", close: 68.7, change: null, changePct: null });
  assert.equal(noChangePct.verified, false);
  if (!noChangePct.verified) assert.equal(noChangePct.reason, "missing_change_or_pct");
});

test("INVARIANT: a fully-populated, arithmetically-consistent tuple is verified", () => {
  // 2330 crash-day repro: close=2290, prevClose=2470, change=-180, changePct≈-7.29%
  const result = verifyQuoteTuple({ source: "twse_eod", tradeDate: "2026-07-17", close: 2290, change: -180, changePct: -7.29 });
  assert.equal(result.verified, true);
  if (result.verified) {
    assert.equal(result.close, 2290);
    assert.equal(result.changePct, -7.29);
  }
});

test("INVARIANT: a tuple whose change/changePct don't arithmetically agree is rejected (not a real place to trust either number)", () => {
  // close=513, change=0 (implies prevClose=513, changePct should be 0) but
  // changePct is claimed as -1.16% — internally self-contradictory.
  const result = verifyQuoteTuple({ source: "twse_eod", tradeDate: "2026-07-17", close: 513, change: 0, changePct: -1.16 });
  assert.equal(result.verified, false);
  if (!result.verified) assert.equal(result.reason, "changePct_arithmetic_mismatch");
});

test("INVARIANT: missing trade date is never verified, regardless of how clean the numbers look", () => {
  const result = verifyQuoteTuple({ source: "twse_eod", tradeDate: null, close: 100, change: 1, changePct: 1.0 });
  assert.equal(result.verified, false);
  if (!result.verified) assert.equal(result.reason, "missing_trade_date");
});

// ── Invariant #2: real ±10% crash-day moves are NOT misfired as invalid ──

test("INVARIANT: a real -9.97% crash-day move (within the ±10.5% daily limit band) is verified, not rejected (#1295 threshold preserved)", () => {
  // 3711 (日月光投控) 07/17 prod repro: close=614, prevClose=682, change=-68
  const result = verifyQuoteTuple({ source: "twse_eod", tradeDate: "2026-07-17", close: 614, change: -68, changePct: -9.97 });
  assert.equal(result.verified, true);
});

test("INVARIANT: a move exceeding the daily ±10.5% limit band is rejected — impossible for a TW equity in one session", () => {
  const result = verifyQuoteTuple({ source: "twse_eod", tradeDate: "2026-07-17", close: 2, change: -180, changePct: -98.9 });
  assert.equal(result.verified, false);
  if (!result.verified) assert.equal(result.reason, "changePct_exceeds_daily_limit");
});

// ── Invariant #3: no known large-cap shows a single-digit price (magnitude anomaly) ──

test("INVARIANT: no known large-cap shows a single-digit price — comma-truncation-class bug caught by magnitude alone (#1295 class)", () => {
  // 2330 real reference price ~2470; a corrupted close of "2" is >1000x off.
  assert.equal(isPriceMagnitudePlausible(2, 2470), false);
});

test("INVARIANT: a real ±10% daily move never trips the magnitude guard (no false positives on legitimate crash-day prices)", () => {
  assert.equal(isPriceMagnitudePlausible(2290, 2470), true); // 2330, -7.29%
  assert.equal(isPriceMagnitudePlausible(614, 682), true); // 3711, -9.97%
});

test("INVARIANT: with no trusted reference price, the magnitude guard cannot disprove — accepts (not a false accusation)", () => {
  assert.equal(isPriceMagnitudePlausible(2, null), true);
  assert.equal(isPriceMagnitudePlausible(2, undefined), true);
});

// ── Invariant #4 (2395 lesson): ambiguous exact-zero values are fail-CLOSED, never same-source self-confirmed ──

test("needsIndependentCrossCheck: only an exact-zero changePct needs cross-validation (kept narrow, not every value)", () => {
  assert.equal(needsIndependentCrossCheck(0), true);
  assert.equal(needsIndependentCrossCheck(-1.16), false);
  assert.equal(needsIndependentCrossCheck(null), false);
});

test("INVARIANT: an exact-zero claim with NO independent confirmation is never trustworthy — fail CLOSED (2395 Round 2 fix)", () => {
  const result = crossValidateWithIndependentSource(513, undefined);
  assert.equal(result.trustworthy, false);
  assert.equal(result.reason, "independent_source_unavailable");
});

test("INVARIANT: an exact-zero claim CONTRADICTED by independent MIS previousClose is rejected (513 vs true 519, exact 2395 prod repro)", () => {
  const result = crossValidateWithIndependentSource(513, 519);
  assert.equal(result.trustworthy, false);
  assert.equal(result.reason, "independent_source_mismatch");
});

test("INVARIANT: an exact-zero claim CONFIRMED by independent MIS previousClose is trustworthy (genuine flat day)", () => {
  const result = crossValidateWithIndependentSource(56.4, 56.4);
  assert.equal(result.trustworthy, true);
  assert.equal(result.reason, null);
});

// ── Invariant #5: single authoritative trade date (banner/index/tile can never disagree) ──

test("INVARIANT: banner date == index date == tile date — resolveAuthoritativeTradeDate picks the single newest known-valid date (07/16 vs 07/17 prod repro)", () => {
  const result = resolveAuthoritativeTradeDate([
    { source: "twse_overview_mi_index", tradeDate: "2026-07-16T08:00:00.000Z" }, // stale banner source
    { source: "market_data_overview_index", tradeDate: "2026-07-17T05:30:00.000Z" }, // fresher, same data as tiles
  ]);
  assert.equal(result.tradeDate, "2026-07-17T05:30:00.000Z");
  assert.equal(result.chosenSource, "market_data_overview_index");
});

test("INVARIANT: a source with no date is never chosen over one that has a valid date", () => {
  const result = resolveAuthoritativeTradeDate([
    { source: "a", tradeDate: null },
    { source: "b", tradeDate: "2026-07-17" },
  ]);
  assert.equal(result.tradeDate, "2026-07-17");
  assert.equal(result.chosenSource, "b");
});

test("INVARIANT: all sources missing a date resolves to null — never guesses from the wall clock (P0-5 lineage)", () => {
  const result = resolveAuthoritativeTradeDate([
    { source: "a", tradeDate: null },
    { source: "b", tradeDate: undefined as unknown as null },
  ]);
  assert.equal(result.tradeDate, null);
  assert.equal(result.chosenSource, null);
});
