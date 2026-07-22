/**
 * finmind-client.ts — W7 H1: FinMind data source adapter
 *
 * FinMind is a public Taiwan market data API (https://api.finmindtrade.com).
 * Single endpoint: GET https://api.finmindtrade.com/api/v4/data
 * Auth: JWT token via `token` query param (600 req/hr free tier).
 *
 * Hard lines:
 *   - Token ONLY from process.env.FINMIND_API_TOKEN
 *   - Token NEVER written to logs, Redis, Postgres, or response body
 *   - No token → fallback source=mock + log warning, do NOT throw
 *   - 429 → exponential backoff (1s, 2s, 4s, 8s), max 3 retries
 *   - Redis cache: OHLCV=600s / 財報=3600s / 法人=1800s / 股利=86400s
 *   - Cache failure MUST NOT block response (fail-open)
 *   - No KGI SDK import
 *   - No broker write surface
 *
 * Datasets:
 *   - TaiwanStockPriceAdj      → OHLCV adjusted bars
 *   - TaiwanStockPrice         → OHLCV fallback when token tier cannot access adjusted bars
 *   - TaiwanStockFinancialStatements → 損益表
 *   - TaiwanStockBalanceSheet   → 資產負債表
 *   - TaiwanStockCashFlowsStatement → 現金流量表
 *   - TaiwanStockMonthRevenue   → 月營收
 *   - TaiwanStockInstitutionalInvestorsBuySell → 三大法人
 *   - TaiwanStockMarginPurchaseShortSale → 融資融券
 *   - TaiwanStockDividend       → 股利
 *   - TaiwanStockPER            → PER / PBR / 殖利率
 *   - TaiwanStockMarketValue    → 股價市值
 *   - TaiwanStockShareholding   → 外資持股
 *   - TaiwanStockHoldingSharesPer → 股權分散
 *   - TaiwanStockKBar           → 分 K（sponsor；單次一天）
 */

import { createClient } from "redis";
import type { OhlcvBar } from "../companies-ohlcv.js";

// ── Base URL ──────────────────────────────────────────────────────────────────

const FINMIND_BASE_URL = "https://api.finmindtrade.com/api/v4/data";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinMindClientOptions {
  /** Override for testing — bypasses process.env.FINMIND_API_TOKEN */
  token?: string;
  /** Override Redis client for testing */
  redisClient?: CacheClient | null;
}

// Internal cache abstraction (same lazy-connect pattern as market-ingest.ts)
interface CacheClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttl: number, value: string): Promise<unknown>;
}

// ── FinMind raw response shapes ───────────────────────────────────────────────

interface FinMindResponse<T> {
  status: number;
  msg: string;
  data: T[];
}

export interface FinMindPriceAdjRow {
  date: string;           // 'YYYY-MM-DD'
  stock_id: string;
  Trading_Volume: number;
  Trading_money: number;
  open: number;
  max: number;
  min: number;
  close: number;
  spread: number;
  Trading_turnover: number;
}

export interface FinMindFinancialStatementsRow {
  date: string;           // 'YYYY-MM-DD' (quarter end)
  stock_id: string;
  type: string;
  value: number;
  origin_name?: string;
}

export interface FinMindBalanceSheetRow {
  date: string;
  stock_id: string;
  type: string;
  value: number;
  origin_name?: string;
}

export interface FinMindCashFlowRow {
  date: string;
  stock_id: string;
  type: string;
  value: number;
  origin_name?: string;
}

export interface FinMindMonthRevenueRow {
  date: string;           // 'YYYY-MM-DD' (month start)
  stock_id: string;
  country: string;
  revenue: number;
  revenue_month: number;
  revenue_year: number;
}

export interface FinMindInstitutionalRow {
  date: string;
  stock_id: string;
  name: string;           // 外陸資, 投信, 自營商
  buy: number;
  sell: number;
}

export interface FinMindMarginShortRow {
  date: string;
  stock_id: string;
  MarginPurchaseBuy: number;
  MarginPurchaseSell: number;
  MarginPurchaseCashRepayment: number;
  MarginPurchaseLimit?: number;
  ShortSaleBuy: number;
  ShortSaleSell: number;
  ShortSaleLimit?: number;
  MarginPurchaseYesterday?: number;
  MarginPurchaseToday?: number;
  MarginPurchaseYesterdayBalance?: number;
  MarginPurchaseTodayBalance?: number;
  ShortSaleYesterday?: number;
  ShortSaleToday?: number;
  ShortSaleYesterdayBalance?: number;
  ShortSaleTodayBalance?: number;
}

