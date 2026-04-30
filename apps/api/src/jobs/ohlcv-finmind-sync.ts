/**
 * ohlcv-finmind-sync.ts — W7 H1: FinMind OHLCV daily sync job
 *
 * Replaces mock OHLCV seeder when OHLCV_SOURCE=finmind.
 * When OHLCV_SOURCE=mock (default), this job is a no-op.
 *
 * Responsibilities:
 *   - Pull TaiwanStockPriceAdj for a list of tickers (workspace companies)
 *   - Write bars to companies_ohlcv table (onConflict → update)
 *   - Dry-run mode (OHLCV_SYNC_DRY_RUN=true) logs without writing
 *
 * Hard lines:
 *   - No KGI SDK import
 *   - No broker surface
 *   - FINMIND_API_TOKEN only from env, never logged
 *   - 429 handled by FinMindClient internally (exponential backoff)
 *   - DB failure on one ticker does not stop the rest
 */

import { and, eq } from "drizzle-orm";
import { companiesOhlcv, getDb } from "@iuf-trading-room/db";
import { getFinMindClient } from "../data-sources/finmind-client.js";
import type { OhlcvBar } from "../companies-ohlcv.js";

// ── Config ────────────────────────────────────────────────────────────────────

export type OhlcvSource = "mock" | "finmind";

function getOhlcvSource(): OhlcvSource {
  const raw = process.env.OHLCV_SOURCE ?? "mock";
  return raw === "finmind" ? "finmind" : "mock";
}

function isDryRun(): boolean {
  return process.env.OHLCV_SYNC_DRY_RUN === "true";
}

// ── Sync result types ─────────────────────────────────────────────────────────

export interface OhlcvSyncTickerResult {
  ticker: string;
  barsFromApi: number;
  barsUpserted: number;
  skipped: boolean;   // true if source=mock or dry-run
  error?: string;
}

export interface OhlcvSyncResult {
  source: OhlcvSource;
  dryRun: boolean;
  tickersAttempted: number;
  tickersSuccess: number;
  tickersFailed: number;
  results: OhlcvSyncTickerResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoToYYYYMMDD(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return isoToYYYYMMDD(d);
}

// ── Per-ticker sync ───────────────────────────────────────────────────────────

async function syncTicker(
  workspaceId: string,
  companyId: string,
  ticker: string,
  startDate: string,
  endDate: string,
  dryRun: boolean
): Promise<OhlcvSyncTickerResult> {
  const client = getFinMindClient();

  let bars: OhlcvBar[];
  try {
    bars = await client.getStockPriceAdj(ticker, startDate, endDate);
  } catch (err) {
    return {
      ticker,
      barsFromApi: 0,
      barsUpserted: 0,
      skipped: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  if (bars.length === 0) {
    return { ticker, barsFromApi: 0, barsUpserted: 0, skipped: false };
  }

  if (dryRun) {
    console.log(`[ohlcv-finmind-sync] DRY-RUN ticker=${ticker} barsFromApi=${bars.length}`);
    return { ticker, barsFromApi: bars.length, barsUpserted: 0, skipped: true };
  }

  // Upsert bars into companies_ohlcv
  let barsUpserted = 0;
  try {
    const db = getDb();

    for (const bar of bars) {
      await db
        .insert(companiesOhlcv)
        .values({
          companyId,
          workspaceId,
          dt: bar.dt,
          interval: "1d" as const,
          open: String(bar.open),
          high: String(bar.high),
          low: String(bar.low),
          close: String(bar.close),
          volume: bar.volume,
          source: "tej" as const
        })
        .onConflictDoUpdate({
          target: [companiesOhlcv.companyId, companiesOhlcv.dt, companiesOhlcv.interval],
          set: {
            open: String(bar.open),
            high: String(bar.high),
            low: String(bar.low),
            close: String(bar.close),
            volume: bar.volume,
            source: "tej" as const
          }
        });
      barsUpserted++;
    }
  } catch (err) {
    return {
      ticker,
      barsFromApi: bars.length,
      barsUpserted,
      skipped: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }

  return { ticker, barsFromApi: bars.length, barsUpserted, skipped: false };
}

// ── Main sync function ────────────────────────────────────────────────────────

/**
 * Run EOD OHLCV sync for a list of tickers.
 *
 * @param tickers - Array of { companyId, ticker, workspaceId }
 * @param options - Optional overrides for startDate/endDate (defaults: 2 years back → today)
 */
export async function runOhlcvFinmindSync(
  tickers: Array<{ companyId: string; ticker: string; workspaceId: string }>,
  options?: {
    startDate?: string;
    endDate?: string;
  }
): Promise<OhlcvSyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const source = getOhlcvSource();
  const dryRun = isDryRun();

  const startDate = options?.startDate ?? daysAgoIso(730);  // 2 years back
  const endDate = options?.endDate ?? isoToYYYYMMDD(new Date());

  console.log(`[ohlcv-finmind-sync] START source=${source} dryRun=${dryRun} tickers=${tickers.length} startDate=${startDate} endDate=${endDate}`);

  if (source === "mock") {
    console.log("[ohlcv-finmind-sync] OHLCV_SOURCE=mock — sync skipped");
    return {
      source,
      dryRun,
      tickersAttempted: 0,
      tickersSuccess: 0,
      tickersFailed: 0,
      results: [],
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0
    };
  }

  const results: OhlcvSyncTickerResult[] = [];

  for (const { companyId, ticker, workspaceId } of tickers) {
    const result = await syncTicker(workspaceId, companyId, ticker, startDate, endDate, dryRun);
    results.push(result);
    console.log(`[ohlcv-finmind-sync] ticker=${ticker} barsFromApi=${result.barsFromApi} barsUpserted=${result.barsUpserted} error=${result.error ?? "none"}`);
  }

  const tickersSuccess = results.filter(r => !r.error).length;
  const tickersFailed = results.filter(r => !!r.error).length;
  const finishedAt = new Date().toISOString();

  console.log(`[ohlcv-finmind-sync] DONE success=${tickersSuccess} failed=${tickersFailed} durationMs=${Date.now() - t0}`);

  return {
    source,
    dryRun,
    tickersAttempted: tickers.length,
    tickersSuccess,
    tickersFailed,
    results,
    startedAt,
    finishedAt,
    durationMs: Date.now() - t0
  };
}
