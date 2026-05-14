/**
 * twse-openapi-client.ts — W7 H4: TWSE OpenAPI adapter
 *
 * TWSE OpenAPI provides official Taiwan Stock Exchange data with no auth required.
 * Base URL: https://openapi.twse.com.tw/v1/
 * TPEX (OTC) Base URL: https://www.tpex.org.tw/openapi/v1/
 * TWSE main site (for MI_5MINS_INDEX): https://www.twse.com.tw/rwd/zh/TAIEX/
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
 *   - 大盤指數 (Market Overview) — MI_5MINS_INDEX (main site today) → MI_INDEX (OpenAPI fallback)
 *   - 個股日成交 (Stock Day All) — /exchangeReport/STOCK_DAY_ALL
 *   - OTC 個股收盤 (TPEX Daily) — tpex_mainboard_daily_close_quotes
 *
 * Index source chain (getTwseMarketOverview):
 *   1. TWSE MI_5MINS_INDEX (main site, today YYYYMMDD) — available immediately after 13:30
 *   2. TWSE MI_INDEX (OpenAPI) — official daily, may lag by hours or until next calendar day
 * This ensures ts=today even in the evening when TWSE OpenAPI still shows yesterday.
 */

import { createClient } from "redis";

// ── Base URLs ─────────────────────────────────────────────────────────────────

const TWSE_BASE_URL = "https://openapi.twse.com.tw/v1";
const TWSE_MAIN_BASE_URL = "https://www.twse.com.tw/rwd/zh/TAIEX"; // main site — MI_5MINS_INDEX
const TPEX_BASE_URL = "https://www.tpex.org.tw/openapi/v1";
const CACHE_TTL_SECONDS = 1800; // 30 min
const OVERVIEW_CACHE_TTL_SECONDS = 60; // 60s for market overview (near-real-time)
const STOCK_DAY_ALL_CACHE_TTL_SECONDS = 300; // 5 min — EOD data, stable once published
const FETCH_TIMEOUT_MS = 3000; // 3s per upstream request — fail fast, caller does fallback
// MI_5MINS_INDEX from Railway (Japan/Singapore region) may need up to 25s — much higher latency than Taiwan local
const MI5MINS_TIMEOUT_MS = 25000; // 25s dedicated timeout for MI_5MINS_INDEX (Railway cross-region)

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

// ── Shared STOCK_DAY_ALL dedup cache ─────────────────────────────────────────
// STOCK_DAY_ALL is large (~1400 rows). Both heatmap and breadth endpoints need it.
// Promise coalescing ensures only 1 upstream fetch fires even under concurrent load.

interface StockDayAllCacheEntry {
  rows: StockDayAllRow[];
  expiresAt: number;
}
let _stockDayAllCache: StockDayAllCacheEntry | null = null;
let _stockDayAllInflight: Promise<StockDayAllRow[]> | null = null;

/** For test cleanup */
export function _resetStockDayAllCache(): void {
  _stockDayAllCache = null;
  _stockDayAllInflight = null;
}

