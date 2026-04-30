/**
 * companies-ohlcv.ts — W7 D3: OHLCV bar store + query helpers
 *
 * Responsibilities:
 *   - generateMockOhlcv(): deterministic random-walk seeded by companyId string.
 *     Produces 200 trading days of mock OHLCV.  Reproducible: same seed → same bars.
 *   - getCompanyOhlcv(): query bars from DB if available, fall back to mock.
 *   - getCompanyOhlcvBulk(): same but for multiple companies (watchlist endpoint).
 *   - Cache layer: wraps getRedisOhlcvCache / setRedisOhlcvCache with 5-minute TTL.
 *
 * Hard lines:
 *   - No KGI SDK import.
 *   - Cache failure MUST NOT block response (W7 hard line #11).
 *   - Mock path is always available as fallback.
 *
 * Mock seeding:
 *   seedFromString(companyId) → mulberry32 PRNG → random walk starting at 100.
 *   Produces exactly 200 trading-day bars in ascending dt order.
 *   Non-trading days (Saturday/Sunday) are skipped.
 */

import { createClient } from "redis";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { companiesOhlcv, getDb } from "@iuf-trading-room/db";
import type { AppSession } from "@iuf-trading-room/contracts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OhlcvBar {
  dt: string;          // 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: "mock" | "kgi" | "tej";
}

export interface OhlcvQueryParams {
  from?: string;   // 'YYYY-MM-DD', inclusive
  to?: string;     // 'YYYY-MM-DD', inclusive
  interval?: "1d" | "1w" | "1m";
}

// ── Mock PRNG (mulberry32 seeded by companyId) ────────────────────────────────

function seedFromString(s: string): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b9);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate 200 trading-day mock OHLCV bars for a given companyId.
 * Start date is ~280 calendar days ago (enough to get ~200 trading days).
 * Saturday/Sunday are skipped.  Deterministic for a given companyId.
 */
