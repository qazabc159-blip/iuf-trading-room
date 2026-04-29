/**
 * market-ingest.ts — W7 Market Agent ingest backend
 *
 * Responsibilities:
 *   - verifyMarketEventHmac(): HMAC-SHA256 verify (timing-safe)
 *   - IngestSequenceTracker: in-memory sequence-number ordering guard
 *   - ingestMarketEvent(): write to Redis hot cache + Postgres ledger
 *   - updateAgentHeartbeat() / getAgentHealth(): heartbeat state
 *
 * Hard lines (W7):
 *   - HMAC secret read only from process.env.MARKET_AGENT_HMAC_SECRET
 *   - Secret NEVER written to Redis or Postgres
 *   - Stale data → warning in result, never silent fill (W7 hard line #11)
 *   - No KGI SDK import here (mock-only for now; see TODO markers below)
 *   - No /order/create, no kill-switch state machine
 *
 * Redis hot-cache keys:
 *   mkt:quote:<symbol>     — latest quote snapshot (JSON)
 *   mkt:tick:<symbol>      — latest tick (JSON)
 *   mkt:bidask:<symbol>    — latest bid/ask (JSON)
 *   mkt:kbar:<symbol>      — latest kbar (JSON)
 *   mkt:agent:lastSeen     — ISO-8601 UTC of last heartbeat
 *
 * Note: Redis client is lazily instantiated from REDIS_URL env. When REDIS_URL
 * is absent (CI / local memory mode) the cache layer is skipped gracefully.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import type { MarketEvent, MarketAgentHeartbeat } from "@iuf-trading-room/contracts";

// ── HMAC helpers ──────────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 over the canonical event message.
 *
 * Message format: `${type}:${symbol}:${ts}:${seq}:${JSON.stringify(data)}`
 *
 * This is the same format the Market Agent uses when signing.
 */
function computeEventHmac(secret: string, event: Omit<MarketEvent, "hmac">): string {
  const message = `${event.type}:${event.symbol}:${event.ts}:${event.seq}:${JSON.stringify(event.data)}`;
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/**
 * Verify incoming event HMAC.  Returns true iff signature matches.
 * Uses timing-safe comparison to prevent timing-oracle attacks.
 */
export function verifyMarketEventHmac(event: MarketEvent): boolean {
  const secret = process.env.MARKET_AGENT_HMAC_SECRET;
  if (!secret) {
    // No secret configured — reject all events (fail secure).
    return false;
  }

  const expected = computeEventHmac(secret, event);
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(event.hmac, "hex");

  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}

// ── Sequence tracking ─────────────────────────────────────────────────────────

/**
 * In-memory sequence tracker.
 *
 * Each (symbol, type) pair has a lastSeq cursor.  An incoming event is:
 *   - ACCEPTED  if seq > lastSeq (strict monotonic)
 *   - DUPLICATE if seq === lastSeq (idempotent replay rejection)
 *   - REJECTED  if seq < lastSeq (regression / out-of-order)
 *
 * On process restart the tracker resets; Postgres UNIQUE index is the hard
 * durability guard against replay.
 */
export class IngestSequenceTracker {
  private readonly _seqMap = new Map<string, number>();

  private _key(type: string, symbol: string): string {
    return `${type}:${symbol}`;
  }

  /** Returns 'accepted' | 'duplicate' | 'rejected' */
  check(type: string, symbol: string, seq: number): "accepted" | "duplicate" | "rejected" {
    const key = this._key(type, symbol);
    const last = this._seqMap.get(key);

    if (last === undefined) {
      // First event seen — always accept.
      this._seqMap.set(key, seq);
      return "accepted";
    }

    if (seq > last) {
      this._seqMap.set(key, seq);
      return "accepted";
    }

    if (seq === last) {
      return "duplicate";
    }

    // seq < last: out-of-order
    return "rejected";
  }

  /** Reset (used in tests) */
  reset(): void {
    this._seqMap.clear();
  }

  /** Snapshot for diagnostics */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this._seqMap.entries());
  }
}

