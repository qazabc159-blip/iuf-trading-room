/**
 * finmind-aggregate-client.ts — BG #2: FinMind whole-market aggregate queries
 *
 * This module provides whole-market (all-stocks) FinMind data for:
 *   - Industry heatmap aggregate (TaiwanStockPrice, full market)
 *   - Market breadth / advance-decline (TaiwanStockPrice)
 *   - Leaders: top gainers / losers / most active (TaiwanStockPrice)
 *   - 三大法人 institutional buy/sell summary (TaiwanStockInstitutionalInvestorsBuySell)
 *   - 融資融券 margin/short summary (TaiwanStockMarginPurchaseShortSale)
 *   - Stock news top-N (TaiwanStockNews)
 *
 * FinMind whole-market query pattern:
 *   GET https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice
 *       &start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&token=...
 *   (no data_id = all stocks for that date range)
 *
 * Source chain priority (per panel):
 *   Primary:   FinMind sponsor (6000 req/hr; today's data after 14:00 TST)
 *   Secondary: TWSE OpenAPI EOD (fallback; caller wires this at the route level)
 *   Tertiary:  KGI tick (40-cap, EC2 open hours; separate path)
 *
 * Hard lines:
 *   - Token ONLY from process.env.FINMIND_API_TOKEN
 *   - Token NEVER written to logs, Redis, Postgres, or response body
 *   - No token → return null (caller falls back to TWSE)
 *   - 60s in-memory cache per query (FinMind data stable after 14:00 TST)
 *   - Promise coalescing: concurrent callers share one inflight fetch per query key
 *   - Fail-open: errors return null (caller does fallback, never 5xx from here)
 *   - No KGI SDK import
 *   - No broker write surface
 *   - No contracts change
 *   - No DB migration
 *   - No apps/web/* change
 *   - NOT touching index path (BG #1 lane: twse-openapi-client.ts index path)
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const FINMIND_BASE_URL = "https://api.finmindtrade.com/api/v4/data";
const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const FETCH_TIMEOUT_MS = 15_000; // 15s — whole-market payloads can be large (~1700 rows)
const TOP_N = 5;                  // leaders: top 5 gainers / losers / active

// ── Raw FinMind row types (whole-market shape) ────────────────────────────────

/** Row from TaiwanStockPrice whole-market query */
export interface FinMindWholePriceRow {
  date: string;         // 'YYYY-MM-DD'
  stock_id: string;
  Trading_Volume: number;
  Trading_money: number; // 成交金額 (TWD)
  open: number;
  max: number;
  min: number;
  close: number;
  spread: number;       // absolute price change (close - prev_close)
  Trading_turnover: number;
}

/** Row from TaiwanStockInstitutionalInvestorsBuySell whole-market query */
export interface FinMindWholeInstitutionalRow {
  date: string;         // 'YYYY-MM-DD'
  stock_id: string;
  name: string;         // '外陸資' | '投信' | '自營商' | '自營商(自行買賣)' | '自營商(避險)'
  buy: number;
  sell: number;
}

/** Row from TaiwanStockMarginPurchaseShortSale whole-market query */
export interface FinMindWholeMarginRow {
  date: string;
  stock_id: string;
  MarginPurchaseBuy: number;
  MarginPurchaseSell: number;
  MarginPurchaseTodayBalance?: number;
  MarginPurchaseYesterdayBalance?: number;
  ShortSaleBuy: number;
  ShortSaleSell: number;
  ShortSaleTodayBalance?: number;
  ShortSaleYesterdayBalance?: number;
}

