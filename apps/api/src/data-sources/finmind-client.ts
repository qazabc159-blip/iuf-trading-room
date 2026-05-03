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
}

export interface FinMindBalanceSheetRow {
  date: string;
  stock_id: string;
  type: string;
  value: number;
}

export interface FinMindCashFlowRow {
  date: string;
  stock_id: string;
  type: string;
  value: number;
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
  ShortSaleBuy: number;
  ShortSaleSell: number;
  MarginPurchaseYesterday: number;
  MarginPurchaseToday: number;
  ShortSaleYesterday: number;
  ShortSaleToday: number;
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

// ── Cache TTL constants (seconds) ─────────────────────────────────────────────

const TTL_OHLCV     = 600;    // 10 min — refreshed daily but cache hits during day
const TTL_KBAR      = 300;    // 5 min — sponsor KBar is one-day payload
const TTL_FINANCIAL = 3600;   // 1h — quarterly data
const TTL_CHIP      = 1800;   // 30 min — institutional daily
const TTL_DIVIDEND  = 86400;  // 1d — rarely changes

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

async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "Accept": "application/json" },
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

  private _buildUrl(dataset: string, stockId: string, startDate: string, endDate: string): string {
    const token = this._getToken();
    const params = new URLSearchParams({
      dataset,
      data_id: stockId,
      start_date: startDate,
      end_date: endDate
    });
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
    endDate: string
  ): Promise<T[]> {
    const token = this._getToken();
    if (!token) {
      console.warn(`[finmind-client] FINMIND_API_TOKEN not set; dataset=${dataset} stockId=${stockId} → empty (mock fallback)`);
      return [];
    }

    const url = this._buildUrl(dataset, stockId, startDate, endDate);
    // Build a log-safe URL (strip token)
    const logUrl = url.replace(/token=[^&]+/, "token=<REDACTED>");

    let response: Response;
    try {
      response = await fetchWithRetry(url, 3);
    } catch (err) {
      console.warn(`[finmind-client] fetch failed for ${logUrl}:`, err instanceof Error ? err.message : String(err));
      return [];
    }

    if (!response.ok) {
      console.warn(`[finmind-client] HTTP ${response.status} for ${logUrl}`);
      return [];
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new FinMindParseError(`Failed to parse JSON for ${dataset}/${stockId}`, err);
    }

    const typed = json as FinMindResponse<T>;
    if (typed.status !== 200) {
      console.warn(`[finmind-client] API status ${typed.status} for ${dataset}/${stockId}: ${typed.msg}`);
      return [];
    }

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
  async getStockPriceAdj(stockId: string, startDate: string, endDate: string): Promise<OhlcvBar[]> {
    const cacheKey = `finmind:ohlcv:${stockId}:${startDate}:${endDate}`;

    // Cache read
    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try {
        return JSON.parse(cached) as OhlcvBar[];
      } catch {
        // bad cache entry — fall through to fetch
      }
    }

    let rows = await this._fetch<FinMindPriceAdjRow>(
      "TaiwanStockPriceAdj",
      stockId,
      startDate,
      endDate
    );

    if (rows.length === 0 && this._getToken()) {
      rows = await this._fetch<FinMindPriceAdjRow>(
        "TaiwanStockPrice",
        stockId,
        startDate,
        endDate
      );
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
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _defaultClient: FinMindClient | null = null;

export function getFinMindClient(): FinMindClient {
  if (!_defaultClient) {
    _defaultClient = new FinMindClient();
  }
  return _defaultClient;
}
