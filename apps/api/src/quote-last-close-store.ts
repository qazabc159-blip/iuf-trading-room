/**
 * quote-last-close-store.ts
 *
 * Persistence layer for last-good EOD closing prices.
 *
 * Problem solved: after a deploy restart (or 盤後 when TWSE/TPEX/MIS stop serving),
 * buildS1PositionsSnapshot() has no live price for F-AUTO holdings — market value
 * appears null/blank. This module provides a DB-backed fallback tier so that
 * restart / 盤後 no longer causes blank valuations.
 *
 * Write path:
 *   - buildS1PositionsSnapshot() after TWSE+TPEX official mark-to-market
 *   - buildS1PositionsSnapshot() after MIS post-session close (YELLOW-2 path)
 *   - server.ts _runTwseEodCron() for the full TWSE universe (~1400 stocks)
 *
 * Read path:
 *   - getLastCloses() — called as last fallback in buildS1PositionsSnapshot()
 *     after TWSE/TPEX/MIS live fetches all miss.
 *
 * Source semantics (enforced by DB CHECK constraint):
 *   'twse_eod'  — TWSE STOCK_DAY_ALL official EOD close
 *   'tpex_eod'  — TPEX mainboard official EOD close
 *   'mis_close' — TWSE MIS post-session close (date-validated via 'd' field)
 *
 * Callers must fail-open around these functions — DB errors must not break
 * the mark-to-market path. See usage in s1-sim-runner.ts step 1b/1c/1d.
 */

import { sql as drizzleSql } from "drizzle-orm";
import { type DatabaseClient, quoteLastClose, execRows } from "@iuf-trading-room/db";

export type LastCloseSource = "twse_eod" | "tpex_eod" | "mis_close";

export interface LastCloseEntry {
  symbol: string;
  closePrice: number;
  tradeDate: string; // "YYYY-MM-DD"
  source: LastCloseSource;
}

export interface LastCloseResult {
  closePrice: number;
  tradeDate: string; // "YYYY-MM-DD"
  source: string;
}

/**
 * Upsert last-good closing prices for a batch of symbols.
 * Idempotent: ON CONFLICT (symbol, trade_date) DO UPDATE.
 * Batches in chunks of 500 to stay well under postgres parameter limits.
 * Throws on DB error — callers must wrap in try/catch for fail-open behaviour.
 */
export async function upsertLastCloses(
  db: DatabaseClient,
  entries: LastCloseEntry[]
): Promise<void> {
  if (!entries.length) return;
  const CHUNK = 500;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    await db
      .insert(quoteLastClose)
      .values(
        chunk.map((e) => ({
          symbol:     e.symbol,
          closePrice: String(e.closePrice),
          tradeDate:  e.tradeDate,
          source:     e.source,
          updatedAt:  new Date(),
        }))
      )
      .onConflictDoUpdate({
        target: [quoteLastClose.symbol, quoteLastClose.tradeDate],
        set: {
          closePrice: drizzleSql`excluded.close_price`,
          source:     drizzleSql`excluded.source`,
          updatedAt:  drizzleSql`NOW()`,
        },
      });
  }
}

/**
 * Read last-good closing prices for a list of symbols.
 * Returns Map<symbol, LastCloseResult> — only symbols found in DB are included.
 * For each symbol, returns the most-recent trade_date row (DISTINCT ON).
 * Throws on DB error — callers must wrap in try/catch for fail-open behaviour.
 */
export async function getLastCloses(
  db: DatabaseClient,
  symbols: string[]
): Promise<Map<string, LastCloseResult>> {
  if (!symbols.length) return new Map();
  // Use raw SQL for DISTINCT ON — Drizzle query builder does not support it.
  // Parameter binding: embed symbols as a SQL literal array rather than using
  // drizzleSql interpolation of a JS array, because postgres.js requires the
  // array to be cast explicitly and driver behaviour varies across envs.
  const escaped = symbols
    .map((s) => `'${s.replace(/'/g, "''")}'`)
    .join(",");
  const res = await db.execute(
    drizzleSql.raw(
      `SELECT DISTINCT ON (symbol) symbol, close_price::float8 AS close_price, trade_date::text AS trade_date, source
       FROM quote_last_close
       WHERE symbol IN (${escaped})
       ORDER BY symbol, trade_date DESC`
    )
  );
  const rows = execRows<{
    symbol: string;
    close_price: number;
    trade_date: string;
    source: string;
  }>(res);
  const map = new Map<string, LastCloseResult>();
  for (const row of rows) {
    const close = Number(row.close_price);
    if (isFinite(close) && close > 0) {
      map.set(row.symbol, {
        closePrice: close,
        tradeDate:  row.trade_date,
        source:     row.source,
      });
    }
  }
  return map;
}

// ── Test exports ─────────────────────────────────────────────────────────────
// Prefixed with _ and suffixed with ForTest per house style.
export const _TABLE_NAME_FOR_TEST = "quote_last_close" as const;
export const _SOURCES_FOR_TEST    = ["twse_eod", "tpex_eod", "mis_close"] as const;