export interface FinMindDividendRow {
  date: string;
  stock_id: string;
  year: number;
  StockEarningsDistribution: number;
  StockStatutoryReserveTransfer: number;
  StockCapitalReserveTransfer: number;
  StockReward: number;
  TotalStockDividend: number;
  CashEarningsDistribution: number;
  CashStatutoryReserveTransfer: number;
  CashCapitalReserveTransfer: number;
  CashReward: number;
  TotalCashDividend: number;
  TotalDividend: number;
}

export interface FinMindPERRow {
  date: string;
  stock_id: string;
  dividend_yield: number;
  PER: number;
  PBR: number;
}

export interface FinMindMarketValueRow {
  date: string;
  stock_id: string;
  market_value: number;
}

export interface FinMindShareholdingRow {
  date: string;
  stock_id: string;
  stock_name: string;
  InternationalCode: string;
  ForeignInvestmentRemainingShares: number;
  ForeignInvestmentShares: number;
  ForeignInvestmentRemainRatio: number;
  ForeignInvestmentSharesRatio: number;
  ForeignInvestmentUpperLimitRatio: number;
  ChineseInvestmentUpperLimitRatio: number;
  NumberOfSharesIssued: number;
  RecentlyDeclareDate: string;
  note?: string;
}

export interface FinMindHoldingSharesPerRow {
  date: string;
  stock_id: string;
  HoldingSharesLevel: string;
  people: number;
  percent: number;
  unit: number;
}

export interface FinMindKBarRow {
  date: string;           // 'YYYY-MM-DD'
  minute: string;         // 'HH:mm:ss'
  stock_id: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// FinMindNewsRow — TaiwanStockNews (個股新聞)
// EXPERIMENTAL: endpoint availability depends on sponsor tier.
// title + url + date used for deduplication hash.
export interface FinMindNewsRow {
  date: string;           // 'YYYY-MM-DD HH:mm:ss' or 'YYYY-MM-DD'
  stock_id: string;
  title: string;
  url?: string;
  source_name?: string;   // news outlet, may not be present in all tiers
}

// Raw wire shape returned by FinMind's TaiwanStockNews endpoint.
// NOTE: FinMind's actual field name is "link", NOT "url" (confirmed via live
// API response 2026-07-23). Mapping this straight onto FinMindNewsRow.url
// (as the old code did via a blind cast) silently produced url=undefined for
// every row — this is the root cause of items[].url going missing on
// /api/v1/market-intel/news-top10. Map explicitly in getStockNews() below.
interface FinMindNewsRawRow {
  date: string;
  stock_id: string;
  title: string;
  link?: string;
  source_name?: string;
}

/**
 * Only pass through http(s) URLs sourced from the external FinMind API.
 * Anything else (missing, malformed, or non-http(s) protocol such as
 * javascript:/data:) is dropped rather than persisted or returned.
 */
export function sanitizeNewsUrl(rawUrl: string | null | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? rawUrl : undefined;
  } catch {
    return undefined;
  }
}

// ── Cache TTL constants (seconds) ─────────────────────────────────────────────

const TTL_OHLCV     = 600;    // 10 min — refreshed daily but cache hits during day
const TTL_KBAR      = 300;    // 5 min — sponsor KBar is one-day payload
const TTL_FINANCIAL = 3600;   // 1h — quarterly data
const TTL_CHIP      = 1800;   // 30 min — institutional daily
const TTL_DIVIDEND  = 86400;  // 1d — rarely changes
const DEFAULT_OHLCV_LATEST_RAW_FILL_LOOKBACK_DAYS = 21;

// ── 4xx circuit breaker ─────────────────────────────────────────────────────
//
// FinMind can temporarily block clients after repeated 4xx responses. A bad
// token, missing entitlement, or accidental oversized scheduler sweep must not
// keep hammering the upstream API. Keep the breaker process-local: it protects
// production immediately without storing token-adjacent state anywhere.

