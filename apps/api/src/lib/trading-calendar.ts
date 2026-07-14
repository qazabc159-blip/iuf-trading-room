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

/**
 * Returns true if today is a Taiwan Stock Exchange trading day.
 * Uses tw_trading_calendar DB table if available (Athena spec dataset #9).
 * Falls back to weekend-only check when table is absent (DEGRADED mode).
 */
export async function isTwTradingDay(tradingDate: string): Promise<boolean> {
  // Weekend fast-path (Taipei local DOW)
  const parts = tradingDate.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!));
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;

  // DB holiday check — table may not exist (DRAFT migration not yet promoted)
  if (!isDatabaseMode()) return true;
  const db = getDb();
  if (!db) return true;

  try {
    const rows = await db.execute(
      drizzleSql`SELECT is_trading_day FROM tw_trading_calendar WHERE date = ${tradingDate} LIMIT 1`
    );
    const row = (rows as { rows?: Array<{ is_trading_day?: boolean }> }).rows?.[0];
    if (row === undefined) {
      // Date not in table → assume trading day (conservative, better than skipping)
      return true;
    }
    return row.is_trading_day !== false;
  } catch {
    // Table doesn't exist yet (migration not promoted) → fall back to weekend check only
    return true;
  }
}
