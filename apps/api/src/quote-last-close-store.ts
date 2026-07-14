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
 *   'twse_eod'       — TWSE STOCK_DAY_ALL official EOD close
 *   'tpex_eod'       — TPEX mainboard official EOD close
 *   'mis_close'      — TWSE MIS post-session close (date-validated via 'd' field)
 *   'ohlcv_fallback' — companies_ohlcv vendor OHLCV (2026-07-14, migration 0056)
 *                      last-resort tier for symbols absent from ALL of the
 *                      above (e.g. disposition/restricted-trading stocks
 *                      excluded from TWSE's standard daily-quote reports).
 *                      See getLatestOhlcvCloseForTickers() below.
 *
 * Callers must fail-open around these functions — DB errors must not break
 * the mark-to-market path. See usage in s1-sim-runner.ts step 1b/1c/1d/1e.
 */

import { sql as drizzleSql } from "drizzle-orm";
import { type DatabaseClient, quoteLastClose, execRows } from "@iuf-trading-room/db";

export type LastCloseSource = "twse_eod" | "tpex_eod" | "mis_close" | "ohlcv_fallback";

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

export interface OhlcvFallbackEntry {
  closePrice: number;
  /** The OHLCV bar's own date ("YYYY-MM-DD") — NEVER relabeled as the
   * caller's `asOfDateIso`. Callers must surface this real data date
   * (same honesty convention as getLastCloses's persisted_close_fallback
   * note), not pretend it is today's close. */
  dt: string;
  /** The underlying companies_ohlcv.source value (e.g. "tej" — currently
   * FinMind TaiwanStockPriceAdj, see jobs/ohlcv-finmind-sync.ts; the label
   * predates that provider switch and was kept as-is, out of scope here). */
  source: string;
}

/**
 * Last-resort mark-to-market fallback (2026-07-14, migration 0056): reads
 * companies_ohlcv for symbols that have NO coverage anywhere in
 * quote_last_close AND no same-day official/MIS price either — i.e. every
 * other tier (TWSE/TPEX official EOD, MIS post-session snapshot, prior
 * persisted-close in this table) has missed.
 *
 * Root cause this addresses: some symbols (verified 2026-07-14 for '2071' /
 * 震南鐵) are genuinely absent from TWSE's own STOCK_DAY_ALL and www rwd
 * afterTrading daily-quote reports — confirmed via direct curl against both
 * live official endpoints, not a parser/filter bug in our persist pipeline.
 * Likely explanation: a disposition/restricted-trading category excluded
 * from the standard board-lot daily report. companies_ohlcv (vendor OHLCV)
 * still has a genuine, actively-updating price history for such symbols.
 *
 * PIT-correct: only bars with dt <= asOfDateIso are considered (never a
 * future-dated bar) — the `<=` bound, not `=`, because the vendor sync may
 * lag behind `asOfDateIso` by a day or more; callers get the OHLCV series'
 * own most-recent bar, honestly dated, same "last known good" semantics as
 * getLastCloses().
 *
 * Throws on DB error — callers must wrap in try/catch for fail-open
 * behaviour, same contract as getLastCloses().
 *
 * Known limitation (not fixed here, matches getLastCloses()'s own existing
 * behaviour): `companies.ticker` is only unique per-workspace, but this
 * query has no workspace filter — in a genuinely multi-workspace deployment
 * with the same ticker in two workspaces, an arbitrary one's OHLCV row could
 * be picked. This mirrors quote_last_close's own pre-existing workspace-less
 * design (the whole table has no workspace column), so this is not a new
 * risk introduced here.
 */
export async function getLatestOhlcvCloseForTickers(
  db: DatabaseClient,
  tickers: string[],
  asOfDateIso: string
): Promise<Map<string, OhlcvFallbackEntry>> {
  if (!tickers.length || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDateIso)) return new Map();
  const escaped = tickers
    .map((t) => `'${t.replace(/'/g, "''")}'`)
    .join(",");
  const res = await db.execute(
    drizzleSql.raw(
      `SELECT DISTINCT ON (c.ticker) c.ticker AS ticker, o.dt::text AS dt,
              o.close::float8 AS close_price, o.source AS source
       FROM companies_ohlcv o
       JOIN companies c ON c.id = o.company_id
       WHERE c.ticker IN (${escaped})
         AND o.interval = '1d'
         AND o.dt <= '${asOfDateIso}'
       ORDER BY c.ticker, o.dt DESC`
    )
  );
  const rows = execRows<{
    ticker: string;
    dt: string;
    close_price: number;
    source: string;
  }>(res);
  return _mapOhlcvRowsToEntries(rows);
}

/**
 * Pure row → Map mapper for getLatestOhlcvCloseForTickers, extracted so the
 * close>0 sanity filter is directly unit-testable without a DB mock (matches
 * getLastCloses()'s own inline filter, which has the same "never surface a
 * non-positive close" guarantee).
 */
export function _mapOhlcvRowsToEntries(
  rows: Array<{ ticker: string; dt: string; close_price: number; source: string }>
): Map<string, OhlcvFallbackEntry> {
  const map = new Map<string, OhlcvFallbackEntry>();
  for (const row of rows) {
    const close = Number(row.close_price);
    if (isFinite(close) && close > 0) {
      map.set(row.ticker, {
        closePrice: close,
        dt:         row.dt,
        source:     row.source,
      });
    }
  }
  return map;
}

// ── Test exports ─────────────────────────────────────────────────────────────
// Prefixed with _ and suffixed with ForTest per house style.
export const _TABLE_NAME_FOR_TEST = "quote_last_close" as const;
export const _SOURCES_FOR_TEST    = ["twse_eod", "tpex_eod", "mis_close", "ohlcv_fallback"] as const;
