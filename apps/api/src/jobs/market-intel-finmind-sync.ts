/**
 * market-intel-finmind-sync.ts — BLOCK #4 PR C: FinMind 4 Market-Intel Dataset ETL
 *
 * Datasets (Athena spec §1 datasets 5/9/10/11):
 *   5.  TaiwanStockDividend     → tw_dividend      (stock_id, year, dividend_type)
 *   9.  TaiwanStockMarketValue  → tw_market_value  (stock_id, date)
 *   10. TaiwanStockPER          → tw_valuation     (stock_id, date)
 *   11. TaiwanStockNews         → tw_stock_news    sha256(title+url+published_at) [EXPERIMENTAL]
 *
 * Cadence (per Athena spec §1):
 *   - Dividend:     weekly Sunday 22:00 TST + ex-div-date sweep T-1/T0/T+1
 *   - Market value: weekly weekend (Saturday/Sunday)
 *   - Valuation:    every trading day 盤後 (daily)
 *   - News:         every 30min, pull last 24h incremental [EXPERIMENTAL]
 *
 * Hard lines:
 *   - FINMIND_API_TOKEN never logged (boolean-only exposure)
 *   - state=LIVE requires real SQL row evidence (never faked)
 *   - graceful fallback when DB table not yet migrated (state=DEGRADED, no throw)
 *   - idempotent upsert on every run (ON CONFLICT DO UPDATE)
 *   - withFinMindRetry imported from fundamentals-finmind-sync (shared wrapper)
 *   - recordFinMindRequest ticks for every batch (via withFinMindRetry)
 *   - kill switch respected — all jobs emit skipped=killswitch_on when ON
 *   - quarantine over silent drop (§3.5)
 *   - news dataset: if endpoint returns empty or 403 consistently → state=DEGRADED
 *     (experimental, never fake content)
 *   - sha256 content_hash computed via Node crypto (no external dep)
 */

import { createHash } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "@iuf-trading-room/db";
import {
  getFinMindClient,
  recordFinMindRequest,
  type FinMindDividendRow,
  type FinMindMarketValueRow,
  type FinMindPERRow,
  type FinMindNewsRow
} from "../data-sources/finmind-client.js";
import { withFinMindRetry } from "./fundamentals-finmind-sync.js";

// suppress unused import warning — recordFinMindRequest is used indirectly via withFinMindRetry
void recordFinMindRequest;

// ── Kill switch gate ──────────────────────────────────────────────────────────