// Module-level singleton sequence tracker (process lifetime)
export const _seqTracker = new IngestSequenceTracker();

// ── Redis stub ────────────────────────────────────────────────────────────────
//
// Real Redis is wired when REDIS_URL is set (future W7 D2).
// For now: in-memory Map that mirrors the Redis key semantics so tests can
// exercise the full ingest flow without a real Redis instance.

interface CacheBackend {
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

class MemoryCacheBackend implements CacheBackend {
  private readonly _store = new Map<string, string>();

  async set(key: string, value: string, _ttlSeconds?: number): Promise<void> {
    this._store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this._store.get(key) ?? null;
  }

  /** For test inspection */
  raw(): Map<string, string> {
    return this._store;
  }
}

// Export for tests to inspect cache state.
export const _internalCache = new MemoryCacheBackend();

// ── Redis client (lazy-connect) ───────────────────────────────────────────────

let _redisClient: ReturnType<typeof createClient> | null = null;
let _redisConnectPromise: Promise<ReturnType<typeof createClient> | null> | null = null;

async function getRedisClient(): Promise<ReturnType<typeof createClient> | null> {
  const url = process.env.REDIS_URL ?? null;
  if (!url) return null; // no URL → memory mode

  if (_redisClient?.isReady) return _redisClient; // already connected

  if (_redisConnectPromise) return _redisConnectPromise; // deduplicate races

  _redisConnectPromise = (async () => {
    const client = createClient({
      url,
      socket: { reconnectStrategy: (n: number) => Math.min(n * 200, 3_000) }
    });
    client.on("error", (e: Error) => console.error("[market-ingest] Redis error", e));
    await client.connect();
    _redisClient = client;
    _redisConnectPromise = null;
    return client;
  })().catch((e: unknown) => {
    console.error("[market-ingest] Redis connect failed", e);
    _redisConnectPromise = null;
    return null;
  });

  return _redisConnectPromise;
}

/** Returns "redis" when REDIS_URL is configured, "memory" otherwise. */
export function cacheBackendMode(): "redis" | "memory" {
  return process.env.REDIS_URL ? "redis" : "memory";
}

/** Test-only escape hatch — inject a fake Redis client. */
export function _setRedisClientForTest(
  client: ReturnType<typeof createClient> | null
): void {
  _redisClient = client;
}

// TTL constants (seconds)
const TTL_QUOTE = 60;
const TTL_TICK = 60;
const TTL_BIDASK = 60;
const TTL_KBAR = 300;

function ttlForKey(key: string): number | undefined {
  if (key.startsWith("mkt:quote:")) return TTL_QUOTE;
  if (key.startsWith("mkt:tick:")) return TTL_TICK;
  if (key.startsWith("mkt:bidask:")) return TTL_BIDASK;
  if (key.startsWith("mkt:kbar:")) return TTL_KBAR;
  return undefined; // no TTL (e.g. mkt:agent:lastSeen)
}

class RedisCacheBackend implements CacheBackend {
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? ttlForKey(key);
    const client = await getRedisClient();
    if (!client) {
      await _internalCache.set(key, value);
      return;
    }
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("redis_write_timeout")), 500)
    );
    if (ttl !== undefined) {
      await Promise.race([client.setEx(key, ttl, value), timeout]);
    } else {
      await Promise.race([client.set(key, value), timeout]);
    }
  }

  async get(key: string): Promise<string | null> {
    const client = await getRedisClient();
    if (!client) return _internalCache.get(key);
    return client.get(key);
  }
}

const cache: CacheBackend = new RedisCacheBackend();

// ── Postgres stub ─────────────────────────────────────────────────────────────
//
// Real Postgres write via Drizzle when DATABASE_URL is set (future W7 D2).
// For now: in-memory array that mirrors the market_events table columns.