/** Row from TaiwanStockNews whole-market query */
export interface FinMindWholeNewsRow {
  date: string;         // 'YYYY-MM-DD HH:mm:ss' or 'YYYY-MM-DD'
  stock_id: string;
  title: string;
  url?: string;
  source_name?: string;
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface FinMindHeatmapTile {
  industry: string;
  avgChangePct: number;
  gainerCount: number;
  loserCount: number;
  flatCount: number;
  stockCount: number;
  source: "finmind";
}

export interface FinMindBreadthResult {
  up: number;
  down: number;
  flat: number;
  total: number;
  asOf: string | null;   // ISO 8601 Taipei timestamp of the data date
  source: "finmind";
  staleAfterSec: 60;
}

export interface FinMindLeaderStock {
  stockId: string;
  close: number;
  change: number;
  changePct: number;
  volume: number;       // Trading_money (成交金額 TWD)
  source: "finmind";
}

export interface FinMindLeadersResult {
  topGainers: FinMindLeaderStock[];
  topLosers: FinMindLeaderStock[];
  mostActive: FinMindLeaderStock[];
  asOf: string | null;
  source: "finmind";
  staleAfterSec: 60;
}

/** Per-institution line for institutional summary */
export interface FinMindInstitutionLine {
  name: string;         // '外陸資' | '投信' | '自營商'
  buy: number;
  sell: number;
  net: number;
}

export interface FinMindInstitutionalSummaryResult {
  asOf: string | null;
  totalNet: number;
  institutions: FinMindInstitutionLine[];
  /** Top net-buy stocks (top 5 by net buy across all institutions) */
  topNetBuy: Array<{ stockId: string; net: number }>;
  /** Top net-sell stocks (top 5 by net sell) */
  topNetSell: Array<{ stockId: string; net: number }>;
  source: "finmind";
  staleAfterSec: 60;
}

export interface FinMindMarginSummaryResult {
  asOf: string | null;
  marginBalance: number;   // 融資餘額 (sum of MarginPurchaseTodayBalance)
  shortBalance: number;    // 融券餘額
  marginNet: number;       // marginBalance - shortBalance
  source: "finmind";
  staleAfterSec: 60;
}

export interface FinMindNewsItem {
  date: string;
  stockId: string;
  title: string;
  url: string | null;
  sourceName: string | null;
}

export interface FinMindNewsResult {
  items: FinMindNewsItem[];
  asOf: string | null;
  source: "finmind";
  staleAfterSec: 60;
}

// ── In-memory cache (promise-coalescing) ─────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry<unknown>>();
const _inflight = new Map<string, Promise<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.value;
}

