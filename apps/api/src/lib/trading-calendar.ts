/**
 * trading-calendar.ts — shared Taiwan Stock Exchange trading-day check.
 *
 * Extracted 2026-07-14 from openalice-pipeline.ts so both openalice-pipeline.ts
 * AND data-sources/twse-openapi-client.ts can call the SAME calendar check
 * without a circular import (twse-openapi-client.ts is itself imported BY
 * openalice-pipeline.ts, so the reverse import would have created a cycle).
 * Kept in this leaf `lib/` module — same pattern as lib/roc-date.ts — so
 * there is exactly one implementation, not a second independent copy (same
 * duplicate-implementation bug class the ROC date parser sweep fixed).
 */

import { sql as drizzleSql } from "drizzle-orm";
import { getDb, isDatabaseMode } from "@iuf-trading-room/db";

// 2026-07-17 P0 fix: a given date's trading-day status never changes once
// queried, but this function was called with zero caching from at least 3
// hot paths that all fan out from it (heatmap/twse + heatmap/kgi-core via
// getStockDayAllRows()'s self-heal branch; heatmap/kgi-core additionally via
// _isKgiHeatmapAfterHours() on literally every request; companies/:id/
// quote/realtime via the same _twseEodFallback -> getStockDayAllRows chain).
// Caching per-date removes the redundant repeat-query pressure on the DB
// pool entirely for a query whose answer can never change for a past/present
// date — complements the timeout guard below rather than replacing it (the
// very first query for a given date still needs the bound).
const _tradingDayCache = new Map<string, boolean>();

/**
 * Returns true if today is a Taiwan Stock Exchange trading day.
 * Uses tw_trading_calendar DB table if available (Athena spec dataset #9).
 * Falls back to weekend-only check when table is absent (DEGRADED mode).
 */
export async function isTwTradingDay(tradingDate: string): Promise<boolean> {
  const cached = _tradingDayCache.get(tradingDate);
  if (cached !== undefined) return cached;

  // Weekend fast-path (Taipei local DOW)
  const parts = tradingDate.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) {
    _tradingDayCache.set(tradingDate, false);
    return false;
  }

  // DB holiday check — table may not exist (DRAFT migration not yet promoted)
  if (!isDatabaseMode()) return true;
  const db = getDb();
  if (!db) return true;

  try {
    // 2026-07-17 P0 fix: this query had no bound at all. Called from
    // twse-openapi-client.ts's STOCK_DAY_ALL self-heal branch, which fires on
    // every cache-miss where the primary feed's date looks stale (the
    // recurring "TWSE OpenAPI publish stuck" condition already on record) —
    // exactly the state a fresh post-restart cache-miss lands in. If the DB
    // connection pool is under pressure, an unbounded query here can hang the
    // whole caller indefinitely (traced back to the /market/heatmap/twse and
    // /market/heatmap/kgi-core outage — see
    // reports/sprint_2026_07_17/MARKET_INTEL_OUTAGE_RCA_2026_07_17.md).
    // Race against a timeout so a stuck pool degrades to the same
    // already-existing fail-open path below instead of hanging the request.
    const rows = await Promise.race([
      db.execute(
        drizzleSql`SELECT is_trading_day FROM tw_trading_calendar WHERE date = ${tradingDate} LIMIT 1`
      ),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("isTwTradingDay query timed out")), 3_000);
      })
    ]);
    const row = (rows as { rows?: Array<{ is_trading_day?: boolean }> }).rows?.[0];
    if (row === undefined) {
      // Date not in table → assume trading day (conservative, better than skipping).
      // Cache it: a missing row for this date is itself a stable fact.
      _tradingDayCache.set(tradingDate, true);
      return true;
    }
    const result = row.is_trading_day !== false;
    _tradingDayCache.set(tradingDate, result);
    return result;
  } catch {
    // Table doesn't exist yet (migration not promoted), or the query timed
    // out under DB pressure → fall back to weekend check only. Deliberately
    // NOT cached — a timeout is a transient degraded read, not a confirmed
    // answer; the next call should retry against the DB rather than being
    // stuck on a possibly-wrong guess for the rest of the process lifetime.
    return true;
  }
}