export interface MarketEventRow {
  id: string;
  event_type: string;
  symbol: string;
  agent_ts: string;
  seq: number;
  hmac_hex: string;
  // NOTE: `data` stored as object; in real PG this is JSONB.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, unknown>;
  received_at: string;
}

// TODO(W7-D2): replace with real Drizzle write when DATABASE_URL set.
export const _persistedEvents: MarketEventRow[] = [];

async function persistEventToDb(
  event: MarketEvent,
  eventId: string
): Promise<boolean> {
  try {
    _persistedEvents.push({
      id: eventId,
      event_type: event.type,
      symbol: event.symbol,
      agent_ts: event.ts,
      seq: event.seq,
      hmac_hex: event.hmac,
      data: event.data as Record<string, unknown>,
      received_at: new Date().toISOString()
    });
    return true;
  } catch {
    return false;
  }
}

// ── Main ingest function ──────────────────────────────────────────────────────

export interface IngestEventResult {
  ok: boolean;
  eventId?: string;
  cached: boolean;
  persisted: boolean;
  rejectedReason?: string;
}

/**
 * Process one MarketEvent:
 *   1. HMAC verify
 *   2. Sequence ordering check
 *   3. Write to Redis hot cache
 *   4. Append to Postgres market_events
 */
export async function ingestMarketEvent(
  event: MarketEvent
): Promise<IngestEventResult> {
  // Step 1: HMAC verify
  if (!verifyMarketEventHmac(event)) {
    return { ok: false, cached: false, persisted: false, rejectedReason: "hmac_invalid" };
  }

  // Step 2: Sequence ordering
  const seqResult = _seqTracker.check(event.type, event.symbol, event.seq);
  if (seqResult === "duplicate") {
    return { ok: false, cached: false, persisted: false, rejectedReason: "sequence_duplicate" };
  }
  if (seqResult === "rejected") {
    return { ok: false, cached: false, persisted: false, rejectedReason: "sequence_regression" };
  }

  const eventId = randomUUID();

  // Step 3: Write to Redis hot cache
  const cacheKey = `mkt:${event.type}:${event.symbol}`;
  let cached = false;
  try {
    await cache.set(cacheKey, JSON.stringify({ ...event.data, ts: event.ts, seq: event.seq }));
    cached = true;
  } catch (err) {
    console.warn(`[market-ingest] Redis cache write failed for ${cacheKey}:`, err);
    // Non-fatal — proceed to DB write
  }

  // Step 4: Persist to Postgres
  const persisted = await persistEventToDb(event, eventId);

  return { ok: true, eventId, cached, persisted };
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

const HEARTBEAT_STALE_MS = 30_000;

export async function updateAgentHeartbeat(heartbeat: MarketAgentHeartbeat): Promise<void> {
  await cache.set("mkt:agent:lastSeen", JSON.stringify({
    agentId: heartbeat.agentId,
    ts: heartbeat.ts,
    symbols: heartbeat.symbols,
    version: heartbeat.version ?? null
  }));
}

export async function getAgentHealth(): Promise<{
  agentId: string | null;
  lastSeenAt: string | null;
  isStale: boolean;
  staleThresholdMs: number;
}> {
  const raw = await cache.get("mkt:agent:lastSeen");
  if (!raw) {
    return { agentId: null, lastSeenAt: null, isStale: true, staleThresholdMs: HEARTBEAT_STALE_MS };
  }

  let parsed: { agentId: string; ts: string; symbols: string[]; version: string | null };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { agentId: null, lastSeenAt: null, isStale: true, staleThresholdMs: HEARTBEAT_STALE_MS };
  }

  const ageMs = Date.now() - new Date(parsed.ts).getTime();
  const isStale = ageMs > HEARTBEAT_STALE_MS;

  return {
    agentId: parsed.agentId,
    lastSeenAt: parsed.ts,
    isStale,
    staleThresholdMs: HEARTBEAT_STALE_MS
  };
}
