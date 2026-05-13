/**
 * twse-openapi-client.ts — W7 H4: TWSE OpenAPI adapter
 *
 * TWSE OpenAPI provides official Taiwan Stock Exchange data with no auth required.
 * Base URL: https://openapi.twse.com.tw/v1/
 * TPEX (OTC) Base URL: https://www.tpex.org.tw/openapi/v1/
 *
 * Hard lines:
 *   - No auth required, no secrets
 *   - No KGI SDK import
 *   - Cache failure MUST NOT block response (fail-open)
 *   - Cache TTL: 1800s (30 min) for most endpoints; 60s for market overview
 *   - Empty array / null returned on any error (never throw to callers)
 *   - Rate limit friendly: TWSE endpoints are low-traffic official API
 *   - 5s timeout per request, 1 retry on network error
 *
 * Datasets:
 *   - 重大訊息 (Material Announcements) — /opendata/t187ap46_L (by stock_id)
 *   - 公司治理 (Corporate Governance) — /opendata/t187ap46_L_2
 *   - ESG 揭露 — /opendata/t187ap46_L_1
 *   - 大盤指數 (Market Overview) — /exchangeReport/MI_INDEX
 *   - 個股日成交 (Stock Day All) — /exchangeReport/STOCK_DAY_ALL
 *   - OTC 個股收盤 (TPEX Daily) — tpex_mainboard_daily_close_quotes
 */

import { createClient } from "redis";

// ── Base URLs ─────────────────────────────────────────────────────────────────

const TWSE_BASE_URL = "https://openapi.twse.com.tw/v1";
const TPEX_BASE_URL = "https://www.tpex.org.tw/openapi/v1";
const CACHE_TTL_SECONDS = 1800; // 30 min
const OVERVIEW_CACHE_TTL_SECONDS = 60; // 60s for market overview (near-real-time)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MaterialAnnouncementRow {
  /** Trading date YYYY/MM/DD */
  Date: string;
  /** Stock code e.g. "2330" */
  Code: string;
  /** Company name */
  Name: string;
  /** Announcement title */
  Title: string;
  /** Announcement content */
  Content: string;
  /** Announcement link URL */
  Link?: string;
}

export interface CorpGovernanceRow {
  Code: string;
  Name: string;
  [key: string]: string;
}

export interface ESGDisclosureRow {
  Code: string;
  Name: string;
  [key: string]: string;
}

// ── In-memory fallback cache (when Redis unavailable) ─────────────────────────

interface CacheClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, ttl: number, value: string): Promise<unknown>;
}

let _twseRedisClient: ReturnType<typeof createClient> | null = null;
let _twseRedisConnectPromise: Promise<ReturnType<typeof createClient> | null> | null = null;

async function getTwseRedisClient(): Promise<CacheClient | null> {
  const url = process.env.REDIS_URL ?? null;
  if (!url) return null;

  if (_twseRedisClient?.isReady) return _twseRedisClient as unknown as CacheClient;
  if (_twseRedisConnectPromise) return _twseRedisConnectPromise as unknown as Promise<CacheClient | null>;

  _twseRedisConnectPromise = (async () => {
    const client = createClient({
      url,
      socket: { reconnectStrategy: (n: number) => Math.min(n * 200, 3_000) }
    });
    client.on("error", (e: Error) => console.warn("[twse-openapi-client] Redis error", e.message));
    await client.connect();
    _twseRedisClient = client;
    _twseRedisConnectPromise = null;
    return client;
  })().catch((e: unknown) => {
    console.warn("[twse-openapi-client] Redis connect failed:", e instanceof Error ? e.message : String(e));
    _twseRedisConnectPromise = null;
    return null;
  });

  return _twseRedisConnectPromise as unknown as Promise<CacheClient | null>;
}

// Module-level in-memory fallback (when Redis unavailable)
const _memCache = new Map<string, { value: string; expiresAt: number }>();