const DEFAULT_4XX_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

let _circuitOpenUntilMs = 0;
let _lastCircuitOpenedAt: string | null = null;
let _lastCircuitReason: string | null = null;
let _lastCircuitDataset: string | null = null;
let _forbiddenCount = 0;
let _circuitSkipCount = 0;
let _lastCircuitSkipLogMs = 0;

function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function shouldAttemptLatestRawFill(startDate: string, endDate?: string | null): boolean {
  if (endDate) return false;
  if (process.env.FINMIND_OHLCV_LATEST_RAW_FILL === "false") return false;

  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(startMs)) return false;

  const lookbackDays = Math.min(
    envPositiveInt(
      "FINMIND_OHLCV_LATEST_RAW_FILL_LOOKBACK_DAYS",
      DEFAULT_OHLCV_LATEST_RAW_FILL_LOOKBACK_DAYS
    ),
    60
  );
  return Date.now() - startMs <= lookbackDays * 24 * 60 * 60 * 1000;
}

function latestPriceRowDate(rows: FinMindPriceAdjRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (!row.date) continue;
    if (!latest || row.date > latest) latest = row.date;
  }
  return latest;
}

function appendNewerRawPriceRows(
  adjustedRows: FinMindPriceAdjRow[],
  rawRows: FinMindPriceAdjRow[]
): FinMindPriceAdjRow[] {
  const adjustedLatestDate = latestPriceRowDate(adjustedRows);
  if (!adjustedLatestDate) return rawRows;

  const byDate = new Map(adjustedRows.map((row) => [row.date, row]));
  for (const row of rawRows) {
    if (row.date > adjustedLatestDate) {
      byDate.set(row.date, row);
    }
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function openFinMindCircuit(dataset: string, status: number, reason?: string | null): void {
  const cooldownMs = status === 402 || status === 429
    ? envPositiveInt("FINMIND_QUOTA_COOLDOWN_MS", DEFAULT_QUOTA_COOLDOWN_MS)
    : envPositiveInt("FINMIND_4XX_COOLDOWN_MS", DEFAULT_4XX_COOLDOWN_MS);
  const untilMs = Date.now() + cooldownMs;
  if (untilMs > _circuitOpenUntilMs) {
    _circuitOpenUntilMs = untilMs;
  }
  _lastCircuitOpenedAt = new Date().toISOString();
  _lastCircuitReason = reason ? `http_${status}:${reason}` : `http_${status}`;
  _lastCircuitDataset = dataset;
  _forbiddenCount++;
  console.warn(
    `[finmind-client] upstream circuit opened status=${status} dataset=${dataset} ` +
    `cooldownMs=${cooldownMs} reason=${reason ?? "none"}`
  );
}

function finMindCircuitOpen(): boolean {
  return Date.now() < _circuitOpenUntilMs;
}

function finMindCircuitOpenUntilIso(): string | null {
  return finMindCircuitOpen() ? new Date(_circuitOpenUntilMs).toISOString() : null;
}

// ── Redis lazy-connect ────────────────────────────────────────────────────────

let _finmindRedisClient: ReturnType<typeof createClient> | null = null;
let _finmindRedisConnectPromise: Promise<ReturnType<typeof createClient> | null> | null = null;

async function getFinmindRedisClient(): Promise<CacheClient | null> {
  const url = process.env.REDIS_URL ?? null;
  if (!url) return null;

  if (_finmindRedisClient?.isReady) return _finmindRedisClient as unknown as CacheClient;
  if (_finmindRedisConnectPromise) return _finmindRedisConnectPromise as unknown as Promise<CacheClient | null>;

  _finmindRedisConnectPromise = (async () => {
    const client = createClient({
      url,
      socket: { reconnectStrategy: (n: number) => Math.min(n * 200, 3_000) }
    });
    client.on("error", (e: Error) => console.warn("[finmind-client] Redis error", e.message));
    await client.connect();
    _finmindRedisClient = client;
    _finmindRedisConnectPromise = null;
    return client;
  })().catch((e: unknown) => {
    console.warn("[finmind-client] Redis connect failed, running without cache:", e instanceof Error ? e.message : String(e));
    _finmindRedisConnectPromise = null;
    return null;
  });

  return _finmindRedisConnectPromise as unknown as Promise<CacheClient | null>;
}

async function cacheGet(key: string, clientOverride?: CacheClient | null): Promise<string | null> {
  try {
    const client = clientOverride !== undefined ? clientOverride : await getFinmindRedisClient();
    if (!client) return null;
    return await Promise.race([
      client.get(key),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("cache_read_timeout")), 500))
    ]);
  } catch {
    return null; // cache failure is non-fatal
  }
}

