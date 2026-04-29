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
import {
  verifyMarketEventHmac,
  IngestSequenceTracker,
  ingestMarketEvent,
  updateAgentHeartbeat,
  getAgentHealth,
  _seqTracker,
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
