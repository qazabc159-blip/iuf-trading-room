/**
 * market-ingest.test.ts — W7 unit tests for market-ingest.ts
 *
 * Coverage (T1-T8):
 *   T1: HMAC verify — positive (valid signature accepted)
 *   T2: HMAC verify — negative (tampered payload rejected)
 *   T3: HMAC verify — no secret configured → reject
 *   T4: Sequence tracker — new symbol starts at 0, monotonic advance accepted
 *   T5: Sequence tracker — duplicate seq rejected
 *   T6: Sequence tracker — regression seq rejected
 *   T7: Heartbeat stale flip — fresh within 30s, stale beyond
 *   T8: Idempotency replay — second ingest of same (symbol, type, seq) rejected
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import type { createClient } from "redis";
import {
  verifyMarketEventHmac,
  IngestSequenceTracker,
  ingestMarketEvent,
  updateAgentHeartbeat,
  getAgentHealth,
  _seqTracker,
  _internalCache,
  _setRedisClientForTest,
} from "./market-ingest.js";
import type { MarketEvent, MarketAgentHeartbeat } from "@iuf-trading-room/contracts";

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_SECRET = "test-hmac-secret-for-w7-unit-tests";

function makeCanonicalMessage(
  type: string,
  symbol: string,
  ts: string,
  seq: number,
  data: Record<string, unknown>
): string {
  return `${type}:${symbol}:${ts}:${seq}:${JSON.stringify(data)}`;
}

function signEvent(
  type: string,
  symbol: string,
  ts: string,
  seq: number,
  data: Record<string, unknown>
): string {
  const message = makeCanonicalMessage(type, symbol, ts, seq, data);
  return createHmac("sha256", TEST_SECRET).update(message, "utf8").digest("hex");
}

function buildValidEvent(overrides: Partial<MarketEvent> = {}): MarketEvent {
  const type = "quote";
  const symbol = "2330.TW";
  const ts = new Date().toISOString();
  const seq = 1;
  const data = {
    last: 950.0,
    bid: 949.5,
    ask: 950.5,
    open: 945.0,
    high: 955.0,
    low: 940.0,
    prevClose: 942.0,
    volume: 5000000,
    changePct: 0.85,
  };
  const hmac = signEvent(type, symbol, ts, seq, data);

  return {
    type,
    symbol,
    ts,
    seq,
    hmac,
    data,
    ...overrides,
  };
}

// Set test secret in env
process.env.MARKET_AGENT_HMAC_SECRET = TEST_SECRET;

// ── T1: HMAC verify — positive ─────────────────────────────────────────────

test("T1: HMAC verify — valid signature accepted", () => {
  const event = buildValidEvent();
  assert.equal(verifyMarketEventHmac(event), true, "Valid HMAC should be accepted");
});

// ── T2: HMAC verify — negative (tampered data) ────────────────────────────

test("T2: HMAC verify — tampered payload rejected", () => {
  const event = buildValidEvent();
  // Mutate the data without re-signing
  const tampered: MarketEvent = {
    ...event,
    data: { ...event.data, last: 9999.0 },
  };
  assert.equal(verifyMarketEventHmac(tampered), false, "Tampered payload should be rejected");
});

// ── T3: HMAC verify — no secret configured ───────────────────────────────

test("T3: HMAC verify — no secret configured → reject", () => {
  const saved = process.env.MARKET_AGENT_HMAC_SECRET;
  delete process.env.MARKET_AGENT_HMAC_SECRET;

  const event = buildValidEvent();
  const result = verifyMarketEventHmac(event);
  assert.equal(result, false, "No secret should always reject");

  process.env.MARKET_AGENT_HMAC_SECRET = saved;
});

// ── T4: Sequence tracker — monotonic advance ──────────────────────────────

test("T4: Sequence tracker — new symbol starts at 0, monotonic advance accepted", () => {
  const tracker = new IngestSequenceTracker();

  // First event for a new symbol at seq=0
  assert.equal(tracker.check("quote", "TEST.TW", 0), "accepted");

  // Next higher seq accepted
  assert.equal(tracker.check("quote", "TEST.TW", 1), "accepted");
  assert.equal(tracker.check("quote", "TEST.TW", 5), "accepted");
  assert.equal(tracker.check("quote", "TEST.TW", 100), "accepted");
});

// ── T5: Sequence tracker — duplicate seq rejected ────────────────────────

test("T5: Sequence tracker — duplicate seq rejected", () => {
  const tracker = new IngestSequenceTracker();

  tracker.check("tick", "2317.TW", 10);

  // Re-submit same seq — must be duplicate
  assert.equal(tracker.check("tick", "2317.TW", 10), "duplicate");
});

// ── T6: Sequence tracker — regression seq rejected ───────────────────────

test("T6: Sequence tracker — regression seq (< last) rejected", () => {
  const tracker = new IngestSequenceTracker();

  tracker.check("bidask", "2330.TW", 50);

  // Lower seq → regression
  assert.equal(tracker.check("bidask", "2330.TW", 49), "rejected");
  assert.equal(tracker.check("bidask", "2330.TW", 0), "rejected");
});

// ── T7: Heartbeat stale flip ─────────────────────────────────────────────

test("T7: Heartbeat stale flip — fresh within threshold, stale beyond", async () => {
  const freshHeartbeat: MarketAgentHeartbeat = {
    agentId: "test-agent",
    ts: new Date().toISOString(),
    symbols: ["2330.TW"],
    version: "test",
  };

  await updateAgentHeartbeat(freshHeartbeat);

  const health = await getAgentHealth();
  assert.equal(health.agentId, "test-agent");
  assert.equal(health.isStale, false, "Recent heartbeat should not be stale");
  assert.ok(health.lastSeenAt !== null);
  assert.equal(health.staleThresholdMs, 30_000);
});

test("T7b: Heartbeat stale flip — ts in the distant past → isStale=true", async () => {
  const oldHeartbeat: MarketAgentHeartbeat = {
    agentId: "test-agent-old",
    ts: new Date(Date.now() - 60_000).toISOString(), // 60s ago
    symbols: [],
    version: "test",
  };

  await updateAgentHeartbeat(oldHeartbeat);

  const health = await getAgentHealth();
  assert.equal(health.agentId, "test-agent-old");
  assert.equal(health.isStale, true, "60s old heartbeat should be stale (threshold=30s)");
});

// ── T8: Idempotency replay via ingestMarketEvent ──────────────────────────
//
// The full ingest function uses the module-level _seqTracker singleton.
// We reset it before this test to ensure a clean state.

test("T8: Idempotency replay — second ingest with same seq rejected", async () => {
  // Reset the module-level sequence tracker so this test starts fresh
  _seqTracker.reset();

  const type = "kbar";
  const symbol = "REPLAY-TEST.TW";
  const ts = new Date().toISOString();
  const seq = 42;
  const data = {
    interval: "1m",
    openTime: ts,
    closeTime: ts,
    open: 100,
    high: 105,
    low: 98,
    close: 102,
    volume: 10000,
    turnover: 0,
    isClosed: false,
  };
  const hmac = signEvent(type, symbol, ts, seq, data);
  const event: MarketEvent = { type, symbol, ts, seq, hmac, data };

  // First ingest — should be accepted
  const first = await ingestMarketEvent(event);
  assert.equal(first.ok, true, "First ingest should be accepted");
  assert.ok(first.eventId, "First ingest should return an eventId");

  // Replay — same seq — should be rejected as duplicate
  // Re-sign (identical message = identical hmac), just replay
  const replay = await ingestMarketEvent(event);
  assert.equal(replay.ok, false, "Replay ingest should be rejected");
  assert.equal(replay.rejectedReason, "sequence_duplicate");
});

// ── D2 Redis tests ────────────────────────────────────────────────────────────
//
// These tests exercise the RedisCacheBackend wrapper via the _setRedisClientForTest
// escape hatch. No real Redis required in CI (REDIS_URL unset).

// Minimal fake Redis client shape used by the tests below.
interface FakeRedisClientRecord {
  setExCalls: Array<{ key: string; ttl: number; value: string }>;
  setCalls: Array<{ key: string; value: string }>;
  getCalls: string[];
  returnNull: boolean; // when true, get() returns null
  throwOnSet?: boolean; // when true, set/setEx throws
  delayMs?: number; // when set, set/setEx hangs for this many ms
}

function makeFakeRedisClient(opts: Partial<FakeRedisClientRecord> = {}): {
  client: ReturnType<typeof createClient>;
  record: FakeRedisClientRecord;
} {
  const record: FakeRedisClientRecord = {
    setExCalls: [],
    setCalls: [],
    getCalls: [],
    returnNull: opts.returnNull ?? false,
    throwOnSet: opts.throwOnSet,
    delayMs: opts.delayMs,
  };

  const client = {
    isReady: true,
    setEx: async (key: string, ttl: number, value: string) => {
      if (record.throwOnSet) throw new Error("redis_fake_error");
      if (record.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, record.delayMs));
      }
      record.setExCalls.push({ key, ttl, value });
    },
    set: async (key: string, value: string) => {
      if (record.throwOnSet) throw new Error("redis_fake_error");
      if (record.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, record.delayMs));
      }
      record.setCalls.push({ key, value });
    },
    get: async (key: string) => {
      record.getCalls.push(key);
      return record.returnNull ? null : `fake:${key}`;
    },
    on: (_event: string, _handler: unknown) => { /* noop */ },
  } as unknown as ReturnType<typeof createClient>;

  return { client, record };
}