async function cacheGet(key: string, clientOverride?: CacheClient | null): Promise<string | null> {
  try {
    const client = clientOverride !== undefined ? clientOverride : await getTwseRedisClient();
    if (client) {
      return await Promise.race([
        client.get(key),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
      ]);
    }
    // Fallback: in-memory cache
    const entry = _memCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { _memCache.delete(key); return null; }
    return entry.value;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: string, ttl: number, clientOverride?: CacheClient | null): Promise<void> {
  try {
    const client = clientOverride !== undefined ? clientOverride : await getTwseRedisClient();
    if (client) {
      await Promise.race([
        client.setEx(key, ttl, value),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 500))
      ]);
      return;
    }
    // Fallback: in-memory cache
    _memCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  } catch {
    // cache failure is non-fatal
  }
}

// ── Fetch helper (simple, no auth) ────────────────────────────────────────────

async function fetchTwse<T>(path: string): Promise<T[]> {
  const url = `${TWSE_BASE_URL}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (err) {
    console.warn(`[twse-openapi-client] fetch error for ${path}:`, err instanceof Error ? err.message : String(err));
    return [];
  }

  if (!response.ok) {
    console.warn(`[twse-openapi-client] HTTP ${response.status} for ${path}`);
    return [];
  }

  // Guard: TWSE maintenance windows can return HTML with HTTP 200.
  // Detect non-JSON responses before attempting parse.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const err = new Error(
      `[twse-openapi-client] upstream_returned_non_json for ${path}: content-type=${contentType}`
    );
    err.name = "TwseNonJsonError";
    console.warn(err.message);
    throw err;
  }

  try {
    const json = await response.json() as T[];
    return Array.isArray(json) ? json : [];
  } catch (e) {
    // Re-throw TwseNonJsonError so handler can classify state=DEGRADED
    if (e instanceof Error && e.name === "TwseNonJsonError") throw e;
    console.warn(`[twse-openapi-client] JSON parse error for ${path}`);
    return [];
  }
}

// ── TPEX Fetch helper (follow redirect, same guards) ─────────────────────────

async function fetchTpex<T>(path: string): Promise<T[]> {
  const url = `${TPEX_BASE_URL}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5_000),
      redirect: "follow"
    });
  } catch (err) {
    // 1 retry on network error
    try {
      response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5_000),
        redirect: "follow"
      });
    } catch (err2) {
      console.warn(`[twse-openapi-client] TPEX fetch error for ${path}:`, err2 instanceof Error ? err2.message : String(err2));
      return [];
    }
  }

  if (!response.ok) {
    console.warn(`[twse-openapi-client] TPEX HTTP ${response.status} for ${path}`);
    return [];
  }

  try {
    const json = await response.json() as T[];
    return Array.isArray(json) ? json : [];
  } catch {
    console.warn(`[twse-openapi-client] TPEX JSON parse error for ${path}`);
    return [];
  }
}

// ── Market Overview types ─────────────────────────────────────────────────────

/**
 * Row from TWSE MI_INDEX endpoint (Chinese field names)
 * 日期 = ROC date e.g. "1150512"
 * 指數 = Index name
 * 收盤指數 = Closing value
 * 漲跌 = Direction symbol "+" or "-"
 * 漲跌點數 = Point change (absolute)
 * 漲跌百分比 = Change pct string e.g. "0.26"
 */
export interface MiIndexRow {
  "日期": string;
  "指數": string;
  "收盤指數": string;
  "漲跌": string;
  "漲跌點數": string;
  "漲跌百分比": string;
  "特殊處理註記"?: string;
}

/**
 * Row from TWSE STOCK_DAY_ALL endpoint (English field names)
 * Change = absolute price change (may be negative number like "-0.0500")
 * Does NOT contain changePct — must compute from Change / (ClosingPrice - Change)
 */
export interface StockDayAllRow {
  Date: string;
  Code: string;
  Name: string;
  TradeVolume: string;
  TradeValue: string;
  OpeningPrice: string;
  HighestPrice: string;
  LowestPrice: string;
  ClosingPrice: string;
  Change: string;
  Transaction: string;
}