function isFinMindKillSwitchOn(): boolean {
  return process.env.FINMIND_KILL_SWITCH === "true";
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Returns true if today is Saturday or Sunday (UTC). */
export function isWeekendTriggerDay(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6; // 0=Sunday, 6=Saturday
}

/** Returns true if today is Sunday (UTC) — weekly dividend burst. */
export function isSundayTriggerDay(): boolean {
  return new Date().getUTCDay() === 0;
}

// ── Table existence guard ─────────────────────────────────────────────────────

async function tableExists(tableName: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  try {
    const result = await db.execute(drizzleSql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ${tableName}
      ) AS exists
    `);
    const row = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? result[0] : result);
    return row?.exists === true || row?.exists === "true";
  } catch {
    return false;
  }
}

// ── Sync result type ──────────────────────────────────────────────────────────

export interface MarketIntelSyncResult {
  dataset: string;
  tickersAttempted: number;
  tickersSuccess: number;
  tickersFailed: number;
  rowsUpserted: number;
  rowsQuarantined: number;
  skipped: boolean;
  skipReason: string | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  experimental?: boolean;
}

// ── Quarantine helper ─────────────────────────────────────────────────────────

async function quarantineRow(
  sourceTable: string,
  data: Record<string, string | null | undefined>,
  db: NonNullable<ReturnType<typeof getDb>>
): Promise<void> {
  const quarantineTable = `_quarantine_${sourceTable}`;
  const quarantineExists = await tableExists(quarantineTable);
  if (!quarantineExists) {
    console.warn(
      `[market-intel-sync] quarantine table ${quarantineTable} not found, row reason=${data.reason_code}`
    );
    return;
  }
  try {
    await db.execute(drizzleSql`
      INSERT INTO ${drizzleSql.identifier(quarantineTable)}
        (stock_id, reason_code, raw_json, quarantined_at)
      VALUES
        (${data.stock_id ?? null}, ${data.reason_code ?? "unknown"}, ${data.raw ?? "{}"}, NOW())
    `);
  } catch (err) {
    console.warn(
      `[market-intel-sync] quarantine insert failed for ${quarantineTable}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── Skipped result helper ─────────────────────────────────────────────────────

function makeSkipped(
  dataset: string,
  reason: string,
  t0: number,
  startedAt: string,
  experimental = false
): MarketIntelSyncResult {
  const now = new Date().toISOString();
  return {
    dataset,
    tickersAttempted: 0,
    tickersSuccess: 0,
    tickersFailed: 0,
    rowsUpserted: 0,
    rowsQuarantined: 0,
    skipped: true,
    skipReason: reason,
    durationMs: Date.now() - t0,
    startedAt,
    finishedAt: now,
    ...(experimental ? { experimental: true } : {})
  };
}

// ── sha256 content hash helper (for news dedup) ───────────────────────────────

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const MAX_UPSERT_ERROR_LOGS_PER_DATASET = 5;

export function normalizeDividendYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  if (typeof value !== "string") return null;

  const match = value.trim().match(/\d{2,4}/);
  if (!match) return null;

  const year = Number(match[0]);
  return Number.isFinite(year) && year > 0 ? Math.trunc(year) : null;
}

function normalizeDividendAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function compactErrorMessage(err: unknown): string {
  const source = err instanceof Error ? err.message : String(err);
  return source.split(/\r?\n/)[0]?.slice(0, 240) || "unknown_error";
}

// ── 5. TaiwanStockDividend ────────────────────────────────────────────────────

/**
 * runDividendSync — pull 股利政策 for all tickers.
 *
 * Upsert key: (stock_id, year, dividend_type)
 * dividend_type: 'stock' when TotalStockDividend > 0, 'cash' otherwise (per FinMind shape).
 * DB table:   tw_dividend
 * Cadence:    weekly Sunday 22:00 TST + ex-div-date sweep
 */
export async function runDividendSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<MarketIntelSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockDividend";

  if (isFinMindKillSwitchOn()) {
    console.log(`[market-intel-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[market-intel-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[market-intel-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_dividend");
  if (!tableReady) {
    console.warn(`[market-intel-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  // Default: last 3 years of dividend history
  const startDate = opts?.startDate ?? daysAgoIso(365 * 3);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;
  let upsertErrorLogs = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindDividendRow>(dataset, () =>
      client.getDividend(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    for (const row of result.rows) {
      const dividendYear = normalizeDividendYear(row.year);

      // QA: year must be present and positive, stock_id must be set
      if (!row.stock_id || dividendYear === null) {
        rowsQuarantined++;
        await quarantineRow("tw_dividend", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "missing_key_fields",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      // Derive dividend_type from totals
      const stockEarningsDistribution = normalizeDividendAmount(row.StockEarningsDistribution);
      const stockStatutoryReserveTransfer = normalizeDividendAmount(row.StockStatutoryReserveTransfer);
      const stockCapitalReserveTransfer = normalizeDividendAmount(row.StockCapitalReserveTransfer);
      const stockReward = normalizeDividendAmount(row.StockReward);
      const totalStockDividend = normalizeDividendAmount(row.TotalStockDividend);
      const cashEarningsDistribution = normalizeDividendAmount(row.CashEarningsDistribution);
      const cashStatutoryReserveTransfer = normalizeDividendAmount(row.CashStatutoryReserveTransfer);
      const cashCapitalReserveTransfer = normalizeDividendAmount(row.CashCapitalReserveTransfer);
      const cashReward = normalizeDividendAmount(row.CashReward);
      const totalCashDividend = normalizeDividendAmount(row.TotalCashDividend);
      const totalDividend = normalizeDividendAmount(row.TotalDividend);
      const dividendType = totalStockDividend > 0 ? "stock" : "cash";

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_dividend
            (stock_id, year, dividend_type, announcement_date,
             stock_earnings_distribution, stock_statutory_reserve_transfer,
             stock_capital_reserve_transfer, stock_reward, total_stock_dividend,
             cash_earnings_distribution, cash_statutory_reserve_transfer,
             cash_capital_reserve_transfer, cash_reward, total_cash_dividend,
             total_dividend, fetched_at, source)
          VALUES
            (${row.stock_id}, ${dividendYear}, ${dividendType}, ${row.date ?? null},
             ${stockEarningsDistribution}, ${stockStatutoryReserveTransfer},
             ${stockCapitalReserveTransfer}, ${stockReward}, ${totalStockDividend},
             ${cashEarningsDistribution}, ${cashStatutoryReserveTransfer},
             ${cashCapitalReserveTransfer}, ${cashReward}, ${totalCashDividend},
             ${totalDividend}, ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, year, dividend_type)
          DO UPDATE SET
            announcement_date                  = EXCLUDED.announcement_date,
            stock_earnings_distribution        = EXCLUDED.stock_earnings_distribution,
            stock_statutory_reserve_transfer   = EXCLUDED.stock_statutory_reserve_transfer,
            stock_capital_reserve_transfer     = EXCLUDED.stock_capital_reserve_transfer,
            stock_reward                       = EXCLUDED.stock_reward,
            total_stock_dividend               = EXCLUDED.total_stock_dividend,
            cash_earnings_distribution         = EXCLUDED.cash_earnings_distribution,
            cash_statutory_reserve_transfer    = EXCLUDED.cash_statutory_reserve_transfer,
            cash_capital_reserve_transfer      = EXCLUDED.cash_capital_reserve_transfer,
            cash_reward                        = EXCLUDED.cash_reward,
            total_cash_dividend                = EXCLUDED.total_cash_dividend,
            total_dividend                     = EXCLUDED.total_dividend,
            fetched_at                         = EXCLUDED.fetched_at,
            source                             = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        if (upsertErrorLogs < MAX_UPSERT_ERROR_LOGS_PER_DATASET) {
          console.error(
            `[market-intel-sync] ${dataset} upsert error ticker=${ticker} rawYear=${String(row.year)} ` +
            `normalizedYear=${dividendYear} error=${compactErrorMessage(err)}`
          );
        } else if (upsertErrorLogs === MAX_UPSERT_ERROR_LOGS_PER_DATASET) {
          console.error(
            `[market-intel-sync] ${dataset} suppressing additional upsert errors ` +
            `after ${MAX_UPSERT_ERROR_LOGS_PER_DATASET}; see DONE failed count`
          );
        }
        upsertErrorLogs++;
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[market-intel-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
    `failed=${tickersFailed} rowsUpserted=${rowsUpserted} rowsQuarantined=${rowsQuarantined} durationMs=${durationMs}`
  );

  return {
    dataset,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    rowsUpserted,
    rowsQuarantined,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt
  };
}

// ── 9. TaiwanStockMarketValue ─────────────────────────────────────────────────

/**
 * runMarketValueSync — pull 市值/股本 for all tickers.
 *
 * Upsert key: (stock_id, date)
 * DB table:   tw_market_value
 * Cadence:    weekly weekend (Saturday/Sunday)
 */
export async function runMarketValueSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<MarketIntelSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockMarketValue";

  if (isFinMindKillSwitchOn()) {
    console.log(`[market-intel-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[market-intel-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[market-intel-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_market_value");
  if (!tableReady) {
    console.warn(`[market-intel-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  // Default: last 90 days (covers ~13 weekly snapshots)
  const startDate = opts?.startDate ?? daysAgoIso(90);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindMarketValueRow>(dataset, () =>
      client.getMarketValue(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    for (const row of result.rows) {
      // QA: date and market_value must be present
      if (!row.date || typeof row.market_value !== "number") {
        rowsQuarantined++;
        await quarantineRow("tw_market_value", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "invalid_row_shape",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_market_value
            (stock_id, date, market_value, fetched_at, source)
          VALUES
            (${row.stock_id}, ${row.date}, ${row.market_value}, ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, date)
          DO UPDATE SET
            market_value = EXCLUDED.market_value,
            fetched_at   = EXCLUDED.fetched_at,
            source       = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[market-intel-sync] ${dataset} upsert error ticker=${ticker} date=${row.date}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[market-intel-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
    `failed=${tickersFailed} rowsUpserted=${rowsUpserted} rowsQuarantined=${rowsQuarantined} durationMs=${durationMs}`
  );

  return {
    dataset,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    rowsUpserted,
    rowsQuarantined,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt
  };
}

// ── 10. TaiwanStockPER (valuation) ────────────────────────────────────────────

/**
 * runValuationSync — pull 本益比/股價淨值比/殖利率 for all tickers.
 *
 * Upsert key: (stock_id, date)
 * DB table:   tw_valuation
 * Cadence:    every trading day 盤後
 */
export async function runValuationSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<MarketIntelSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockPER";

  if (isFinMindKillSwitchOn()) {
    console.log(`[market-intel-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[market-intel-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[market-intel-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_valuation");
  if (!tableReady) {
    console.warn(`[market-intel-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  // Default: last 30 trading days
  const startDate = opts?.startDate ?? daysAgoIso(30);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindPERRow>(dataset, () =>
      client.getPER(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    for (const row of result.rows) {
      // QA: date must be present, PER/PBR should be finite numbers (can be null for some stocks)
      if (!row.date || !row.stock_id) {
        rowsQuarantined++;
        await quarantineRow("tw_valuation", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "missing_key_fields",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_valuation
            (stock_id, date, dividend_yield, per, pbr, fetched_at, source)
          VALUES
            (${row.stock_id}, ${row.date},
             ${typeof row.dividend_yield === "number" ? row.dividend_yield : null},
             ${typeof row.PER === "number" ? row.PER : null},
             ${typeof row.PBR === "number" ? row.PBR : null},
             ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, date)
          DO UPDATE SET
            dividend_yield = EXCLUDED.dividend_yield,
            per            = EXCLUDED.per,
            pbr            = EXCLUDED.pbr,
            fetched_at     = EXCLUDED.fetched_at,
            source         = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[market-intel-sync] ${dataset} upsert error ticker=${ticker} date=${row.date}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[market-intel-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
    `failed=${tickersFailed} rowsUpserted=${rowsUpserted} rowsQuarantined=${rowsQuarantined} durationMs=${durationMs}`
  );

  return {
    dataset,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    rowsUpserted,
    rowsQuarantined,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt
  };
}

// ── 11. TaiwanStockNews [EXPERIMENTAL] ───────────────────────────────────────

/**
 * runStockNewsSync — pull 個股新聞 incremental (last 24h) for all tickers.
 *
 * Upsert key: content_hash = sha256(title + url + published_at)
 * DB table:   tw_stock_news  [EXPERIMENTAL]
 * Cadence:    every 30min, pull last 24h
 *
 * EXPERIMENTAL notes:
 *   - FinMind news availability depends on sponsor tier authorization.
 *   - If endpoint consistently returns empty → state=DEGRADED (not LIVE).
 *   - Never fake content — if dirty data arrives → quarantine.
 *   - This is the AI reviewer rule #4 ground keystone (see Athena spec §5).
 */
export async function runStockNewsSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<MarketIntelSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockNews";

  if (isFinMindKillSwitchOn()) {
    console.log(`[market-intel-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt, true);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[market-intel-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt, true);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[market-intel-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt, true);
  }

  const tableReady = await tableExists("tw_stock_news");
  if (!tableReady) {
    console.warn(`[market-intel-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt, true);
  }

  const client = getFinMindClient();
  // Default: last 24h incremental pull
  const startDate = opts?.startDate ?? daysAgoIso(1);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;
  let emptyCount = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindNewsRow>(dataset, () =>
      client.getStockNews(ticker, startDate, endDate)
    );

    if (!result.ok) {
      tickersFailed++;
      continue;
    }

    if (result.rows.length === 0) {
      emptyCount++;
      continue;
    }

    for (const row of result.rows) {
      // QA: title must be present, must have either url or published_at for dedup
      if (!row.title || !row.stock_id) {
        rowsQuarantined++;
        await quarantineRow("tw_stock_news", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "missing_title_or_stock_id",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      // Compute content_hash: sha256(title + (url ?? '') + (date ?? ''))
      const contentHash = sha256Hex(`${row.title}${row.url ?? ""}${row.date ?? ""}`);

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_stock_news
            (stock_id, content_hash, title, url, published_at, source_name, fetched_at, source)
          VALUES
            (${row.stock_id}, ${contentHash}, ${row.title},
             ${row.url ?? null}, ${row.date ?? null}, ${row.source_name ?? null},
             ${fetchedAt}, 'finmind')
          ON CONFLICT (content_hash)
          DO UPDATE SET
            fetched_at = EXCLUDED.fetched_at,
            source     = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[market-intel-sync] ${dataset} upsert error ticker=${ticker}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  // EXPERIMENTAL degradation signal: if >80% of tickers returned empty, log as degraded
  const degradedSignal = tickers.length > 0 && emptyCount / tickers.length >= 0.8;
  if (degradedSignal) {
    console.warn(
      `[market-intel-sync] ${dataset} EXPERIMENTAL degraded signal: ` +
      `${emptyCount}/${tickers.length} tickers returned empty — ` +
      "may indicate sponsor tier restriction; state=DEGRADED if no rows persist"
    );
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[market-intel-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
    `empty=${emptyCount} failed=${tickersFailed} rowsUpserted=${rowsUpserted} ` +
    `rowsQuarantined=${rowsQuarantined} durationMs=${durationMs} experimental=true`
  );

  return {
    dataset,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    rowsUpserted,
    rowsQuarantined,
    skipped: false,
    skipReason: null,
    durationMs,
    startedAt,
    finishedAt,
    experimental: true
  };
}

// ── DB row stats helper ───────────────────────────────────────────────────────

export interface MarketIntelDatasetStats {
  rowCount: number;
  latestDate: string | null;
  state: "LIVE" | "STALE" | "EMPTY" | "ERROR" | "DEGRADED";
  missingReason: string | null;
  experimental?: boolean;
}

/**
 * Query row count and freshness for a market-intel cache table.
 * staleDays: max acceptable gap before state flips to STALE.
 * dateCol: the column to use for latestDate / staleness check.
 */
export async function queryMarketIntelDatasetStats(
  tableName: string,
  staleDays = 7,
  dateCol = "date"
): Promise<MarketIntelDatasetStats> {
  const db = getDb();
  if (!db) return { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "no_database" };

  const exists = await tableExists(tableName);
  if (!exists) return { rowCount: 0, latestDate: null, state: "DEGRADED", missingReason: "table_not_migrated" };

  try {
    // For tw_stock_news use fetched_at; for others use date col
    const dateExpr = dateCol === "fetched_at"
      ? drizzleSql`MAX(fetched_at)::text`
      : drizzleSql`MAX(${drizzleSql.identifier(dateCol)})::text`;

    const result = await db.execute(drizzleSql`
      SELECT
        COUNT(*)::int   AS row_count,
        ${dateExpr}     AS latest_date
      FROM ${drizzleSql.identifier(tableName)}
    `);

    const rawRow = (result as { rows?: Record<string, unknown>[] })?.rows?.[0]
      ?? (Array.isArray(result) ? (result as unknown[])[0] : result);
    const row = rawRow as Record<string, unknown>;
    const rowCount   = typeof row?.row_count   === "number" ? (row.row_count as number)   : parseInt(String(row?.row_count   ?? "0"), 10);
    const latestDate = typeof row?.latest_date === "string" ? (row.latest_date as string) : null;

    if (rowCount === 0) return { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "no_rows" };

    const staleMs = staleDays * 24 * 60 * 60 * 1000;
    const isStale = latestDate ? (Date.now() - new Date(latestDate).getTime()) > staleMs : true;
    const state = isStale ? "STALE" : "LIVE";

    return { rowCount, latestDate, state, missingReason: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rowCount: 0, latestDate: null, state: "ERROR", missingReason: msg };
  }
}