// T-new-1: Redis unavailable → fallback to _internalCache, result.cached = true
test("T-new-1: Redis null path → _internalCache fallback, cached=true", async () => {
  // Force null client (simulates REDIS_URL unset or connection failure)
  _setRedisClientForTest(null);
  _seqTracker.reset();

  const symbol = "REDIS-TEST-1.TW";
  const ts = new Date().toISOString();
  const seq = 1;
  const data = { last: 100.0, bid: 99.5, ask: 100.5, open: 99.0, high: 101.0, low: 98.5, prevClose: 99.0, volume: 1000, changePct: 1.0 };
  const hmac = signEvent("quote", symbol, ts, seq, data);
  const event: MarketEvent = { type: "quote", symbol, ts, seq, hmac, data };

  const result = await ingestMarketEvent(event);
  assert.equal(result.ok, true, "Ingest should succeed even without Redis");
  assert.equal(result.cached, true, "_internalCache fallback should report cached=true");

  const cacheKey = `mkt:quote:${symbol}`;
  const stored = _internalCache.raw().get(cacheKey);
  assert.ok(stored !== undefined, "_internalCache should contain the key");
});

// T-new-2: Redis mock → writes land; simulate disconnect → in-memory; reconnect → Redis again
test("T-new-2: Redis mock write / null drop / reconnect cycle — no exception thrown", async () => {
  _seqTracker.reset();
  const { client: mockRedis, record } = makeFakeRedisClient();

  const symbol = "REDIS-TEST-2.TW";
  const ts = new Date().toISOString();
  const mkEvent = (seq: number): MarketEvent => {
    const data = { last: 100.0 + seq, bid: 99.5, ask: 100.5, open: 99.0, high: 101.0, low: 98.5, prevClose: 99.0, volume: 1000, changePct: 1.0 };
    const hmac = signEvent("quote", symbol, ts, seq, data);
    return { type: "quote", symbol, ts, seq, hmac, data };
  };

  // Event 1 — Redis mock connected
  _setRedisClientForTest(mockRedis);
  await ingestMarketEvent(mkEvent(1));

  // Event 2 — simulate Redis drop
  _setRedisClientForTest(null);
  await ingestMarketEvent(mkEvent(2));

  // Event 3 — simulate reconnect
  _setRedisClientForTest(mockRedis);
  await ingestMarketEvent(mkEvent(3));

  // Events 1 and 3 should have called setEx on the mock
  const keysWritten = record.setExCalls.map((c) => c.key);
  const cacheKey = `mkt:quote:${symbol}`;
  assert.equal(
    keysWritten.filter((k) => k === cacheKey).length,
    2,
    "setEx should have been called for event 1 and event 3 only"
  );

  // Event 2 should have landed in _internalCache
  const memValue = _internalCache.raw().get(cacheKey);
  assert.ok(memValue !== undefined, "Event 2 should be in _internalCache during drop");
});

// T-new-3: Slow Redis (hangs > 500ms) → timeout fires → cached=false, ok=true
test("T-new-3: Redis write timeout >500ms → cached=false, ok=true (primary path unblocked)", async () => {
  _seqTracker.reset();
  const { client: slowRedis } = makeFakeRedisClient({ delayMs: 1000 });
  _setRedisClientForTest(slowRedis);

  const symbol = "REDIS-SLOW.TW";
  const ts = new Date().toISOString();
  const seq = 1;
  const data = { last: 200.0, bid: 199.5, ask: 200.5, open: 199.0, high: 201.0, low: 198.5, prevClose: 199.0, volume: 2000, changePct: 0.5 };
  const hmac = signEvent("quote", symbol, ts, seq, data);
  const event: MarketEvent = { type: "quote", symbol, ts, seq, hmac, data };

  const result = await ingestMarketEvent(event);

  assert.equal(result.ok, true, "Primary path (DB) should succeed despite Redis timeout");
  assert.equal(result.cached, false, "cached should be false when Redis write timed out");

  // Cleanup: reset to null so subsequent tests don't see slow client
  _setRedisClientForTest(null);
});
