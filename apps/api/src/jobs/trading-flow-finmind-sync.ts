/**
 * trading-flow-finmind-sync.ts — BLOCK #4 PR B: FinMind 3 Trading-Flow Dataset ETL
 *
 * Datasets (Athena spec §1 datasets 6/7/8):
 *   6. TaiwanStockInstitutionalInvestorsBuySell → tw_institutional_buysell (stock_id, date, name)
 *   7. TaiwanStockMarginPurchaseShortSale       → tw_margin_short           (stock_id, date)
 *   8. TaiwanStockShareholding                  → tw_shareholding           (stock_id, date)
 *
 * Cadence (per Athena spec §1):
 *   - Institutional buysell: every trading day 14:30 TST (panel-critical)
 *   - Margin/short:          every trading day 17:00 TST
 *   - Shareholding:          weekly Friday 19:00 TST
 *
 * Hard lines:
 *   - FINMIND_API_TOKEN never logged (boolean-only exposure)
 *   - state=LIVE requires real SQL row evidence (never faked)
 *   - graceful fallback when DB table not yet migrated (state=DEGRADED, skipReason="table_not_migrated")
 *   - idempotent upsert on every run (ON CONFLICT DO UPDATE)
 *   - withFinMindRetry imported from fundamentals-finmind-sync (shared wrapper, not duplicated)
 *   - recordFinMindRequest ticks for every batch
 *   - kill switch respected — all jobs emit skipped=killswitch_on when ON
 *   - quarantine over silent drop (§3.5)
 */