/**
 * Row from TPEX mainboard daily close quotes
 * Change may have leading "+" e.g. "+0.94" or "-0.08 " (note trailing space)
 */
export interface TpexDailyRow {
  Date: string;
  SecuritiesCompanyCode: string;
  CompanyName: string;
  Close: string;
  Change: string;
  Open: string;
  High: string;
  Low: string;
  Average: string;
  TradingShares: string;
  TransactionAmount: string;
  TransactionNumber: string;
  LatestBidPrice?: string;
  LatesAskPrice?: string;
  Capitals?: string;
}

/** Output shape for TAIEX/OTC market overview */
export interface TwseIndexSnapshot {
  /** Index value */
  value: number;
  /** Absolute point change */
  change: number;
  /** Percentage change e.g. 0.26 */
  changePct: number;
  /** ISO 8601 timestamp (Taipei time, end-of-day for closed market) */
  ts: string;
}

export interface TwseMarketOverviewResult {
  taiex: TwseIndexSnapshot;
  otc: TwseIndexSnapshot | null;
  source: "twse_openapi";
  staleAfterSec: 60;
}

/** Output shape for industry heatmap tile */
export interface TwseHeatmapTile {
  industry: string;
  avgChangePct: number;
  gainerCount: number;
  loserCount: number;
  flatCount: number;
  stockCount: number;
  source: "twse_openapi";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse ROC date "1150512" → ISO "2026-05-12"
 * ROC year + 1911 = Gregorian year
 */
function parseRocDate(rocDate: string): string {
  // Format: YYYMMDD where YYY is ROC year
  const s = rocDate.trim();
  if (s.length === 7) {
    const rocYear = parseInt(s.slice(0, 3), 10);
    const month = s.slice(3, 5);
    const day = s.slice(5, 7);
    const year = rocYear + 1911;
    return `${year}-${month}-${day}`;
  }
  return s; // fallback: return as-is
}

/**
 * Parse "1150512" → Taipei market-close ISO timestamp (T13:30:00+08:00)
 */
function rocDateToTaipeiTs(rocDate: string): string {
  const iso = parseRocDate(rocDate);
  return `${iso}T13:30:00+08:00`;
}

/**
 * Compute changePct from absolute change + closing price.
 * prevClose = close - change
 */
function computeChangePct(closingPrice: string, change: string): number {
  const close = parseFloat(closingPrice);
  // TWSE Change field: "20.0000" (positive=up), "-0.0500" (negative=down)
  // TPEX Change field: "+0.94", "-0.08 " (with possible leading + and trailing spaces)
  const chg = parseFloat(change.trim().replace(/^\+/, ""));
  if (!isFinite(close) || !isFinite(chg) || (close - chg) === 0) return 0;
  const prevClose = close - chg;
  return Math.round((chg / prevClose) * 10000) / 100; // round to 2 decimal places
}

// ── In-memory 1-min cache for market overview ─────────────────────────────────

interface OverviewCacheEntry {
  result: TwseMarketOverviewResult;
  expiresAt: number;
}

const _overviewCache = new Map<string, OverviewCacheEntry>();

function getOverviewCached(key: string): TwseMarketOverviewResult | null {
  const entry = _overviewCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _overviewCache.delete(key); return null; }
  return entry.result;
}

function setOverviewCache(key: string, result: TwseMarketOverviewResult): void {
  _overviewCache.set(key, { result, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_SECONDS * 1000 });
}

/** For test cleanup */
export function _resetTwseOverviewCache(): void {
  _overviewCache.clear();
}

// ── In-memory 1-min cache for heatmap ────────────────────────────────────────

interface HeatmapCacheEntry {
  tiles: TwseHeatmapTile[];
  expiresAt: number;
}

const _heatmapCache = new Map<string, HeatmapCacheEntry>();

function getHeatmapCached(key: string): TwseHeatmapTile[] | null {
  const entry = _heatmapCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _heatmapCache.delete(key); return null; }
  return entry.tiles;
}