function setCached<T>(key: string, value: T): void {
  _cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** For test cleanup */
export function _resetFinMindAggregateCache(): void {
  _cache.clear();
  _inflight.clear();
}

// ── Token helper ──────────────────────────────────────────────────────────────

function getToken(): string | null {
  return process.env.FINMIND_API_TOKEN ?? null;
}

function hasToken(): boolean {
  return Boolean(getToken());
}

// ── Core fetch — whole-market, no data_id ────────────────────────────────────

interface FinMindResponse<T> {
  status: number;
  msg: string;
  data: T[];
}

/**
 * Fetch a FinMind dataset WITHOUT data_id — returns all stocks for the date range.
 * Token is never logged. Returns empty array on any error.
 */
async function fetchWholeMarket<T>(
  dataset: string,
  date: string,
  endDate?: string
): Promise<T[]> {
  const token = getToken();
  if (!token) {
    console.warn(`[finmind-aggregate-client] FINMIND_API_TOKEN not set; dataset=${dataset} → empty (no token fallback)`);
    return [];
  }

  const cacheKey = `finmind-agg:${dataset}:${date}:${endDate ?? ""}`;

  // Dedup: reuse inflight promise
  const existingInflight = _inflight.get(cacheKey);
  if (existingInflight) return existingInflight as Promise<T[]>;

  // Cache check before launching fetch
  const cachedVal = getCached<T[]>(cacheKey);
  if (cachedVal !== null) return cachedVal;

  const promise = (async (): Promise<T[]> => {
    const params = new URLSearchParams({
      dataset,
      start_date: date,
      token
    });
    if (endDate) params.set("end_date", endDate);
    const url = `${FINMIND_BASE_URL}?${params.toString()}`;
    const logUrl = url.replace(/token=[^&]+/, "token=<REDACTED>");

    try {
      const resp = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if (!resp.ok) {
        console.warn(`[finmind-aggregate-client] HTTP ${resp.status} for ${logUrl}`);
        return [];
      }

      let json: unknown;
      try {
        json = await resp.json();
      } catch {
        console.warn(`[finmind-aggregate-client] JSON parse failed for ${logUrl}`);
        return [];
      }

      const typed = json as FinMindResponse<T>;
      if (typed.status !== 200) {
        console.warn(`[finmind-aggregate-client] API status ${typed.status} for ${dataset}: ${typed.msg}`);
        return [];
      }

      const rows: T[] = typed.data ?? [];
      setCached(cacheKey, rows);
      return rows;
    } catch (err) {
      console.warn(
        `[finmind-aggregate-client] fetch failed for ${logUrl}:`,
        err instanceof Error ? err.message : String(err)
      );
      return [];
    } finally {
      _inflight.delete(cacheKey);
    }
  })();

  _inflight.set(cacheKey, promise);
  return promise;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute changePct from spread (absolute change) and close */
function spreadToChangePct(close: number, spread: number): number {
  const prevClose = close - spread;
  if (!isFinite(close) || !isFinite(spread) || prevClose === 0) return 0;
  return Math.round((spread / prevClose) * 10000) / 100;
}

/** Today's date in Taipei time as YYYY-MM-DD */
function todayTaipei(): string {
  // Taipei = UTC+8
  const now = new Date();
  const offset = 8 * 60;
  const local = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60_000);
  return local.toISOString().slice(0, 10);
}

// ── getFinMindWholeMarketPrice ────────────────────────────────────────────────

/**
 * Fetch TaiwanStockPrice for all stocks on a given date.
 * Default: today's date (Taipei time).
 */
export async function getFinMindWholeMarketPrice(
  date?: string
): Promise<FinMindWholePriceRow[]> {
  const d = date ?? todayTaipei();
  return fetchWholeMarket<FinMindWholePriceRow>("TaiwanStockPrice", d, d);
}

// ── Industry Heatmap ──────────────────────────────────────────────────────────

/**
 * Aggregate TaiwanStockPrice into industry heatmap tiles.
 * Requires tickerToIndustry mapping (from companies DB, chainPosition).
 * Returns null when FinMind token absent (caller falls back to TWSE).
 */
export async function getFinMindIndustryHeatmap(
  tickerToIndustry: Map<string, string>,
  date?: string
): Promise<FinMindHeatmapTile[] | null> {
  if (!hasToken()) return null;

  const rows = await getFinMindWholeMarketPrice(date);
  if (rows.length === 0) return null;

  const asOf = date ?? todayTaipei();

  // Aggregate by industry
  const industryMap = new Map<string, {
    changes: number[];
    gainers: number;
    losers: number;
    flats: number;
  }>();

  for (const row of rows) {
    const industry = tickerToIndustry.get(row.stock_id);
    if (!industry) continue;

    const changePct = spreadToChangePct(row.close, row.spread);

    if (!industryMap.has(industry)) {
      industryMap.set(industry, { changes: [], gainers: 0, losers: 0, flats: 0 });
    }
    const bucket = industryMap.get(industry)!;
    bucket.changes.push(changePct);
    if (changePct > 0.05) bucket.gainers++;
    else if (changePct < -0.05) bucket.losers++;
    else bucket.flats++;
  }

  if (industryMap.size === 0) return null;

  const tiles: FinMindHeatmapTile[] = [];
  for (const [industry, data] of industryMap) {
    if (data.changes.length === 0) continue;
    const avg = data.changes.reduce((s, v) => s + v, 0) / data.changes.length;
    tiles.push({
      industry,
      avgChangePct: Math.round(avg * 100) / 100,
      gainerCount: data.gainers,
      loserCount: data.losers,
      flatCount: data.flats,
      stockCount: data.changes.length,
      source: "finmind"
    });
  }

  // Sort by |avgChangePct| descending
  tiles.sort((a, b) => Math.abs(b.avgChangePct) - Math.abs(a.avgChangePct));

  void asOf; // used for logging but tile shape doesn't carry it (tiles have source only)
  return tiles;
}

// ── Market Breadth ────────────────────────────────────────────────────────────

/**
 * Compute advance/decline/flat counts from TaiwanStockPrice.
 * Returns null when FinMind token absent.
 */
/**
 * Taiwan listed-stock universe filter for breadth.
 * FinMind TaiwanStockPrice whole-market returns the ENTIRE instrument universe —
 * ~17k 6-digit warrants/options dwarf the ~2.4k real stocks, inflating any naive
 * advance/decline count to ~8000 up (verified 2026-06-17). Listed common stocks
 * are 4-digit (2330, 0050); ETFs are 00-prefixed (00878, 006208). Warrants are
 * 6-digit and never start "00", so this cleanly excludes them.
 */
function isListedStockId(stockId: string): boolean {
  return /^\d{4}$/.test(stockId) || /^00\d{2,4}$/.test(stockId);
}

export async function getFinMindMarketBreadth(
  date?: string
): Promise<FinMindBreadthResult | null> {
  if (!hasToken()) return null;

  const d = date ?? todayTaipei();
  const rows = await getFinMindWholeMarketPrice(d);
  if (rows.length === 0) return null;

  let up = 0, down = 0, flat = 0;
  let asOf: string | null = null;

  for (const row of rows) {
    if (!isListedStockId(String(row.stock_id))) continue; // exclude warrants/options
    if (!isFinite(row.close) || row.close <= 0) continue;
    const changePct = spreadToChangePct(row.close, row.spread);
    if (changePct > 0) up++;
    else if (changePct < 0) down++;
    else flat++;
    if (!asOf && row.date) {
      asOf = `${row.date}T13:30:00+08:00`;
    }
  }

  const total = up + down + flat;
  if (total === 0) return null;

  return { up, down, flat, total, asOf, source: "finmind", staleAfterSec: 60 };
}

// ── Leaders (gainers / losers / active) ──────────────────────────────────────

/**
 * Compute top gainers / losers / most active from TaiwanStockPrice.
 * Returns null when FinMind token absent.
 */
export async function getFinMindLeaders(
  date?: string,
  topN?: number
): Promise<FinMindLeadersResult | null> {
  if (!hasToken()) return null;

  const d = date ?? todayTaipei();
  const rows = await getFinMindWholeMarketPrice(d);
  if (rows.length === 0) return null;

  const n = topN ?? TOP_N;
  let asOf: string | null = null;

  const enriched = rows
    .filter(row => isFinite(row.close) && row.close > 0)
    .map(row => {
      if (!asOf && row.date) asOf = `${row.date}T13:30:00+08:00`;
      return {
        stockId: row.stock_id,
        close: row.close,
        change: row.spread,
        changePct: spreadToChangePct(row.close, row.spread),
        volume: row.Trading_money,
        source: "finmind" as const
      };
    });

  if (enriched.length === 0) return null;

  const topGainers = [...enriched]
    .filter(r => r.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, n);

  const topLosers = [...enriched]
    .filter(r => r.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, n);

  const mostActive = [...enriched]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, n);

  return { topGainers, topLosers, mostActive, asOf, source: "finmind", staleAfterSec: 60 };
}