// ── Taiwan market session — single source of truth (2026-07-24) ────────────
//
// reports/design_redesign_20260722/DUAL_CRITERIA_AUDIT_20260723.md 🔴 R2:
// server.ts's composeTaiwanMarketState() judged OPEN/CLOSED purely from the
// wall-clock minute-of-day, with NO day-of-week check at all — Sat/Sun
// 09:00-13:30 was reported as "OPEN", which then fed a fake
// `kgi_unavailable_eod_fallback` incident label downstream (the gateway is
// correctly closed on weekends; that's not an outage). The same audit found
// 4 more independent re-implementations of "is TW market in session right
// now" scattered across server.ts, some without a weekday check at all, some
// with a bare `getUTCDay()` 1-5 check (which still can't see holidays).
//
// This function is the one place that decides "is *today* a trading day" —
// every caller wanting a session/open-closed judgement should route through
// here (or through `isTaiwanTradingDayNow` below for callers that only need
// the day-level boolean and keep their own minute-of-day window, e.g. a MIS
// cron's deliberately-wider 08:55-14:35 serving window vs. the official
// 09:00-13:30 session — those are legitimately different questions, not
// duplicate bugs, so their minute boundaries are intentionally NOT collapsed
// into this function).
//
// Epoch-ms arithmetic (`nowMs + 8h`), never `Date.prototype.getTimezoneOffset()`:
// `data-sources/finmind-aggregate-client.ts:309-315`'s `todayTaipei()` has a
// known (queued, unfixed) double-offset bug where `getTimezoneOffset()` reads
// the *host process's* timezone — on a host whose own TZ is already
// Asia/Taipei, `offset + getTimezoneOffset()` cancels to 0 and the function
// silently returns the raw UTC date instead of the Taipei date. The fixed
// `+8h` epoch shift used here (same idiom as `_isKgiHeatmapAfterHours` /
// `getTaipeiHHMM` elsewhere in server.ts) is immune: it always adds exactly
// 8h to the UTC instant and reads UTC fields back, independent of host TZ.

export type TaiwanMarketSessionState = "PRE-OPEN" | "OPEN" | "MIDDAY" | "POST-CLOSE" | "CLOSED";

export interface TaiwanMarketSession {
  state: TaiwanMarketSessionState;
  isTradingDay: boolean;
  countdownSec: number;
}

/** Taipei calendar date (YYYY-MM-DD) for a given UTC epoch ms, via fixed +8h
 *  arithmetic — see double-offset note above. Exported so callers needing
 *  just the date string (to pass to `isTwTradingDay`) don't reinvent it. */
export function taipeiDateFromMs(nowMs: number): string {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Is *today* (Taipei calendar date, derived from `nowMs`) a TW trading day?
 *  Thin wrapper over `isTwTradingDay` for callers that only need the
 *  day-level boolean. `isTradingDayCheck` is overridable for deterministic
 *  tests (same optional-injection convention as `nowMs` params elsewhere in
 *  this repo, e.g. FA9 in finmind-aggregate-market.test.ts) — production
 *  callers should never pass it. */
export async function isTaiwanTradingDayNow(
  nowMs: number = Date.now(),
  isTradingDayCheck: (dateIso: string) => Promise<boolean> = isTwTradingDay
): Promise<boolean> {
  return isTradingDayCheck(taipeiDateFromMs(nowMs)).catch(() => true);
}

/**
 * Single source of truth for "what is the Taiwan market session right now",
 * weekday+holiday aware. Non-trading days (weekend today; holiday once
 * `tw_trading_calendar` is populated — see `isTwTradingDay`'s own DEGRADED
 * mode note, that data gap is pre-existing and out of scope here) resolve to
 * `CLOSED` regardless of the wall-clock minute — this is the R2 fix.
 * Boundary minutes (unchanged from the original composeTaiwanMarketState):
 * pre-open 08:30-09:00, open 09:00-13:30, midday 13:30-13:35, else post-close.
 */
export async function getTaiwanMarketSession(
  nowMs: number = Date.now(),
  isTradingDayCheck: (dateIso: string) => Promise<boolean> = isTwTradingDay
): Promise<TaiwanMarketSession> {
  const d = new Date(nowMs + 8 * 60 * 60 * 1000);
  const twMin = (d.getUTCHours() * 60 + d.getUTCMinutes()) % (24 * 60);
  const isTradingDay = await isTaiwanTradingDayNow(nowMs, isTradingDayCheck);

  const PREOPEN_START = 510; // 08:30
  const OPEN_START = 540;    // 09:00
  const MIDDAY_START = 810;  // 13:30
  const CLOSE_END = 815;     // 13:35

  let state: TaiwanMarketSessionState;
  let nextBoundary: number;

  if (!isTradingDay) {
    state = "CLOSED";
    // Same "assume tomorrow" simplification the original code already had
    // for POST-CLOSE (doesn't look ahead across multi-day weekends/holiday
    // runs) — not this fix's scope, no live consumer of countdownSec exists
    // today (verified: no apps/web caller reads composeTaiwanMarketState's
    // countdownSec field).
    nextBoundary = twMin < PREOPEN_START ? PREOPEN_START : PREOPEN_START + 24 * 60;
  } else if (twMin >= PREOPEN_START && twMin < OPEN_START) {
    state = "PRE-OPEN";
    nextBoundary = OPEN_START;
  } else if (twMin >= OPEN_START && twMin < MIDDAY_START) {
    state = "OPEN";
    nextBoundary = MIDDAY_START;
  } else if (twMin >= MIDDAY_START && twMin < CLOSE_END) {
    state = "MIDDAY";
    nextBoundary = CLOSE_END;
  } else {
    state = "POST-CLOSE";
    nextBoundary = twMin < PREOPEN_START ? PREOPEN_START : PREOPEN_START + 24 * 60;
  }

  const countdownSec = Math.max(0, (nextBoundary - twMin) * 60 - d.getUTCSeconds());
  return { state, isTradingDay, countdownSec };
}