/** Exported so server routes can pre-warm the shared cache in parallel with DB queries */
export async function getStockDayAllRows(
  fetchOverride?: typeof fetch
): Promise<StockDayAllRow[]> {
  // Cache hit
  if (_stockDayAllCache && Date.now() < _stockDayAllCache.expiresAt) {
    return _stockDayAllCache.rows;
  }
  // Dedup: reuse inflight promise
  if (_stockDayAllInflight) return _stockDayAllInflight;

  const doFetch = fetchOverride ?? globalThis.fetch;
  _stockDayAllInflight = (async (): Promise<StockDayAllRow[]> => {
    try {
      const resp = await doFetch(`${TWSE_BASE_URL}/exchangeReport/STOCK_DAY_ALL`, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (!resp.ok) {
        console.warn(`[twse-openapi-client] STOCK_DAY_ALL HTTP ${resp.status}`);
        return [];
      }
      const ct = resp.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        console.warn("[twse-openapi-client] STOCK_DAY_ALL non-JSON response");
        return [];
      }
      const raw = await resp.json();
      const rows: StockDayAllRow[] = Array.isArray(raw) ? (raw as StockDayAllRow[]) : [];
      _stockDayAllCache = { rows, expiresAt: Date.now() + STOCK_DAY_ALL_CACHE_TTL_SECONDS * 1000 };
      return rows;
    } catch (err) {
      console.warn("[twse-openapi-client] STOCK_DAY_ALL fetch failed:", err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      _stockDayAllInflight = null;
    }
  })();

  return _stockDayAllInflight;
}

// ── Fetch helper (simple, no auth) ────────────────────────────────────────────

async function fetchTwse<T>(path: string): Promise<T[]> {
  const url = `${TWSE_BASE_URL}${path}`;
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow"
    });
  } catch (err) {
    // 1 retry on network error
    try {
      response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
  /** Internal flag — true when result is served from last-known-good cache (TWSE fetch failed) */
  _isLkg?: boolean;
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

// ── Last-known-good (LKG) cache for market overview ──────────────────────────
// Survives across the 60s _overviewCache window. No TTL — if TWSE is down for
// hours or across a redeploy, we return the last successful value tagged
// sourceState="lkg" so the frontend can show "昨日收盤" or "今日收盤" correctly.
// A value is only served as LKG if it is at most LKG_MAX_AGE_MS old (48h).
// This bridges weekends (Fri close → Mon morning), holidays, and TWSE downtime.

const LKG_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

interface LkgEntry {
  result: TwseMarketOverviewResult;
  savedAt: number; // Date.now() when saved
}

let _lkgOverview: LkgEntry | null = null;

function getLkgOverview(): TwseMarketOverviewResult | null {
  if (!_lkgOverview) return null;
  if (Date.now() - _lkgOverview.savedAt > LKG_MAX_AGE_MS) {
    _lkgOverview = null;
    return null;
  }
  return _lkgOverview.result;
}

function setLkgOverview(result: TwseMarketOverviewResult): void {
  _lkgOverview = { result, savedAt: Date.now() };
}

/** For test cleanup */
export function _resetLkgOverviewCache(): void {
  _lkgOverview = null;
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

// ── MI_5MINS_INDEX today fetcher (TWSE main site) ────────────────────────────

/**
 * Shape of TWSE MI_5MINS_INDEX JSON response.
 * data[][0] = time "HH:MM:SS", data[][1] = 發行量加權股價指數 (comma-formatted number string)
 * URL: https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_INDEX?date=YYYYMMDD
 */
interface Mi5MinsIndexResponse {
  stat: string;       // "OK" on success, "N/A" or missing on non-trading day
  date: string;       // "YYYYMMDD"
  title?: string;
  fields?: string[];
  data?: string[][];  // each row: [time, 加權指數, ...]
}

/**
 * Fetch today's TAIEX closing price from TWSE MI_5MINS_INDEX (main site).
 *
 * Returns a TwseIndexSnapshot using the last row of data (13:30 close).
 * Change is computed as: last_row_close - first_row_open (first row = yesterday's close, which is opening reference).
 *
 * Returns null if:
 *   - stat !== "OK" (non-trading day / maintenance / endpoint unavailable)
 *   - data is empty or malformed
 *   - response date != requested date (TWSE returns prev trading day on non-trading days)
 *
 * This endpoint updates immediately after 13:30 market close.
 * TWSE OpenAPI MI_INDEX may not publish until the following day or later.
 */
async function fetchTaiwanMarketIndexToday(
  dateYYYYMMDD: string,
  doFetch: typeof fetch
): Promise<TwseIndexSnapshot | null> {
  const url = `${TWSE_MAIN_BASE_URL}/MI_5MINS_INDEX?date=${dateYYYYMMDD}`;

  // Retry up to 3 attempts total (initial + 2 retries) with exponential backoff.
  // TWSE main site from Railway (cross-region) can have 10-20s latency.
  // User-Agent: TWSE may block default Node fetch UA.
  const HEADERS = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 1000, 2000]; // attempt 1=immediate, 2=1s, 3=2s

  let resp: Response | null = null;
  let lastFetchErr: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt]));
    }
    try {
      resp = await doFetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(MI5MINS_TIMEOUT_MS),
        redirect: "follow"
      });
      lastFetchErr = null;
      break; // success — exit retry loop
    } catch (err) {
      lastFetchErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[twse-openapi-client] MI_5MINS_INDEX fetch attempt ${attempt + 1}/${MAX_ATTEMPTS} failed: ${msg}`);
    }
  }

  if (!resp) {
    console.warn("[twse-openapi-client] MI_5MINS_INDEX all attempts failed:", lastFetchErr instanceof Error ? lastFetchErr.message : String(lastFetchErr));
    return null;
  }

  if (!resp.ok) {
    const ct = resp.headers.get("content-type") ?? "unknown";
    console.warn(`[twse-openapi-client] MI_5MINS_INDEX HTTP ${resp.status} content-type=${ct}`);
    return null;
  }

  let body: Mi5MinsIndexResponse;
  try {
    const text = await resp.text();
    // Log body prefix only for obviously wrong responses (HTML, empty, non-JSON)
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      console.warn(`[twse-openapi-client] MI_5MINS_INDEX non-JSON body (first 200 chars): ${text.slice(0, 200)}`);
    }
    body = JSON.parse(text) as Mi5MinsIndexResponse;
  } catch (parseErr) {
    console.warn("[twse-openapi-client] MI_5MINS_INDEX JSON parse failed:", parseErr instanceof Error ? parseErr.message : String(parseErr));
    return null;
  }

  if (body.stat !== "OK") {
    // Non-trading day or maintenance — expected, not an error
    console.info(`[twse-openapi-client] MI_5MINS_INDEX stat=${body.stat ?? "undefined"} for ${dateYYYYMMDD} (non-trading day or unavailable)`);
    return null;
  }

  // Verify response date matches request date (TWSE may return prev trading day on weekends)
  if (body.date && body.date !== dateYYYYMMDD) {
    console.info(`[twse-openapi-client] MI_5MINS_INDEX returned date=${body.date} != requested ${dateYYYYMMDD} — skipping`);
    return null;
  }

  const rows = body.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    console.info(`[twse-openapi-client] MI_5MINS_INDEX empty data for ${dateYYYYMMDD}`);
    return null;
  }

  // Last row = closing value (13:30:00 entry on a normal trading day)
  const lastRow = rows[rows.length - 1];
  if (!Array.isArray(lastRow) || lastRow.length < 2) return null;

  const closeStr = lastRow[1]; // 發行量加權股價指數 column
  const close = parseFloat(closeStr.replace(/,/g, ""));
  if (!isFinite(close) || close <= 0) {
    console.warn("[twse-openapi-client] MI_5MINS_INDEX: unparseable close value:", closeStr);
    return null;
  }

  // Compute change from first row (opening = yesterday's close reference)
  let change = 0;
  let changePct = 0;
  const firstRow = rows[0];
  if (Array.isArray(firstRow) && firstRow.length >= 2) {
    const prevClose = parseFloat(firstRow[1].replace(/,/g, ""));
    if (isFinite(prevClose) && prevClose > 0) {
      change = Math.round((close - prevClose) * 100) / 100;
      changePct = Math.round((change / prevClose) * 10000) / 100;
    }
  }

  // Build ISO timestamp — market closes at 13:30 Taipei time (+08:00)
  const year = dateYYYYMMDD.slice(0, 4);
  const month = dateYYYYMMDD.slice(4, 6);
  const day = dateYYYYMMDD.slice(6, 8);
  const ts = `${year}-${month}-${day}T13:30:00+08:00`;

  console.info(`[twse-openapi-client] MI_5MINS_INDEX today: TAIEX=${close} change=${change} (${changePct}%) ts=${ts}`);

  return {
    value: Math.round(close * 100) / 100,
    change,
    changePct,
    ts
  };
}

// ── Taipei today date helper ──────────────────────────────────────────────────

/** Returns today's date in Taipei time as "YYYYMMDD" */
function todayTaipeiYYYYMMDD(): string {
  const now = new Date();
  // Taipei is UTC+8
  const taipeiMs = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(taipeiMs);
  const year = d.getUTCFullYear().toString();
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}

// ── Market Overview fetcher ───────────────────────────────────────────────────

/**
 * Fetch TAIEX + OTC market overview.
 *
 * Index source chain (primary → fallback):
 *   1. TWSE MI_5MINS_INDEX (main site, today's Taipei date) — available from 13:30 onward
 *   2. TWSE MI_INDEX (OpenAPI official daily) — may lag until next calendar day
 *
 * This ensures ts=today even in the evening when TWSE OpenAPI still shows yesterday.
 * Returns null on total failure (both sources unavailable).
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

  // ── Primary: MI_5MINS_INDEX (today's close — available immediately after 13:30) ──
  const todayStr = todayTaipeiYYYYMMDD();
  let taiex: TwseIndexSnapshot | null = await fetchTaiwanMarketIndexToday(todayStr, doFetch);

  // ── Fallback: MI_INDEX (OpenAPI official, may be stale until next publish) ──────
  if (!taiex) {
    try {
      const miUrl = `${TWSE_BASE_URL}/exchangeReport/MI_INDEX`;
      const resp = await doFetch(miUrl, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (resp.ok) {
        const contentType = resp.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const rows = await resp.json() as MiIndexRow[];
          if (Array.isArray(rows)) {
            const taiexRow = rows.find(r => r["指數"] === "発行量加権股価指数" || r["指數"] === "發行量加權股價指數");
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
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
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
  }

  if (!taiex) {
    console.warn("[twse-openapi-client] getTwseMarketOverview: could not resolve TAIEX from any source");
    // ── LKG fallback — return last successful value tagged sourceState="lkg" ──
    const lkgBase = getLkgOverview();
    if (lkgBase) {
      const lkgTagged: TwseMarketOverviewResult = { ...lkgBase, _isLkg: true };
      console.info(`[twse-openapi-client] getTwseMarketOverview: returning LKG value ts=${lkgBase.taiex.ts}`);
      // Cache for 60s so we don't hammer TWSE on every request during downtime
      setOverviewCache(CACHE_KEY, lkgTagged);
      return lkgTagged;
    }
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
  // ── Save to LKG — persists across cache expiry and redeployments ──────────
  setLkgOverview(result);
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

  // ── STOCK_DAY_ALL + TPEX in parallel (shared dedup cache for STOCK_DAY_ALL) ─
  const [stockRows, tpexRows] = await Promise.all([
    getStockDayAllRows(doFetch),
    (async (): Promise<TpexDailyRow[]> => {
      try {
        const resp = await doFetch(`${TPEX_BASE_URL}/tpex_mainboard_daily_close_quotes`, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          redirect: "follow"
        });
        if (!resp.ok) return [];
        const raw = await resp.json();
        return Array.isArray(raw) ? (raw as TpexDailyRow[]) : [];
      } catch {
        console.warn("[twse-openapi-client] getTwseIndustryHeatmap: TPEX fetch failed, continuing without OTC");
        return [];
      }
    })(),
  ]);

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

// ── Market Breadth ─────────────────────────────────────────────────────────────

/** Output shape for TWSE market breadth (漲跌家數) */
export interface TwseMarketBreadthResult {
  /** Number of advancing stocks */
  up: number;
  /** Number of declining stocks */
  down: number;
  /** Number of flat stocks (change == 0) */
  flat: number;
  /** Total stocks with valid close price */
  total: number;
  /** Top-20 gainers by changePct */
  topGainers: TwseBreadthStockRow[];
  /** Top-20 losers by changePct */
  topLosers: TwseBreadthStockRow[];
  /** Top-20 by trade value (成交金額) */
  topVolume: TwseBreadthStockRow[];
  /** ISO 8601 trading date (Taipei) */
  asOf: string | null;
  source: "twse_openapi";
  staleAfterSec: 60;
}

export interface TwseBreadthStockRow {
  code: string;
  name: string;
  close: number;
  change: number;
  changePct: number;
  tradeValue: number;
}

// 60-second in-memory cache for breadth (same TTL as overview)
interface BreadthCacheEntry {
  result: TwseMarketBreadthResult;
  expiresAt: number;
}
const _breadthCache = new Map<string, BreadthCacheEntry>();

function getBreadthCached(key: string): TwseMarketBreadthResult | null {
  const entry = _breadthCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _breadthCache.delete(key); return null; }
  return entry.result;
}

function setBreadthCache(key: string, result: TwseMarketBreadthResult): void {
  _breadthCache.set(key, { result, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_SECONDS * 1000 });
}

/** For test cleanup */
export function _resetTwseBreadthCache(): void {
  _breadthCache.clear();
}

/**
 * Fetch TWSE market breadth (漲跌家數) from STOCK_DAY_ALL.
 * Returns advance/decline counts + top-20 gainers/losers/volume.
 * Falls back to empty result (never throws).
 * Cache TTL: 60 seconds.
 */
export async function getTwseMarketBreadth(
  opts: { fetchOverride?: typeof fetch } = {}
): Promise<TwseMarketBreadthResult> {
  const EMPTY: TwseMarketBreadthResult = {
    up: 0, down: 0, flat: 0, total: 0,
    topGainers: [], topLosers: [], topVolume: [],
    asOf: null, source: "twse_openapi", staleAfterSec: 60
  };

  const CACHE_KEY = "twse:breadth:v1";
  const cached = getBreadthCached(CACHE_KEY);
  if (cached) return cached;

  const doFetch = opts.fetchOverride ?? globalThis.fetch;

  // Use shared STOCK_DAY_ALL cache (dedup: heatmap + breadth share one upstream fetch)
  const stockRows = await getStockDayAllRows(doFetch);

  if (stockRows.length === 0) return EMPTY;

  let up = 0, down = 0, flat = 0;
  let asOf: string | null = null;
  const enriched: TwseBreadthStockRow[] = [];

  for (const row of stockRows) {
    const close = parseFloat(row.ClosingPrice);
    if (!isFinite(close) || close <= 0) continue;
    const changePct = computeChangePct(row.ClosingPrice, row.Change);
    const change = parseFloat(row.Change.trim().replace(/^\+/, ""));
    const tradeValue = parseFloat(row.TradeValue.replace(/,/g, "")) || 0;

    if (changePct > 0) up++;
    else if (changePct < 0) down++;
    else flat++;

    enriched.push({ code: row.Code, name: row.Name, close, change, changePct, tradeValue });

    if (!asOf && row.Date) {
      // TWSE STOCK_DAY_ALL date is "114/05/12" (ROC slash format)
      const parts = row.Date.trim().split("/");
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10) + 1911;
        asOf = `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}T13:30:00+08:00`;
      }
    }
  }

  const sortByPct = (a: TwseBreadthStockRow, b: TwseBreadthStockRow) => b.changePct - a.changePct;
  const topGainers = [...enriched].sort(sortByPct).filter(r => r.changePct > 0).slice(0, 20);
  const topLosers = [...enriched].sort((a, b) => a.changePct - b.changePct).filter(r => r.changePct < 0).slice(0, 20);
  const topVolume = [...enriched].sort((a, b) => b.tradeValue - a.tradeValue).slice(0, 20);

  const result: TwseMarketBreadthResult = {
    up, down, flat, total: enriched.length,
    topGainers, topLosers, topVolume,
    asOf, source: "twse_openapi", staleAfterSec: 60
  };

  setBreadthCache(CACHE_KEY, result);
  return result;
}

// ── Market Leaders (top gainers / losers / most active) ──────────────────────

export interface TwseLeaderStock {
  symbol: string;
  name: string;
  last: number;
  changePct: number;
  volume: number; // trade value (成交金額 TWD)
  source: "twse_openapi";
}

export interface TwseLeadersResult {
  topGainers: TwseLeaderStock[];
  topLosers: TwseLeaderStock[];
  mostActive: TwseLeaderStock[];
  source: "twse_openapi";
  asOf: string | null;
}

// 60-second in-memory cache for leaders (same TTL as breadth)
interface LeadersCacheEntry {
  result: TwseLeadersResult;
  expiresAt: number;
}
const _leadersCache = new Map<string, LeadersCacheEntry>();

function getLeadersCached(key: string): TwseLeadersResult | null {
  const entry = _leadersCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _leadersCache.delete(key); return null; }
  return entry.result;
}

function setLeadersCache(key: string, result: TwseLeadersResult): void {
  _leadersCache.set(key, { result, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_SECONDS * 1000 });
}

/** For test cleanup */
export function _resetTwseLeadersCache(): void {
  _leadersCache.clear();
}

/**
 * Derive top gainers / losers / most active from TWSE STOCK_DAY_ALL.
 * Reuses shared getStockDayAllRows() cache (dedup with heatmap + breadth).
 * Returns top 5 for each category.
 * Cache TTL: 60 seconds (same as breadth/overview).
 */
export async function getTwseLeaders(
  opts: { fetchOverride?: typeof fetch; topN?: number } = {}
): Promise<TwseLeadersResult> {
  const topN = opts.topN ?? 5;
  const CACHE_KEY = `twse:leaders:v1:${topN}`;
  const cached = getLeadersCached(CACHE_KEY);
  if (cached) return cached;

  const EMPTY: TwseLeadersResult = {
    topGainers: [], topLosers: [], mostActive: [],
    source: "twse_openapi", asOf: null
  };

  const doFetch = opts.fetchOverride ?? globalThis.fetch;

  // Reuse shared STOCK_DAY_ALL cache (same request as breadth/heatmap)
  const stockRows = await getStockDayAllRows(doFetch);
  if (stockRows.length === 0) return EMPTY;

  let asOf: string | null = null;
  const enriched: TwseLeaderStock[] = [];

  for (const row of stockRows) {
    const close = parseFloat(row.ClosingPrice);
    if (!isFinite(close) || close <= 0) continue;
    const changePct = computeChangePct(row.ClosingPrice, row.Change);
    const tradeValue = parseFloat(row.TradeValue.replace(/,/g, "")) || 0;

    enriched.push({
      symbol: row.Code?.trim() ?? "",
      name: row.Name?.trim() ?? "",
      last: Math.round(close * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      volume: tradeValue,
      source: "twse_openapi"
    });

    if (!asOf && row.Date) {
      const parts = row.Date.trim().split("/");
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10) + 1911;
        asOf = `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
      }
    }
  }

  const topGainers = [...enriched]
    .filter(r => r.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, topN);

  const topLosers = [...enriched]
    .filter(r => r.changePct < 0)
    .sort((a, b) => a.changePct - b.changePct)
    .slice(0, topN);

  const mostActive = [...enriched]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, topN);

  const result: TwseLeadersResult = {
    topGainers, topLosers, mostActive,
    source: "twse_openapi", asOf
  };

  setLeadersCache(CACHE_KEY, result);
  return result;
}