async function cacheSet(key: string, value: string, ttl: number, clientOverride?: CacheClient | null): Promise<void> {
  try {
    const client = clientOverride !== undefined ? clientOverride : await getFinmindRedisClient();
    if (!client) return;
    await Promise.race([
      client.setEx(key, ttl, value),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("cache_write_timeout")), 500))
    ]);
  } catch {
    // cache failure is non-fatal
  }
}

// ── Retry with exponential backoff ────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

async function fetchWithRetry(url: string, maxRetries = 3, token?: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        },
        signal: AbortSignal.timeout(15_000)
      });
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
      }
      continue;
    }

    if (response.status === 429) {
      lastErr = new Error(`FinMind rate limit (429)`);
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        console.warn(`[finmind-client] 429 rate limit hit, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw new FinMindRateLimitError("FinMind API rate limit exceeded after retries");
    }

    return response;
  }
  throw lastErr ?? new Error("finmind_fetch_failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Error types ───────────────────────────────────────────────────────────────

export class FinMindRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinMindRateLimitError";
  }
}

export class FinMindParseError extends Error {
  constructor(message: string, public readonly raw?: unknown) {
    super(message);
    this.name = "FinMindParseError";
  }
}

export class FinMindNoTokenError extends Error {
  constructor() {
    super("FINMIND_API_TOKEN not configured — using mock fallback");
    this.name = "FinMindNoTokenError";
  }
}

// ── FinMindClient ─────────────────────────────────────────────────────────────

export class FinMindClient {
  private readonly _tokenOverride?: string;
  private readonly _redisOverride?: CacheClient | null;

  constructor(options?: FinMindClientOptions) {
    this._tokenOverride = options?.token;
    this._redisOverride = options?.redisClient;
  }

  private _getToken(): string | null {
    return this._tokenOverride ?? process.env.FINMIND_API_TOKEN ?? null;
  }

  hasToken(): boolean {
    return Boolean(this._getToken());
  }

  private _buildUrl(dataset: string, stockId: string, startDate: string, endDate?: string | null): string {
    const token = this._getToken();
    const params = new URLSearchParams({
      dataset,
      data_id: stockId,
      start_date: startDate
    });
    if (endDate) {
      params.set("end_date", endDate);
    }
    if (token) {
      params.set("token", token);
    }
    return `${FINMIND_BASE_URL}?${params.toString()}`;
  }

  /**
   * Fetch a FinMind dataset. Returns raw rows or empty array on token-missing fallback.
   * Token is never logged.
   */
  private async _fetch<T>(
    dataset: string,
    stockId: string,
    startDate: string,
    endDate?: string | null
  ): Promise<T[]> {
    const token = this._getToken();
    if (!token) {
      console.warn(`[finmind-client] FINMIND_API_TOKEN not set; dataset=${dataset} stockId=${stockId} → empty (mock fallback)`);
      return [];
    }

    if (finMindCircuitOpen()) {
      _circuitSkipCount++;
      const now = Date.now();
      if (now - _lastCircuitSkipLogMs > 60_000) {
        _lastCircuitSkipLogMs = now;
        console.warn(
          `[finmind-client] circuit open; skipping upstream requests until ${finMindCircuitOpenUntilIso()}`
        );
      }
      return [];
    }

    const url = this._buildUrl(dataset, stockId, startDate, endDate);
    // Build a log-safe URL (strip token)
    const logUrl = url.replace(/token=[^&]+/, "token=<REDACTED>");

    let response: Response;
    try {
      response = await fetchWithRetry(url, 3, token);
    } catch (err) {
      console.warn(`[finmind-client] fetch failed for ${logUrl}:`, err instanceof Error ? err.message : String(err));
      if (err instanceof FinMindRateLimitError) {
        openFinMindCircuit(dataset, 429, err.message);
      }
      recordFinMindRequest({ dataset, ok: false });
      return [];
    }

    if (!response.ok) {
      let upstreamMsg: string | null = null;
      try {
        const body = await response.clone().json() as { msg?: unknown; message?: unknown };
        upstreamMsg = typeof body.msg === "string"
          ? body.msg
          : typeof body.message === "string"
            ? body.message
            : null;
      } catch {
        // Response body may be empty or non-JSON.
      }
      console.warn(`[finmind-client] HTTP ${response.status} for ${logUrl}${upstreamMsg ? ` msg=${upstreamMsg}` : ""}`);
      if (response.status >= 400 && response.status < 500) {
        openFinMindCircuit(dataset, response.status, upstreamMsg);
      }
      recordFinMindRequest({ dataset, ok: false });
      return [];
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      recordFinMindRequest({ dataset, ok: false });
      throw new FinMindParseError(`Failed to parse JSON for ${dataset}/${stockId}`, err);
    }

    const typed = json as FinMindResponse<T>;
    if (typed.status !== 200) {
      console.warn(`[finmind-client] API status ${typed.status} for ${dataset}/${stockId}: ${typed.msg}`);
      recordFinMindRequest({ dataset, ok: false });
      return [];
    }

    recordFinMindRequest({ dataset, ok: true });
    return typed.data ?? [];
  }

  // ── getStockPriceAdj → OhlcvBar[] ─────────────────────────────────────────

  private _priceRowsToBars(rows: FinMindPriceAdjRow[]): OhlcvBar[] {
    return rows.map(r => ({
      dt: r.date,
      open: r.open,
      high: r.max,
      low: r.min,
      close: r.close,
      volume: r.Trading_Volume,
      source: "tej" as const  // FinMind data is TEJ-sourced; not KGI
    })).sort((a, b) => a.dt.localeCompare(b.dt));
  }

  /**
   * Fetch OHLCV bars from TaiwanStockPriceAdj, falling back to TaiwanStockPrice.
   * Returns OhlcvBar[] sorted ascending by date.
   * Falls back to empty array (source=mock upstream) when token missing.
   */
  async getStockPriceAdj(stockId: string, startDate: string, endDate?: string | null): Promise<OhlcvBar[]> {
    const endKey = endDate ?? "latest";
    const cacheKey = `finmind:ohlcv:${stockId}:${startDate}:${endKey}`;
    const shouldRawFill = shouldAttemptLatestRawFill(startDate, endDate);

    // Cache read
    if (!shouldRawFill) {
      const cached = await cacheGet(cacheKey, this._redisOverride);
      if (cached) {
        try {
          return JSON.parse(cached) as OhlcvBar[];
        } catch {
          // bad cache entry — fall through to fetch
        }
      }
    }

    let rows = await this._fetch<FinMindPriceAdjRow>(
      "TaiwanStockPriceAdj",
      stockId,
      startDate,
      endDate
    );

    if (this._getToken()) {
      if (rows.length === 0) {
        rows = await this._fetch<FinMindPriceAdjRow>(
          "TaiwanStockPrice",
          stockId,
          startDate,
          endDate
        );
      } else if (shouldRawFill) {
        const rawRows = await this._fetch<FinMindPriceAdjRow>(
          "TaiwanStockPrice",
          stockId,
          startDate,
          endDate
        );
        rows = appendNewerRawPriceRows(rows, rawRows);
      }
    }

    const bars = this._priceRowsToBars(rows);

    // Cache write (non-fatal)
    if (bars.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(bars), TTL_OHLCV, this._redisOverride);
    }

    return bars;
  }

  // ── KBar ───────────────────────────────────────────────────────────────────

  async getStockKBar(stockId: string, date: string): Promise<FinMindKBarRow[]> {
    const cacheKey = `finmind:kbar:${stockId}:${date}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindKBarRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindKBarRow>(
      "TaiwanStockKBar",
      stockId,
      date,
      date
    );

    const sorted = rows
      .filter((row) => row.date && row.minute)
      .sort((a, b) => `${a.date} ${a.minute}`.localeCompare(`${b.date} ${b.minute}`));

    if (sorted.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(sorted), TTL_KBAR, this._redisOverride);
    }

    return sorted;
  }

  // ── Financial Statements ───────────────────────────────────────────────────

  async getFinancialStatements(stockId: string, startDate: string, endDate: string): Promise<FinMindFinancialStatementsRow[]> {
    const cacheKey = `finmind:financial:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindFinancialStatementsRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindFinancialStatementsRow>(
      "TaiwanStockFinancialStatements",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_FINANCIAL, this._redisOverride);
    }
    return rows;
  }

  // ── Balance Sheet ──────────────────────────────────────────────────────────

  async getBalanceSheet(stockId: string, startDate: string, endDate: string): Promise<FinMindBalanceSheetRow[]> {
    const cacheKey = `finmind:balance:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindBalanceSheetRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindBalanceSheetRow>(
      "TaiwanStockBalanceSheet",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_FINANCIAL, this._redisOverride);
    }
    return rows;
  }

  // ── Cash Flow ─────────────────────────────────────────────────────────────

  async getCashFlow(stockId: string, startDate: string, endDate: string): Promise<FinMindCashFlowRow[]> {
    const cacheKey = `finmind:cashflow:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindCashFlowRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindCashFlowRow>(
      "TaiwanStockCashFlowsStatement",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_FINANCIAL, this._redisOverride);
    }
    return rows;
  }

  // ── Month Revenue ─────────────────────────────────────────────────────────

  async getMonthRevenue(stockId: string, startDate: string, endDate: string): Promise<FinMindMonthRevenueRow[]> {
    const cacheKey = `finmind:revenue:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindMonthRevenueRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindMonthRevenueRow>(
      "TaiwanStockMonthRevenue",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_CHIP, this._redisOverride);
    }
    return rows;
  }

  // ── Institutional Investors ───────────────────────────────────────────────

  async getInstitutionalInvestors(stockId: string, startDate: string, endDate: string): Promise<FinMindInstitutionalRow[]> {
    const cacheKey = `finmind:institutional:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindInstitutionalRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindInstitutionalRow>(
      "TaiwanStockInstitutionalInvestorsBuySell",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_CHIP, this._redisOverride);
    }
    return rows;
  }

  // ── Margin / Short Sale ───────────────────────────────────────────────────

  async getMarginShortSale(stockId: string, startDate: string, endDate: string): Promise<FinMindMarginShortRow[]> {
    const cacheKey = `finmind:margin:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindMarginShortRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindMarginShortRow>(
      "TaiwanStockMarginPurchaseShortSale",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_CHIP, this._redisOverride);
    }
    return rows;
  }

  // ── Dividend ──────────────────────────────────────────────────────────────

  async getDividend(stockId: string, startDate: string, endDate: string): Promise<FinMindDividendRow[]> {
    const cacheKey = `finmind:dividend:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindDividendRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindDividendRow>(
      "TaiwanStockDividend",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_DIVIDEND, this._redisOverride);
    }
    return rows;
  }

  // ── PER / PBR / dividend yield ────────────────────────────────────────────

  async getPER(stockId: string, startDate: string, endDate: string): Promise<FinMindPERRow[]> {
    const cacheKey = `finmind:per:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindPERRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindPERRow>(
      "TaiwanStockPER",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_FINANCIAL, this._redisOverride);
    }
    return rows;
  }

  // ── Market value ─────────────────────────────────────────────────────────

  async getMarketValue(stockId: string, startDate: string, endDate: string): Promise<FinMindMarketValueRow[]> {
    const cacheKey = `finmind:market-value:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindMarketValueRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindMarketValueRow>(
      "TaiwanStockMarketValue",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_FINANCIAL, this._redisOverride);
    }
    return rows;
  }

  // ── Foreign shareholding ──────────────────────────────────────────────────

  async getShareholding(stockId: string, startDate: string, endDate: string): Promise<FinMindShareholdingRow[]> {
    const cacheKey = `finmind:shareholding:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindShareholdingRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindShareholdingRow>(
      "TaiwanStockShareholding",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_CHIP, this._redisOverride);
    }
    return rows;
  }

  // ── Stock News [EXPERIMENTAL] ─────────────────────────────────────────────
  // TaiwanStockNews — 30min incremental pull (last 24h).
  // Availability depends on sponsor tier; may return empty on restricted accounts.
  // Callers MUST treat empty response as state=DEGRADED, not as an error.

  async getStockNews(stockId: string, startDate: string, endDate: string): Promise<FinMindNewsRow[]> {
    const cacheKey = `finmind:news:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindNewsRow[]; } catch { /* fall through */ }
    }

    // FinMind constraint: TaiwanStockNews rejects requests with end_date parameter
    // (HTTP 400: "the dataset TaiwanStockNews size is too large, we only send one day data,
    // so end_date parameter need be none"). Always omit end_date for this dataset.
    const rawRows = await this._fetch<FinMindNewsRawRow>(
      "TaiwanStockNews",
      stockId,
      startDate,
      null   // end_date must be omitted — FinMind constraint
    );

    // Map wire field "link" -> FinMindNewsRow.url, validating protocol on the way in
    // (external input) — this must happen before the row is ever cached/persisted.
    const rows: FinMindNewsRow[] = rawRows.map((raw) => ({
      date: raw.date,
      stock_id: raw.stock_id,
      title: raw.title,
      url: sanitizeNewsUrl(raw.link),
      source_name: raw.source_name
    }));

    // Short TTL for news — 5 min (reviewer keystone, needs freshness)
    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), 300, this._redisOverride);
    }
    return rows;
  }

  // ── Holding distribution ─────────────────────────────────────────────────

  async getHoldingSharesPer(stockId: string, startDate: string, endDate: string): Promise<FinMindHoldingSharesPerRow[]> {
    const cacheKey = `finmind:holding-shares-per:${stockId}:${startDate}:${endDate}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as FinMindHoldingSharesPerRow[]; } catch { /* fall through */ }
    }

    const rows = await this._fetch<FinMindHoldingSharesPerRow>(
      "TaiwanStockHoldingSharesPer",
      stockId,
      startDate,
      endDate
    );

    if (rows.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(rows), TTL_CHIP, this._redisOverride);
    }
    return rows;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _defaultClient: FinMindClient | null = null;

