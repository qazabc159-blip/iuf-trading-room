/**
 * quote-realtime-persisted-supersede.test.ts — 2026-07-18
 *
 * Invariant tests for `mergeEodFallbackWithPersistedBars()` — the fix for the
 * company page P0 Elva's prod verify caught: 2330's 公司頁 showed 最新價
 * 2,470.0 while 當日最高 showed 2,395.0 (impossible — price > high) and the
 * displayed -7.29% only made sense against the true close of 2,290 (backed
 * out as 2,470 - 180 = 2,290, which also matches the desk page's 最新收盤).
 * 3661 had the identical bug (最新價 3,770.0 > 最高 3,655.0, true close 3,480).
 *
 * Root cause: the live TWSE/TPEX EOD fetch behind `/companies/:id/quote/realtime`
 * can legitimately lag one trading session behind (same publish-lag disease
 * as PR #1299's index headline regression), while `companies_ohlcv` (fed by
 * the separate EOD ingestion cron, and what `/companies/:id/ohlcv` + the
 * company hero bar's 最高/最低 already read from) had already landed the
 * newer day — mixing a stale 最新價 with an already-advanced 漲跌幅/最高/最低.
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/quote-realtime-persisted-supersede.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeEodFallbackWithPersistedBars,
  type EodFallbackResult,
  type PersistedOhlcvBar,
} from "../server.js";
import { verifyPriceWithinDailyRange } from "../market-data-integrity-gate.js";

function makeLive(overrides: Partial<EodFallbackResult> = {}): EodFallbackResult {
  return {
    lastPrice: null,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    changePct: null,
    volume: null,
    source: "twse_openapi_eod",
    state: "NO_DATA",
    freshness: "not-available",
    note: "not_in_twse_or_tpex_eod",
    dataDate: null,
    marketSession: "POST-CLOSE",
    referenceReason: "closed_reference",
    ...overrides,
  };
}

// ── Exact 2330 prod repro: live EOD is one session behind, persisted OHLCV
// already has the newer day. ──

test("2330 prod repro: a live EOD fetch stuck on 07/16 (close=2,470) is superseded by the persisted 07/17 bar (close=2,290, high=2,395, low=2,290)", () => {
  const live = makeLive({
    lastPrice: 2470,
    open: 2450,
    high: 2480,
    low: 2440,
    prevClose: 2420,
    changePct: 2.07,
    source: "twse_openapi_eod",
    state: "STALE",
    freshness: "stale",
    note: "twse_eod date=1150716",
    dataDate: "2026-07-16",
  });
  const persisted: PersistedOhlcvBar[] = [
    { dt: "2026-07-17", open: 2470, high: 2395, low: 2290, close: 2290, volume: 12345 },
    { dt: "2026-07-16", open: 2450, high: 2480, low: 2440, close: 2470, volume: 9876 },
  ];

  const merged = mergeEodFallbackWithPersistedBars(live, persisted);

  assert.equal(merged.dataDate, "2026-07-17", "date must advance to the persisted bar's newer trading day");
  assert.equal(merged.lastPrice, 2290, "最新價 must be the true 07/17 close, not the stale 07/16 close");
  assert.equal(merged.high, 2395);
  assert.equal(merged.low, 2290);
  assert.equal(merged.source, "companies_ohlcv_eod");
  // changePct must be derived from the SAME date's prevClose (07/16 close=2470), matching the
  // prod repro's own -7.29% (2290-2470)/2470*100.
  assert.ok(merged.changePct !== null && Math.abs(merged.changePct - -7.29) < 0.01, `changePct must be ~-7.29, got ${merged.changePct}`);

  // The two invariants the P0 report demanded: price self-consistent with its own day's range,
  // and close/changePct/high/low all drawn from the SAME date (dataDate == "2026-07-17" for all).
  const rangeCheck = verifyPriceWithinDailyRange(merged.lastPrice, merged.high, merged.low);
  assert.equal(rangeCheck.valid, true, "merged 最新價 must be within [最低, 最高] — the exact invariant the P0 violated");
});

test("3661 prod repro: same bug class, different numbers — persisted bar must win", () => {
  const live = makeLive({
    lastPrice: 3770,
    dataDate: "2026-07-16",
    state: "STALE",
    freshness: "stale",
  });
  const persisted: PersistedOhlcvBar[] = [
    { dt: "2026-07-17", open: 3770, high: 3655, low: 3480, close: 3480, volume: 5000 },
    { dt: "2026-07-16", open: 3700, high: 3800, low: 3690, close: 3770, volume: 4000 },
  ];

  const merged = mergeEodFallbackWithPersistedBars(live, persisted);

  assert.equal(merged.dataDate, "2026-07-17");
  assert.equal(merged.lastPrice, 3480);
  assert.equal(merged.high, 3655);
  assert.equal(merged.low, 3480);
  const rangeCheck = verifyPriceWithinDailyRange(merged.lastPrice, merged.high, merged.low);
  assert.equal(rangeCheck.valid, true);
});

// ── Guard-rail cases: the fix must never override when it shouldn't ──

test("same-day tie: live and persisted agree on the trading date — live is kept (it may carry finer same-day detail)", () => {
  const live = makeLive({
    lastPrice: 2290,
    high: 2395,
    low: 2290,
    dataDate: "2026-07-17",
    state: "STALE",
  });
  const persisted: PersistedOhlcvBar[] = [
    { dt: "2026-07-17", open: 2470, high: 2395, low: 2290, close: 2290, volume: 12345 },
  ];

  const merged = mergeEodFallbackWithPersistedBars(live, persisted);
  assert.equal(merged, live, "same-day tie must return the original live result unchanged, never override");
});

test("persisted bar older than live: live is kept — a persisted bar must never regress a fresher live result", () => {
  const live = makeLive({
    lastPrice: 2290,
    high: 2395,
    low: 2290,
    dataDate: "2026-07-17",
    state: "STALE",
  });
  const persisted: PersistedOhlcvBar[] = [
    { dt: "2026-07-16", open: 2450, high: 2480, low: 2440, close: 2470, volume: 9876 },
  ];

  const merged = mergeEodFallbackWithPersistedBars(live, persisted);
  assert.equal(merged, live);
});

test("no persisted bars available: live is returned unchanged (best-effort cross-check, never a hard dependency)", () => {
  const live = makeLive({ lastPrice: 2290, dataDate: "2026-07-17" });
  const merged = mergeEodFallbackWithPersistedBars(live, []);
  assert.equal(merged, live);
});

test("live has no data at all (dataDate null) but a persisted bar exists: persisted bar fills the gap rather than leaving NO_DATA", () => {
  const live = makeLive({ dataDate: null, state: "NO_DATA", lastPrice: null });
  const persisted: PersistedOhlcvBar[] = [
    { dt: "2026-07-17", open: 2470, high: 2395, low: 2290, close: 2290, volume: 12345 },
  ];
  const merged = mergeEodFallbackWithPersistedBars(live, persisted);
  assert.equal(merged.lastPrice, 2290);
  assert.equal(merged.dataDate, "2026-07-17");
  assert.equal(merged.state, "STALE");
});

test("changePct falls back to live.prevClose when only a single persisted bar is available (no prior row to diff against)", () => {
  const live = makeLive({ dataDate: "2026-07-16", prevClose: 2420 });
  const persisted: PersistedOhlcvBar[] = [
    { dt: "2026-07-17", open: 2470, high: 2395, low: 2290, close: 2290, volume: 12345 },
  ];
  const merged = mergeEodFallbackWithPersistedBars(live, persisted);
  assert.equal(merged.prevClose, 2420);
  assert.ok(merged.changePct !== null && Math.abs(merged.changePct - ((2290 - 2420) / 2420) * 100) < 0.01);
});
