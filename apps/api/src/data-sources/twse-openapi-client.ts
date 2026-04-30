/**
 * twse-openapi-client.ts — W7 H4: TWSE OpenAPI adapter
 *
 * TWSE OpenAPI provides official Taiwan Stock Exchange data with no auth required.
 * Base URL: https://openapi.twse.com.tw/v1/
 *
 * Hard lines:
 *   - No auth required, no secrets
 *   - No KGI SDK import
 *   - Cache failure MUST NOT block response (fail-open)
 *   - Cache TTL: 1800s (30 min) for most endpoints
 *   - Empty array returned on any error (never throw to callers)
 *   - Rate limit friendly: TWSE endpoints are low-traffic official API
 *
 * Datasets:
 *   - 重大訊息 (Material Announcements) — /opendata/t187ap46_L (by stock_id)
 *   - 公司治理 (Corporate Governance) — /opendata/t187ap46_L_2
 *   - ESG 揭露 — /opendata/t187ap46_L_1
 */

import { createClient } from "redis";

// ── Base URL ──────────────────────────────────────────────────────────────────

const TWSE_BASE_URL = "https://openapi.twse.com.tw/v1";
const CACHE_TTL_SECONDS = 1800; // 30 min

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

  try {
    const json = await response.json() as T[];
    return Array.isArray(json) ? json : [];
  } catch {
    console.warn(`[twse-openapi-client] JSON parse error for ${path}`);
    return [];
  }
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