function setHeatmapCache(key: string, tiles: TwseHeatmapTile[]): void {
  _heatmapCache.set(key, { tiles, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_SECONDS * 1000 });
}

/** For test cleanup */
export function _resetTwseHeatmapCache(): void {
  _heatmapCache.clear();
}

// ── Market Overview fetcher ───────────────────────────────────────────────────

/**
 * Fetch TAIEX + OTC market overview from TWSE OpenAPI.
 * TAIEX: MI_INDEX → 發行量加權股價指數
 * OTC: TPEX daily quotes breadth (synthetic — TPEX has no composite index API)
 *
 * Returns null on total failure (both TAIEX and OTC unavailable).
 * source label: "twse_openapi"
 * staleAfterSec: 60
 */
export async function getTwseMarketOverview(
  opts: { fetchOverride?: typeof fetch } = {}
): Promise<TwseMarketOverviewResult | null> {
  const CACHE_KEY = "twse:market:overview";
  const cached = getOverviewCached(CACHE_KEY);
  if (cached) return cached;

  // Use fetch override for tests, or global fetch
  const doFetch = opts.fetchOverride ?? globalThis.fetch;

  // ── TAIEX from MI_INDEX ────────────────────────────────────────────────────
  let taiex: TwseIndexSnapshot | null = null;
  try {
    const miUrl = `${TWSE_BASE_URL}/exchangeReport/MI_INDEX`;
    const resp = await doFetch(miUrl, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
    if (resp.ok) {
      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const rows = await resp.json() as MiIndexRow[];
        if (Array.isArray(rows)) {
          const taiexRow = rows.find(r => r["指數"] === "發行量加權股價指數");
          if (taiexRow) {
            const value = parseFloat(taiexRow["收盤指數"]);
            const chgSign = taiexRow["漲跌"] === "-" ? -1 : 1;
            const change = chgSign * parseFloat(taiexRow["漲跌點數"]);
            const changePct = chgSign * parseFloat(taiexRow["漲跌百分比"]);
            taiex = {
              value: Math.round(value * 100) / 100,
              change: Math.round(change * 100) / 100,
              changePct: Math.round(changePct * 100) / 100,
              ts: rocDateToTaipeiTs(taiexRow["日期"])
            };
          }
        }
      }
    }
  } catch (err) {
    // 1 retry
    try {
      const miUrl = `${TWSE_BASE_URL}/exchangeReport/MI_INDEX`;
      const resp2 = await doFetch(miUrl, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (resp2.ok) {
        const rows2 = await resp2.json() as MiIndexRow[];
        if (Array.isArray(rows2)) {
          const taiexRow2 = rows2.find(r => r["指數"] === "發行量加權股價指數");
          if (taiexRow2) {
            const value2 = parseFloat(taiexRow2["收盤指數"]);
            const chgSign2 = taiexRow2["漲跌"] === "-" ? -1 : 1;
            const change2 = chgSign2 * parseFloat(taiexRow2["漲跌點數"]);
            const changePct2 = chgSign2 * parseFloat(taiexRow2["漲跌百分比"]);
            taiex = {
              value: Math.round(value2 * 100) / 100,
              change: Math.round(change2 * 100) / 100,
              changePct: Math.round(changePct2 * 100) / 100,
              ts: rocDateToTaipeiTs(taiexRow2["日期"])
            };
          }
        }
      }
    } catch {
      console.warn("[twse-openapi-client] getTwseMarketOverview: MI_INDEX fetch failed after retry:", err instanceof Error ? err.message : String(err));
    }
  }

  if (!taiex) {
    console.warn("[twse-openapi-client] getTwseMarketOverview: could not resolve TAIEX");
    return null;
  }

  // ── OTC synthetic from TPEX close quotes ──────────────────────────────────
  // TPEX has no composite index endpoint — derive breadth from daily close quotes.
  // We return null for OTC index snapshot since no reliable composite is available.
  const otc: TwseIndexSnapshot | null = null;

  const result: TwseMarketOverviewResult = {
    taiex,
    otc,
    source: "twse_openapi",
    staleAfterSec: 60
  };

  setOverviewCache(CACHE_KEY, result);
  return result;
}

// ── Industry heatmap fetcher ──────────────────────────────────────────────────

/**
 * Fetch TWSE STOCK_DAY_ALL and aggregate changePct by industry.
 * Industry mapping: provided as a Map<ticker, industry> from the companies DB table.
 * Falls back to TPEX data for OTC-listed companies in the mapping.
 *
 * Returns empty array on total fetch failure.
 */
export async function getTwseIndustryHeatmap(
  tickerToIndustry: Map<string, string>,
  opts: { fetchOverride?: typeof fetch } = {}
): Promise<TwseHeatmapTile[]> {
  const CACHE_KEY = `twse:heatmap:${tickerToIndustry.size}`;
  const cached = getHeatmapCached(CACHE_KEY);
  if (cached) return cached;

  const doFetch = opts.fetchOverride ?? globalThis.fetch;

  // ── TWSE STOCK_DAY_ALL ───────────────────────────────────────────────────
  let stockRows: StockDayAllRow[] = [];
  try {
    const resp = await doFetch(`${TWSE_BASE_URL}/exchangeReport/STOCK_DAY_ALL`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5_000)
    });
    if (resp.ok) {
      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const raw = await resp.json();
        stockRows = Array.isArray(raw) ? (raw as StockDayAllRow[]) : [];
      }
    }
  } catch (err) {
    // 1 retry
    try {
      const resp2 = await doFetch(`${TWSE_BASE_URL}/exchangeReport/STOCK_DAY_ALL`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5_000)
      });
      if (resp2.ok) {
        const raw2 = await resp2.json();
        stockRows = Array.isArray(raw2) ? (raw2 as StockDayAllRow[]) : [];
      }
    } catch {
      console.warn("[twse-openapi-client] getTwseIndustryHeatmap: STOCK_DAY_ALL failed:", err instanceof Error ? err.message : String(err));
    }
  }

  // ── TPEX close quotes (for OTC-listed tickers in mapping) ────────────────
  let tpexRows: TpexDailyRow[] = [];
  try {
    const resp = await doFetch(`${TPEX_BASE_URL}/tpex_mainboard_daily_close_quotes`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5_000),
      redirect: "follow"
    });
    if (resp.ok) {
      const raw = await resp.json();
      tpexRows = Array.isArray(raw) ? (raw as TpexDailyRow[]) : [];
    }
  } catch {
    // TPEX failure is non-fatal — we still return TWSE data
    console.warn("[twse-openapi-client] getTwseIndustryHeatmap: TPEX fetch failed, continuing without OTC");
  }

  // ── Aggregate by industry ────────────────────────────────────────────────

  // Build ticker → changePct map from TWSE
  const tickerChangePct = new Map<string, number>();
  for (const row of stockRows) {
    const code = row.Code?.trim();
    if (!code) continue;
    const pct = computeChangePct(row.ClosingPrice, row.Change);
    tickerChangePct.set(code, pct);
  }

  // Overlay TPEX data (use SecuritiesCompanyCode as ticker)
  for (const row of tpexRows) {
    const code = row.SecuritiesCompanyCode?.trim();
    if (!code) continue;
    if (tickerChangePct.has(code)) continue; // TWSE takes precedence
    const pct = computeChangePct(row.Close, row.Change);
    tickerChangePct.set(code, pct);
  }

  // Group by industry using provided mapping
  const industryMap = new Map<string, { changes: number[]; gainers: number; losers: number; flats: number }>();

  for (const [ticker, industry] of tickerToIndustry) {
    const pct = tickerChangePct.get(ticker);
    if (pct === undefined) continue; // ticker not in TWSE/TPEX data today

    if (!industryMap.has(industry)) {
      industryMap.set(industry, { changes: [], gainers: 0, losers: 0, flats: 0 });
    }
    const bucket = industryMap.get(industry)!;
    bucket.changes.push(pct);
    if (pct > 0.05) bucket.gainers++;
    else if (pct < -0.05) bucket.losers++;
    else bucket.flats++;
  }

  const tiles: TwseHeatmapTile[] = [];
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
      source: "twse_openapi"
    });
  }

  // Sort by |avgChangePct| descending (most active industries first)
  tiles.sort((a, b) => Math.abs(b.avgChangePct) - Math.abs(a.avgChangePct));

  setHeatmapCache(CACHE_KEY, tiles);
  return tiles;
}

