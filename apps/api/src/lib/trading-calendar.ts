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