export function getFinMindClient(): FinMindClient {
  if (!_defaultClient) {
    _defaultClient = new FinMindClient();
  }
  return _defaultClient;
}

// ── Module-level request counters (F4: wire diagnostics) ─────────────────────
// Tracked here (not in server.ts) to avoid circular imports.
// server.ts diagnostics route reads via getFinMindStats().

let _requestCount = 0;
let _errorCount = 0;
let _lastFetchTs: string | null = null;
let _lastDataset: string | null = null;

/** Called after every FinMind HTTP fetch attempt. */
export function recordFinMindRequest(opts: { dataset: string; ok: boolean }): void {
  _requestCount++;
  if (!opts.ok) _errorCount++;
  _lastFetchTs = new Date().toISOString();
  _lastDataset = opts.dataset;
}

export function getFinMindStats(): {
  requestCount: number;
  errorCount: number;
  lastFetchTs: string | null;
  lastDataset: string | null;
  circuitOpen: boolean;
  circuitOpenUntil: string | null;
  circuitReason: string | null;
  circuitDataset: string | null;
  circuitOpenedAt: string | null;
  circuitSkipCount: number;
  forbiddenCount: number;
} {
  return {
    requestCount: _requestCount,
    errorCount: _errorCount,
    lastFetchTs: _lastFetchTs,
    lastDataset: _lastDataset,
    circuitOpen: finMindCircuitOpen(),
    circuitOpenUntil: finMindCircuitOpenUntilIso(),
    circuitReason: _lastCircuitReason,
    circuitDataset: _lastCircuitDataset,
    circuitOpenedAt: _lastCircuitOpenedAt,
    circuitSkipCount: _circuitSkipCount,
    forbiddenCount: _forbiddenCount
  };
}

/** Reset counters — used in tests. */
export function _resetFinMindStats(): void {
  _requestCount = 0;
  _errorCount = 0;
  _lastFetchTs = null;
  _lastDataset = null;
  _circuitOpenUntilMs = 0;
  _lastCircuitOpenedAt = null;
  _lastCircuitReason = null;
  _lastCircuitDataset = null;
  _forbiddenCount = 0;
  _circuitSkipCount = 0;
  _lastCircuitSkipLogMs = 0;
}