// ── Institutional Buy/Sell Summary ────────────────────────────────────────────

/**
 * Fetch TaiwanStockInstitutionalInvestorsBuySell for all stocks today.
 * Aggregates into per-institution buy/sell/net + top stock net-buy/sell rankings.
 * Returns null when FinMind token absent.
 */
export async function getFinMindInstitutionalSummary(
  date?: string
): Promise<FinMindInstitutionalSummaryResult | null> {
  if (!hasToken()) return null;

  const d = date ?? todayTaipei();
  const rows = await fetchWholeMarket<FinMindWholeInstitutionalRow>(
    "TaiwanStockInstitutionalInvestorsBuySell",
    d, d
  );
  if (rows.length === 0) return null;

  // Aggregate per institution name
  const instMap = new Map<string, { buy: number; sell: number }>();
  // Aggregate per stock (net across all institutions)
  const stockNetMap = new Map<string, number>();

  let asOf: string | null = null;

  for (const row of rows) {
    if (!asOf && row.date) asOf = `${row.date}T13:30:00+08:00`;

    // Normalize institution names to 3 canonical buckets
    const name = normalizeInstName(row.name);
    if (!instMap.has(name)) instMap.set(name, { buy: 0, sell: 0 });
    const inst = instMap.get(name)!;
    inst.buy += row.buy || 0;
    inst.sell += row.sell || 0;

    // Per-stock net (all institutions combined)
    const net = (row.buy || 0) - (row.sell || 0);
    stockNetMap.set(row.stock_id, (stockNetMap.get(row.stock_id) ?? 0) + net);
  }

  const institutions: FinMindInstitutionLine[] = [];
  let totalNet = 0;
  for (const [name, { buy, sell }] of instMap) {
    const net = buy - sell;
    totalNet += net;
    institutions.push({ name, buy, sell, net });
  }
  institutions.sort((a, b) => b.net - a.net);

  // Top net-buy / net-sell stocks
  const stockNetArr = [...stockNetMap.entries()].map(([stockId, net]) => ({ stockId, net }));
  const topNetBuy = [...stockNetArr].sort((a, b) => b.net - a.net).slice(0, TOP_N);
  const topNetSell = [...stockNetArr].sort((a, b) => a.net - b.net).slice(0, TOP_N);

  return {
    asOf,
    totalNet,
    institutions,
    topNetBuy,
    topNetSell,
    source: "finmind",
    staleAfterSec: 60
  };
}