import { sql as drizzleSql } from "drizzle-orm";
import { getDb } from "@iuf-trading-room/db";
import {
  getFinMindClient,
  recordFinMindRequest,
  type FinMindInstitutionalRow,
  type FinMindMarginShortRow,
  type FinMindShareholdingRow
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

export interface TradingFlowSyncResult {
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
      `[trading-flow-sync] quarantine table ${quarantineTable} not found, row dropped reason=${data.reason_code}`
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
      `[trading-flow-sync] quarantine insert failed for ${quarantineTable}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── Skipped result helper ─────────────────────────────────────────────────────

function makeSkipped(
  dataset: string,
  reason: string,
  t0: number,
  startedAt: string
): TradingFlowSyncResult {
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
    finishedAt: now
  };
}

// ── 6. TaiwanStockInstitutionalInvestorsBuySell ───────────────────────────────

/**
 * runInstitutionalBuySellSync — pull 三大法人買賣超 for all tickers.
 *
 * Upsert key: (stock_id, date, name)   — 3 rows per stock per day
 * DB table:   tw_institutional_buysell
 * Cadence:    every trading day 14:30 TST (panel-critical)
 */
export async function runInstitutionalBuySellSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<TradingFlowSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockInstitutionalInvestorsBuySell";

  if (isFinMindKillSwitchOn()) {
    console.log(`[trading-flow-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[trading-flow-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[trading-flow-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_institutional_buysell");
  if (!tableReady) {
    console.warn(`[trading-flow-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  // Default: last 30 trading days for daily cadence
  const startDate = opts?.startDate ?? daysAgoIso(30);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindInstitutionalRow>(dataset, () =>
      client.getInstitutionalInvestors(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    for (const row of result.rows) {
      // QA: buy/sell must be numeric, date must be present, name must be non-empty
      if (!row.date || !row.name || typeof row.buy !== "number" || typeof row.sell !== "number") {
        rowsQuarantined++;
        await quarantineRow("tw_institutional_buysell", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "invalid_row_shape",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_institutional_buysell
            (stock_id, date, name, buy, sell, fetched_at, source)
          VALUES
            (${row.stock_id}, ${row.date}, ${row.name}, ${row.buy}, ${row.sell},
             ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, date, name)
          DO UPDATE SET
            buy        = EXCLUDED.buy,
            sell       = EXCLUDED.sell,
            fetched_at = EXCLUDED.fetched_at,
            source     = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[trading-flow-sync] ${dataset} upsert error ticker=${ticker} date=${row.date}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[trading-flow-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
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

// ── 7. TaiwanStockMarginPurchaseShortSale ─────────────────────────────────────

/**
 * runMarginShortSync — pull 融資券餘額 for all tickers.
 *
 * Upsert key: (stock_id, date)
 * DB table:   tw_margin_short
 * Cadence:    every trading day 17:00 TST
 */
export async function runMarginShortSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<TradingFlowSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockMarginPurchaseShortSale";

  if (isFinMindKillSwitchOn()) {
    console.log(`[trading-flow-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[trading-flow-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[trading-flow-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_margin_short");
  if (!tableReady) {
    console.warn(`[trading-flow-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  const startDate = opts?.startDate ?? daysAgoIso(30);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindMarginShortRow>(dataset, () =>
      client.getMarginShortSale(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    for (const row of result.rows) {
      // QA: date must be present, core fields must be numeric
      if (
        !row.date ||
        typeof row.MarginPurchaseBuy !== "number" ||
        typeof row.ShortSaleSell !== "number"
      ) {
        rowsQuarantined++;
        await quarantineRow("tw_margin_short", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "invalid_row_shape",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_margin_short
            (stock_id, date,
             margin_purchase_buy, margin_purchase_sell, margin_purchase_cash_repayment,
             margin_purchase_limit, margin_purchase_yesterday, margin_purchase_today,
             margin_purchase_yesterday_balance, margin_purchase_today_balance,
             short_sale_buy, short_sale_sell, short_sale_limit,
             short_sale_yesterday, short_sale_today,
             short_sale_yesterday_balance, short_sale_today_balance,
             fetched_at, source)
          VALUES
            (${row.stock_id}, ${row.date},
             ${row.MarginPurchaseBuy}, ${row.MarginPurchaseSell}, ${row.MarginPurchaseCashRepayment},
             ${row.MarginPurchaseLimit ?? null}, ${row.MarginPurchaseYesterday ?? null}, ${row.MarginPurchaseToday ?? null},
             ${row.MarginPurchaseYesterdayBalance ?? null}, ${row.MarginPurchaseTodayBalance ?? null},
             ${row.ShortSaleBuy}, ${row.ShortSaleSell}, ${row.ShortSaleLimit ?? null},
             ${row.ShortSaleYesterday ?? null}, ${row.ShortSaleToday ?? null},
             ${row.ShortSaleYesterdayBalance ?? null}, ${row.ShortSaleTodayBalance ?? null},
             ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, date)
          DO UPDATE SET
            margin_purchase_buy               = EXCLUDED.margin_purchase_buy,
            margin_purchase_sell              = EXCLUDED.margin_purchase_sell,
            margin_purchase_cash_repayment    = EXCLUDED.margin_purchase_cash_repayment,
            margin_purchase_limit             = EXCLUDED.margin_purchase_limit,
            margin_purchase_yesterday         = EXCLUDED.margin_purchase_yesterday,
            margin_purchase_today             = EXCLUDED.margin_purchase_today,
            margin_purchase_yesterday_balance = EXCLUDED.margin_purchase_yesterday_balance,
            margin_purchase_today_balance     = EXCLUDED.margin_purchase_today_balance,
            short_sale_buy                    = EXCLUDED.short_sale_buy,
            short_sale_sell                   = EXCLUDED.short_sale_sell,
            short_sale_limit                  = EXCLUDED.short_sale_limit,
            short_sale_yesterday              = EXCLUDED.short_sale_yesterday,
            short_sale_today                  = EXCLUDED.short_sale_today,
            short_sale_yesterday_balance      = EXCLUDED.short_sale_yesterday_balance,
            short_sale_today_balance          = EXCLUDED.short_sale_today_balance,
            fetched_at                        = EXCLUDED.fetched_at,
            source                            = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[trading-flow-sync] ${dataset} upsert error ticker=${ticker} date=${row.date}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[trading-flow-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
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

// ── 8. TaiwanStockShareholding ────────────────────────────────────────────────

/**
 * runShareholdingSync — pull 集保戶數分佈 for all tickers.
 *
 * Upsert key: (stock_id, date)
 * DB table:   tw_shareholding
 * Cadence:    weekly Friday 19:00 TST
 */
export async function runShareholdingSync(
  tickers: Array<{ ticker: string }>,
  opts?: { startDate?: string; endDate?: string }
): Promise<TradingFlowSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const dataset = "TaiwanStockShareholding";

  if (isFinMindKillSwitchOn()) {
    console.log(`[trading-flow-sync] ${dataset} skipped=killswitch_on`);
    return makeSkipped(dataset, "killswitch_on", t0, startedAt);
  }

  if (!process.env.FINMIND_API_TOKEN) {
    console.log(`[trading-flow-sync] ${dataset} skipped=no_token`);
    return makeSkipped(dataset, "no_token", t0, startedAt);
  }

  const db = getDb();
  if (!db) {
    console.warn(`[trading-flow-sync] ${dataset} skipped=no_db`);
    return makeSkipped(dataset, "no_db", t0, startedAt);
  }

  const tableReady = await tableExists("tw_shareholding");
  if (!tableReady) {
    console.warn(`[trading-flow-sync] ${dataset} skipped=table_not_migrated (state=DEGRADED)`);
    return makeSkipped(dataset, "table_not_migrated", t0, startedAt);
  }

  const client = getFinMindClient();
  // Default: last 90 days (weekly dataset; covers ~13 weeks)
  const startDate = opts?.startDate ?? daysAgoIso(90);
  const endDate = opts?.endDate ?? todayIso();
  const fetchedAt = new Date().toISOString();

  let tickersSuccess = 0;
  let tickersFailed = 0;
  let rowsUpserted = 0;
  let rowsQuarantined = 0;

  for (const { ticker } of tickers) {
    const result = await withFinMindRetry<FinMindShareholdingRow>(dataset, () =>
      client.getShareholding(ticker, startDate, endDate)
    );

    if (!result.ok || result.rows.length === 0) {
      if (!result.ok) tickersFailed++;
      continue;
    }

    for (const row of result.rows) {
      // QA: date must be present, stock_id must be set
      if (!row.date || !row.stock_id) {
        rowsQuarantined++;
        await quarantineRow("tw_shareholding", {
          stock_id: row.stock_id,
          date: row.date,
          reason_code: "missing_key_fields",
          raw: JSON.stringify(row)
        }, db).catch(() => {});
        continue;
      }

      try {
        await db.execute(drizzleSql`
          INSERT INTO tw_shareholding
            (stock_id, date, stock_name, international_code,
             foreign_investment_remaining_shares, foreign_investment_shares,
             foreign_investment_remain_ratio, foreign_investment_shares_ratio,
             foreign_investment_upper_limit_ratio, chinese_investment_upper_limit_ratio,
             number_of_shares_issued, recently_declare_date, note,
             fetched_at, source)
          VALUES
            (${row.stock_id}, ${row.date}, ${row.stock_name ?? null}, ${row.InternationalCode ?? null},
             ${row.ForeignInvestmentRemainingShares ?? null}, ${row.ForeignInvestmentShares ?? null},
             ${row.ForeignInvestmentRemainRatio ?? null}, ${row.ForeignInvestmentSharesRatio ?? null},
             ${row.ForeignInvestmentUpperLimitRatio ?? null}, ${row.ChineseInvestmentUpperLimitRatio ?? null},
             ${row.NumberOfSharesIssued ?? null}, ${row.RecentlyDeclareDate ?? null}, ${row.note ?? null},
             ${fetchedAt}, 'finmind')
          ON CONFLICT (stock_id, date)
          DO UPDATE SET
            stock_name                            = EXCLUDED.stock_name,
            international_code                    = EXCLUDED.international_code,
            foreign_investment_remaining_shares   = EXCLUDED.foreign_investment_remaining_shares,
            foreign_investment_shares             = EXCLUDED.foreign_investment_shares,
            foreign_investment_remain_ratio       = EXCLUDED.foreign_investment_remain_ratio,
            foreign_investment_shares_ratio       = EXCLUDED.foreign_investment_shares_ratio,
            foreign_investment_upper_limit_ratio  = EXCLUDED.foreign_investment_upper_limit_ratio,
            chinese_investment_upper_limit_ratio  = EXCLUDED.chinese_investment_upper_limit_ratio,
            number_of_shares_issued               = EXCLUDED.number_of_shares_issued,
            recently_declare_date                 = EXCLUDED.recently_declare_date,
            note                                  = EXCLUDED.note,
            fetched_at                            = EXCLUDED.fetched_at,
            source                                = EXCLUDED.source
        `);
        rowsUpserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[trading-flow-sync] ${dataset} upsert error ticker=${ticker} date=${row.date}: ${msg}`);
        tickersFailed++;
      }
    }
    tickersSuccess++;
  }

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - t0;
  console.log(
    `[trading-flow-sync] ${dataset} DONE tickers=${tickers.length} success=${tickersSuccess} ` +
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

// ── Cadence helpers ───────────────────────────────────────────────────────────

/** Returns true if today is Friday (weekly trigger for shareholding sync). */
export function isFridayTriggerDay(): boolean {
  return new Date().getUTCDay() === 5;
}

// ── DB row stats helper ───────────────────────────────────────────────────────
// Used by the finmind/status panel to show real row counts for these 3 datasets.

export interface TradingFlowDatasetStats {
  rowCount: number;
  latestDate: string | null;
  state: "LIVE" | "STALE" | "EMPTY" | "ERROR" | "DEGRADED";
  missingReason: string | null;
}

/**
 * Query row count and freshness for a trading-flow cache table.
 * staleDays: max acceptable gap before state flips to STALE.
 */
export async function queryTradingFlowDatasetStats(
  tableName: string,
  staleDays = 5
): Promise<TradingFlowDatasetStats> {
  const db = getDb();
  if (!db) return { rowCount: 0, latestDate: null, state: "EMPTY", missingReason: "no_database" };

  const exists = await tableExists(tableName);
  if (!exists) return { rowCount: 0, latestDate: null, state: "DEGRADED", missingReason: "table_not_migrated" };

  try {
    const result = await db.execute(drizzleSql`
      SELECT
        COUNT(*)::int   AS row_count,
        MAX(date)::text AS latest_date
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