// ── TwseOpenApiClient ─────────────────────────────────────────────────────────

export interface TwseClientOptions {
  /** Override Redis client for testing */
  redisClient?: CacheClient | null;
}

export class TwseOpenApiClient {
  private readonly _redisOverride?: CacheClient | null;

  constructor(options?: TwseClientOptions) {
    this._redisOverride = options?.redisClient;
  }

  /**
   * 重大訊息 — Material Announcements
   *
   * Fetches the full TWSE material announcement list and filters by stockId.
   * The TWSE endpoint returns all announcements; we filter client-side.
   *
   * @param stockId - Taiwan stock code e.g. "2330"
   * @param days    - Number of calendar days to look back (default 30)
   */
  async getMaterialAnnouncements(stockId: string, days = 30): Promise<MaterialAnnouncementRow[]> {
    const cacheKey = `twse:announcements:${stockId}:${days}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as MaterialAnnouncementRow[]; } catch { /* fall through */ }
    }

    // TWSE t187ap46_L returns all recent material announcements across all stocks
    // We filter by Code (stock_id) client-side.
    const all = await fetchTwse<MaterialAnnouncementRow>("/opendata/t187ap46_L");

    // Filter by stock code and date range
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);

    const filtered = all.filter(row => {
      if (row.Code !== stockId) return false;
      // Date format: YYYY/MM/DD — convert to comparable string
      const dateStr = row.Date?.replace(/\//g, "-");
      if (!dateStr) return true; // keep if no date
      return dateStr >= cutoff.toISOString().slice(0, 10);
    });

    if (filtered.length > 0 || all.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(filtered), CACHE_TTL_SECONDS, this._redisOverride);
    }

    return filtered;
  }

  /**
   * 公司治理 — Corporate Governance disclosure
   *
   * @param stockId - Taiwan stock code e.g. "2330"
   */
  async getCorpGovernance(stockId: string): Promise<CorpGovernanceRow[]> {
    const cacheKey = `twse:corp-gov:${stockId}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as CorpGovernanceRow[]; } catch { /* fall through */ }
    }

    const all = await fetchTwse<CorpGovernanceRow>("/opendata/t187ap46_L_2");
    const filtered = all.filter(row => row.Code === stockId);

    if (all.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(filtered), CACHE_TTL_SECONDS, this._redisOverride);
    }

    return filtered;
  }

  /**
   * ESG 揭露 — ESG Disclosure
   *
   * @param stockId - Taiwan stock code e.g. "2330"
   */
  async getESGDisclosure(stockId: string): Promise<ESGDisclosureRow[]> {
    const cacheKey = `twse:esg:${stockId}`;

    const cached = await cacheGet(cacheKey, this._redisOverride);
    if (cached) {
      try { return JSON.parse(cached) as ESGDisclosureRow[]; } catch { /* fall through */ }
    }

    const all = await fetchTwse<ESGDisclosureRow>("/opendata/t187ap46_L_1");
    const filtered = all.filter(row => row.Code === stockId);

    if (all.length > 0) {
      await cacheSet(cacheKey, JSON.stringify(filtered), CACHE_TTL_SECONDS, this._redisOverride);
    }

    return filtered;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _defaultTwseClient: TwseOpenApiClient | null = null;

export function getTwseOpenApiClient(): TwseOpenApiClient {
  if (!_defaultTwseClient) {
    _defaultTwseClient = new TwseOpenApiClient();
  }
  return _defaultTwseClient;
}