export function generateMockOhlcv(companyId: string): OhlcvBar[] {
  const rand = mulberry32(seedFromString(companyId));

  // Start ~280 calendar days ago so we get ~200 trading days.
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 280);

  let price = 80 + rand() * 120; // starting price 80..200
  const bars: OhlcvBar[] = [];
  const cursor = new Date(startDate);

  while (bars.length < 200) {
    const dow = cursor.getUTCDay();
    // Skip Saturday (6) and Sunday (0)
    if (dow !== 0 && dow !== 6) {
      const change = (rand() - 0.48) * price * 0.03; // slight bullish drift
      const open   = +price.toFixed(2);
      const close  = +(price + change).toFixed(2);
      const hi     = +(Math.max(open, close) * (1 + rand() * 0.015)).toFixed(2);
      const lo     = +(Math.min(open, close) * (1 - rand() * 0.015)).toFixed(2);
      const volume = Math.floor(rand() * 9_000_000 + 100_000);

      bars.push({
        dt: cursor.toISOString().slice(0, 10),
        open,
        high:   Math.max(open, close, hi),
        low:    Math.min(open, close, lo),
        close,
        volume,
        source: "mock"
      });

      price = close > 1 ? close : 1; // floor at 1
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return bars;
}

// ── Redis cache helpers ───────────────────────────────────────────────────────

const OHLCV_CACHE_TTL_SECONDS = 300; // 5 minutes

let _ohlcvRedisClient: ReturnType<typeof createClient> | null = null;
let _ohlcvRedisConnectPromise: Promise<ReturnType<typeof createClient> | null> | null = null;

async function getOhlcvRedisClient(): Promise<ReturnType<typeof createClient> | null> {
  const url = process.env.REDIS_URL ?? null;
  if (!url) return null;

  if (_ohlcvRedisClient?.isReady) return _ohlcvRedisClient;
  if (_ohlcvRedisConnectPromise) return _ohlcvRedisConnectPromise;

  _ohlcvRedisConnectPromise = (async () => {
    const client = createClient({
      url,
      socket: { reconnectStrategy: (n: number) => Math.min(n * 200, 3_000) }
    });
    client.on("error", (e: Error) => console.error("[companies-ohlcv] Redis error", e));
    await client.connect();
    _ohlcvRedisClient = client;
    _ohlcvRedisConnectPromise = null;
    return client;
  })().catch((e: unknown) => {
    console.error("[companies-ohlcv] Redis connect failed", e);
    _ohlcvRedisConnectPromise = null;
    return null;
  });

  return _ohlcvRedisConnectPromise;
}

function ohlcvCacheKey(companyId: string, params: OhlcvQueryParams): string {
  const interval = params.interval ?? "1d";
  return `ohlcv:${companyId}:${interval}:${params.from ?? ""}:${params.to ?? ""}`;
}

async function getCachedOhlcv(key: string): Promise<OhlcvBar[] | null> {
  try {
    const client = await Promise.race([
      getOhlcvRedisClient(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
    ]);
    if (!client) return null;
    const raw = await Promise.race([
      client.get(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
    ]);
    if (!raw) return null;
    return JSON.parse(raw) as OhlcvBar[];
  } catch {
    return null; // cache failure must NOT block response
  }
}

async function setCachedOhlcv(key: string, bars: OhlcvBar[]): Promise<void> {
  try {
    const client = await Promise.race([
      getOhlcvRedisClient(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
    ]);
    if (!client) return;
    await Promise.race([
      client.setEx(key, OHLCV_CACHE_TTL_SECONDS, JSON.stringify(bars)),
      new Promise<void>((resolve) => setTimeout(() => resolve(), 500))
    ]);
  } catch {
    // cache failure must NOT block response (W7 hard line #11)
  }
}

// ── Query: single company ─────────────────────────────────────────────────────

export async function getCompanyOhlcv(
  companyId: string,
  _session: AppSession,
  params: OhlcvQueryParams = {}
): Promise<OhlcvBar[]> {
  const interval = params.interval ?? "1d";
  const cacheKey = ohlcvCacheKey(companyId, params);

  // Try cache first
  const cached = await getCachedOhlcv(cacheKey);
  if (cached) return cached;

  const db = getDb();
  let bars: OhlcvBar[];

  if (db) {
    // DB path: query real rows
    try {
      const conditions = [
        eq(companiesOhlcv.companyId, companyId),
        eq(companiesOhlcv.interval, interval)
      ];
      if (params.from) conditions.push(gte(companiesOhlcv.dt, params.from));
      if (params.to)   conditions.push(lte(companiesOhlcv.dt, params.to));

      const rows = await db
        .select()
        .from(companiesOhlcv)
        .where(and(...conditions))
        .orderBy(desc(companiesOhlcv.dt))
        .limit(500);

      if (rows.length > 0) {
        bars = rows.map((r) => ({
          dt: typeof r.dt === "string" ? r.dt : (r.dt as Date).toISOString().slice(0, 10),
          open:   Number(r.open),
          high:   Number(r.high),
          low:    Number(r.low),
          close:  Number(r.close),
          volume: Number(r.volume),
          source: r.source as "mock" | "kgi" | "tej"
        })).reverse(); // return ascending

        await setCachedOhlcv(cacheKey, bars);
        return bars;
      }
    } catch (e) {
      console.error("[companies-ohlcv] DB query failed, falling back to mock", e);
    }
  }

  // Mock fallback: generate and filter by date range
  let mockBars = generateMockOhlcv(companyId);
  if (params.from) mockBars = mockBars.filter((b) => b.dt >= params.from!);
  if (params.to)   mockBars = mockBars.filter((b) => b.dt <= params.to!);

  bars = mockBars;
  await setCachedOhlcv(cacheKey, bars);
  return bars;
}

// ── Query: bulk (watchlist) ───────────────────────────────────────────────────

export async function getCompanyOhlcvBulk(
  companyIds: string[],
  session: AppSession,
  params: OhlcvQueryParams = {}
): Promise<Record<string, OhlcvBar[]>> {
  if (companyIds.length === 0) return {};

  const results: Record<string, OhlcvBar[]> = {};

  // Fetch in parallel (each is cache-aware, graceful on failure)
  await Promise.all(
    companyIds.map(async (id) => {
      try {
        results[id] = await getCompanyOhlcv(id, session, params);
      } catch {
        results[id] = generateMockOhlcv(id); // hard fallback
      }
    })
  );

  return results;
}
