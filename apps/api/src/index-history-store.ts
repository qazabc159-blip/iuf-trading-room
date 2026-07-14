/**
 * index-history-store.ts
 *
 * Persistence layer for daily-close index history (currently TAIEX "^TWII"
 * only). Mirrors quote-last-close-store.ts's pattern for the same class of
 * problem: a deploy restart wipes any in-memory cache, and the live upstream
 * fetch that follows can transiently fail (rate limit / network hiccup —
 * more likely right after a fresh restart). This module gives that fetch
 * function a DB-backed fallback tier so a bad-timing failure no longer
 * produces an empty result for callers (2026-07-14: 12 deploys in one day
 * left the homepage TAIEX line chart empty for stretches of that day).
 *
 * Write path: data-sources/twse-openapi-client.ts fetchTaiexMonthDailyCloses()
 *             after each successful live TWSE MI_5MINS_HIST fetch.
 * Read path:  same function, called only when the live fetch for a given
 *             month fails or returns no rows.
 *
 * Callers must fail-open around these functions — DB errors must not break
 * the index-history fetch path (same contract as quote-last-close-store.ts).
 */

import { sql as drizzleSql } from "drizzle-orm";
import { type DatabaseClient, indexHistory, execRows } from "@iuf-trading-room/db";

export interface IndexHistoryRow {
  date: string; // "YYYY-MM-DD"
  close: number;
}

export interface IndexHistoryEntry extends IndexHistoryRow {
  indexSymbol: string;
  source: string;
}

/**
 * Upsert daily-close rows for one index symbol.
 * Idempotent: ON CONFLICT (index_symbol, trade_date) DO UPDATE.
 * Throws on DB error — callers must wrap in try/catch for fail-open behaviour.
 */
export async function upsertIndexHistoryRows(
  db: DatabaseClient,
  entries: IndexHistoryEntry[]
): Promise<void> {
  if (!entries.length) return;
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    await db
      .insert(indexHistory)
      .values(
        chunk.map((e) => ({
          indexSymbol: e.indexSymbol,
          tradeDate:   e.date,
          close:       String(e.close),
          source:      e.source,
          updatedAt:   new Date(),
        }))
      )
      .onConflictDoUpdate({
        target: [indexHistory.indexSymbol, indexHistory.tradeDate],
        set: {
          close:     drizzleSql`excluded.close`,
          source:    drizzleSql`excluded.source`,
          updatedAt: drizzleSql`NOW()`,
        },
      });
  }
}

/**
 * Read persisted daily-close rows for one index symbol in [fromDate, toDate]
 * (ISO, inclusive). Returns rows sorted ascending by date (matches the shape
 * callers already expect from a live TWSE fetch). Throws on DB error —
 * callers must wrap in try/catch for fail-open behaviour.
 */
export async function getIndexHistoryRows(
  db: DatabaseClient,
  indexSymbol: string,
  fromDate: string,
  toDate: string
): Promise<IndexHistoryRow[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return [];
  const res = await db.execute(
    drizzleSql`SELECT trade_date::text AS trade_date, close::float8 AS close
       FROM index_history
       WHERE index_symbol = ${indexSymbol}
         AND trade_date >= ${fromDate}
         AND trade_date <= ${toDate}
       ORDER BY trade_date ASC`
  );
  const rows = execRows<{ trade_date: string; close: number }>(res);
  return rows
    .map((row) => ({ date: row.trade_date, close: Number(row.close) }))
    .filter((row) => Number.isFinite(row.close) && row.close > 0);
}

// ── Test exports ─────────────────────────────────────────────────────────────
// Prefixed with _ and suffixed with ForTest per house style.
export const _TABLE_NAME_FOR_TEST = "index_history" as const;