/** Normalize FinMind institutional name to 3 buckets */
function normalizeInstName(raw: string): string {
  if (!raw) return "其他";
  if (raw.includes("外") || raw.includes("QFII")) return "外陸資";
  if (raw.includes("投信")) return "投信";
  if (raw.includes("自營")) return "自營商";
  return raw;
}

// ── Margin / Short Sale Summary ───────────────────────────────────────────────

/**
 * Fetch TaiwanStockMarginPurchaseShortSale for all stocks today.
 * Returns margin/short balance summary.
 * Returns null when FinMind token absent.
 */
export async function getFinMindMarginSummary(
  date?: string
): Promise<FinMindMarginSummaryResult | null> {
  if (!hasToken()) return null;

  const d = date ?? todayTaipei();
  const rows = await fetchWholeMarket<FinMindWholeMarginRow>(
    "TaiwanStockMarginPurchaseShortSale",
    d, d
  );
  if (rows.length === 0) return null;

  let asOf: string | null = null;
  let marginBalance = 0;
  let shortBalance = 0;

  for (const row of rows) {
    if (!asOf && row.date) asOf = `${row.date}T13:30:00+08:00`;
    marginBalance += row.MarginPurchaseTodayBalance ?? row.MarginPurchaseBuy ?? 0;
    shortBalance += row.ShortSaleTodayBalance ?? row.ShortSaleBuy ?? 0;
  }

  return {
    asOf,
    marginBalance,
    shortBalance,
    marginNet: marginBalance - shortBalance,
    source: "finmind",
    staleAfterSec: 60
  };
}

// ── Stock News (whole-market, today) ─────────────────────────────────────────

/**
 * Fetch TaiwanStockNews for the latest N items from today.
 * FinMind constraint: TaiwanStockNews ignores end_date for the all-market path.
 * Returns null when FinMind token absent.
 */
export async function getFinMindMarketNews(
  date?: string,
  limit = 10
): Promise<FinMindNewsResult | null> {
  if (!hasToken()) return null;

  const d = date ?? todayTaipei();
  // FinMind TaiwanStockNews constraint: no end_date for whole-market (send one-day data only)
  const rows = await fetchWholeMarket<FinMindWholeNewsRow>("TaiwanStockNews", d);
  if (rows.length === 0) return null;

  // Sort by date descending, deduplicate by title
  const seen = new Set<string>();
  const sorted = [...rows].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const items: FinMindNewsItem[] = [];
  let asOf: string | null = null;

  for (const row of sorted) {
    if (seen.has(row.title)) continue;
    seen.add(row.title);
    if (!asOf && row.date) asOf = row.date;
    items.push({
      date: row.date,
      stockId: row.stock_id,
      title: row.title,
      url: row.url ?? null,
      sourceName: row.source_name ?? null
    });
    if (items.length >= limit) break;
  }

  return { items, asOf, source: "finmind", staleAfterSec: 60 };
}

// ── Token availability check (for route-level fallback decision) ──────────────
export function finMindAggregateHasToken(): boolean {
  return hasToken();
}
