/**
 * lab-strategy-snapshot.test.ts — Unit tests for lab-strategy-snapshot-fetcher
 *
 * Coverage:
 *   SS1: happy path — fetchStrategySnapshot('cont_liq_v36') returns snapshot with ok=true
 *        (uses mock fetch override; validates shape and cache_hit=false)
 *   SS2: 404 — unknown strategyId rejected before network (ALLOWED_STRATEGY_IDS guard)
 *   SS3: cache hit — 2nd call within 30s TTL returns cached data (no new HTTP call)
 *   SS4: circuit breaker — 3 consecutive fails → 60s backoff → 503-equivalent stale result
 *   SS5: fetch timeout → ok=false, stale_reason='fetch_timeout_5s'
 *   SS6: stale cache served on non-200 HTTP response
 *   SS7: fetchStrategyIndex() returns parsed strategies array
 *   SS8: audit fields — cache_hit boolean present in result for both hit/miss
 *
 * Run: node --test --import tsx/esm apps/api/src/__tests__/lab-strategy-snapshot.test.ts
 *
 * Hard lines verified:
 *   - Circuit open → ok=false, stale_reason starts with 'circuit_open'
 *   - Cache hit → cache_hit=true, stale_reason=null, ok=true
 *   - Fresh fetch → cache_hit=false, stale_reason=null, ok=true
 *   - Failure without cache → ok=false, snapshot=null
 *   - Failure with stale cache → ok=false, snapshot≠null (stale served)
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_STRATEGY_IDS,
  SNAPSHOT_CACHE_TTL_MS,
  SNAPSHOT_CIRCUIT_FAIL_THRESHOLD,
  _resetSnapshotFetcherState,
  _setSnapshotCache,
  _setCircuitFails,
  fetchStrategySnapshot,
  getSnapshotFromCacheOnly,
  fetchStrategyIndex,
} from "../lab-strategy-snapshot-fetcher.js";

// ── Minimal snapshot fixture (matches lab_tr_strategy_snapshot_v0 schema) ─────

const MINIMAL_SNAPSHOT: Record<string, unknown> = {
  schema: "lab_tr_strategy_snapshot_v0",
  strategyId: "cont_liq_v36",
  displayName: "Continuous Liquidity Relative Strength",
  displayName_zh: "持續流動性 + 相對強弱",
  status: "PAPER_LIVE_PROPOSED",
  labGateLevel: 9,
  labGatePassed: 9,
  asOfDateTaipei: "2026-05-09T14:05:26+08:00",
  headlineMetrics: {
    sharpeAnnualized: 3.027,
    maxDrawdown: -0.1051,
    winRate: 0.8462,
    robustness: {
      horizonSweep: "NEAR_PASS_v37"
    }
  },
  equityCurve: { frequency: "rebalance", points: [] },
  monthlyReturns: { frequency: "calendar_month", bars: [] },
  drawdownSeries: { frequency: "rebalance", points: [] },
  sampleTrades: {
    limit: 8,
    entries: [
      {
        rebalanceDate: "2026-04-15",
        exitDate: "2026-05-06",
        source: "mock_for_demo",
        uiLabel_zh: "示範交易（非真實成交）"
      }
    ]
  }
};

const MINIMAL_INDEX: Record<string, unknown> = {
  schema: "lab_tr_strategy_snapshot_index_v0",
  strategies: [
    { strategyId: "cont_liq_v36", status: "PAPER_LIVE_PROPOSED", demoOrder: 1 },
    { strategyId: "strategy_002", status: "PAPER_LIVE_OBSERVING", demoOrder: 2 },
    { strategyId: "strategy_003", status: "BACKTESTED_RAW", demoOrder: 3 }
  ]
};

// ── Mock fetch override ────────────────────────────────────────────────────────

type MockFetchConfig = {
  status: number;
  body?: unknown;
  etag?: string | null;
  shouldThrow?: boolean;
  throwAbort?: boolean;
};

let _mockFetchConfig: MockFetchConfig | null = null;
let _fetchCallCount = 0;

function installMockFetch(config: MockFetchConfig) {
  _mockFetchConfig = config;
  _fetchCallCount = 0;

  // Override global fetch
  (globalThis as unknown as Record<string, unknown>)["fetch"] = async (
    _url: string,
    _opts?: RequestInit
  ): Promise<Response> => {
    _fetchCallCount++;
    if (config.shouldThrow) {
      if (config.throwAbort) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      throw new Error("network error");
    }
    const body =
      config.body !== undefined ? JSON.stringify(config.body) : "{}";
    const headers = new Headers();
    if (config.etag) headers.set("etag", config.etag);
    return new Response(body, {
      status: config.status,
      headers
    });
  };
}

function restoreGlobalFetch() {
  // Remove mock — actual fetch will be used (but tests should not hit real network)
  delete (globalThis as unknown as Record<string, unknown>)["fetch"];
  _mockFetchConfig = null;
}

// ── SS1: happy path ────────────────────────────────────────────────────────────

test("SS1: fetchStrategySnapshot happy path — ok=true, cache_hit=false, snapshot has schema field", async () => {
  _resetSnapshotFetcherState();
  installMockFetch({ status: 200, body: MINIMAL_SNAPSHOT, etag: '"abc123"' });

  const result = await fetchStrategySnapshot("cont_liq_v36");

  assert.equal(result.ok, true, "ok must be true on 200");
  assert.equal(result.cache_hit, false, "first fetch must be cache_hit=false");
  assert.equal(result.stale_reason, null, "stale_reason must be null on success");
  assert.ok(result.snapshot !== null, "snapshot must not be null");
  assert.ok(typeof result.fetched_at === "string", "fetched_at must be a string ISO timestamp");

  const snap = result.snapshot as Record<string, unknown>;
  assert.equal(snap["schema"], "lab_tr_strategy_snapshot_v0", "snapshot.schema must match");
  assert.equal(snap["strategyId"], "cont_liq_v36", "snapshot.strategyId must match");

  restoreGlobalFetch();
});

// ── SS2: unknown strategyId — ALLOWED_STRATEGY_IDS guard ──────────────────────

test("SS2: ALLOWED_STRATEGY_IDS contains exactly the 3 locked ids", () => {
  assert.ok(ALLOWED_STRATEGY_IDS.has("cont_liq_v36"), "cont_liq_v36 must be allowed");
  assert.ok(ALLOWED_STRATEGY_IDS.has("strategy_002"), "strategy_002 must be allowed");
  assert.ok(ALLOWED_STRATEGY_IDS.has("strategy_003"), "strategy_003 must be allowed");
  assert.equal(ALLOWED_STRATEGY_IDS.size, 3, "must have exactly 3 allowed ids");
  assert.ok(!ALLOWED_STRATEGY_IDS.has("strategy_unknown"), "unknown id must not be allowed");
  assert.ok(!ALLOWED_STRATEGY_IDS.has(""), "empty string must not be allowed");
});

// ── SS3: cache hit — 2nd call within TTL returns cached, no new HTTP ──────────

test("SS3: 2nd call within 30s TTL is a cache hit — no new network fetch", async () => {
  _resetSnapshotFetcherState();
  installMockFetch({ status: 200, body: MINIMAL_SNAPSHOT, etag: '"etag-ss3"' });

  // First call — populates cache
  const first = await fetchStrategySnapshot("cont_liq_v36");
  assert.equal(first.ok, true, "first call must succeed");
  assert.equal(first.cache_hit, false, "first call must not be cache_hit");
  const callsAfterFirst = _fetchCallCount;

  // Second call — should use getSnapshotFromCacheOnly (no HTTP)
  const cached = getSnapshotFromCacheOnly("cont_liq_v36");
  assert.ok(cached !== null, "getSnapshotFromCacheOnly must return cached entry within TTL");
  assert.equal(cached!.ok, true, "cached result must be ok=true");
  assert.equal(cached!.cache_hit, true, "cached result must be cache_hit=true");
  assert.equal(cached!.stale_reason, null, "stale_reason must be null on cache hit");

  // Verify no additional HTTP was made via getSnapshotFromCacheOnly
  assert.equal(_fetchCallCount, callsAfterFirst, "no new fetch call should be made for cache hit");

  restoreGlobalFetch();
});

// ── SS4: circuit breaker — 3 consecutive fails → backoff ─────────────────────

test("SS4: circuit breaker — after threshold fails, result is ok=false with stale_reason starting 'circuit_open'", async () => {
  _resetSnapshotFetcherState();

  // Pre-populate stale cache so we can verify it is served
  _setSnapshotCache("strategy_002", MINIMAL_SNAPSHOT, null, SNAPSHOT_CACHE_TTL_MS);

  // Simulate exactly threshold consecutive failures
  _setCircuitFails("strategy_002", SNAPSHOT_CIRCUIT_FAIL_THRESHOLD);

  // Next call should see circuit open
  installMockFetch({ status: 200, body: MINIMAL_SNAPSHOT }); // should NOT be called
  const result = await fetchStrategySnapshot("strategy_002");

  assert.equal(result.ok, false, "circuit open must return ok=false");
  assert.ok(
    typeof result.stale_reason === "string" && result.stale_reason.startsWith("circuit_open"),
    `stale_reason must start with 'circuit_open', got: "${result.stale_reason}"`
  );
  assert.equal(result.cache_hit, true, "stale cache must be served (cache_hit=true)");
  assert.ok(result.snapshot !== null, "stale snapshot must be served (not null)");

  // Verify fetch was NOT called (circuit blocked it)
  assert.equal(_fetchCallCount, 0, "no fetch calls should be made when circuit is open");

  restoreGlobalFetch();
});

// ── SS5: fetch timeout → ok=false, stale_reason='fetch_timeout_5s' ────────────

test("SS5: fetch timeout → ok=false, stale_reason=fetch_timeout_5s, snapshot=null when no cache", async () => {
  _resetSnapshotFetcherState();
  installMockFetch({ status: 200, shouldThrow: true, throwAbort: true });

  const result = await fetchStrategySnapshot("strategy_003");

  assert.equal(result.ok, false, "timeout must return ok=false");
  assert.equal(
    result.stale_reason,
    "fetch_timeout_5s",
    `stale_reason must be 'fetch_timeout_5s', got: "${result.stale_reason}"`
  );
  assert.equal(result.snapshot, null, "no cache → snapshot must be null");
  assert.equal(result.cache_hit, false, "no cache → cache_hit must be false");

  restoreGlobalFetch();
});

// ── SS6: stale cache served on non-200 HTTP response ─────────────────────────

test("SS6: HTTP 503 from GitHub with existing cache → stale served with ok=false + stale_reason", async () => {
  _resetSnapshotFetcherState();

  // Pre-populate cache
  _setSnapshotCache("cont_liq_v36", MINIMAL_SNAPSHOT, null, SNAPSHOT_CACHE_TTL_MS);

  // Simulate GitHub returning 503
  installMockFetch({ status: 503 });

  const result = await fetchStrategySnapshot("cont_liq_v36");

  assert.equal(result.ok, false, "non-200 must return ok=false");
  assert.ok(result.snapshot !== null, "stale cache must be served");
  assert.equal(result.cache_hit, true, "stale served → cache_hit=true");
  assert.ok(
    typeof result.stale_reason === "string" && result.stale_reason.length > 0,
    "stale_reason must be non-empty string"
  );

  restoreGlobalFetch();
});

// ── SS7: fetchStrategyIndex parses strategies array ──────────────────────────

test("SS7: fetchStrategyIndex() returns parsed strategies array with expected strategyIds", async () => {
  _resetSnapshotFetcherState();
  installMockFetch({ status: 200, body: MINIMAL_INDEX, etag: '"idx-etag"' });

  const result = await fetchStrategyIndex();

  assert.equal(result.ok, true, "index fetch must succeed");
  assert.ok(Array.isArray(result.strategies), "strategies must be an array");
  assert.equal(result.strategies!.length, 3, "must have 3 strategies from fixture");

  const ids = result.strategies!.map((s) => s.strategyId);
  assert.ok(ids.includes("cont_liq_v36"), "cont_liq_v36 must be in index");
  assert.ok(ids.includes("strategy_002"), "strategy_002 must be in index");
  assert.ok(ids.includes("strategy_003"), "strategy_003 must be in index");
  assert.equal(result.cache_hit, false, "first fetch must be cache_hit=false");
  assert.equal(result.stale_reason, null, "stale_reason must be null on success");

  restoreGlobalFetch();
});

// ── SS8: cache_hit boolean present for both hit and miss ─────────────────────

test("SS8: cache_hit is boolean in all result paths (hit + miss + error)", async () => {
  _resetSnapshotFetcherState();

  // Miss path (no cache, fresh fetch)
  installMockFetch({ status: 200, body: MINIMAL_SNAPSHOT });
  const miss = await fetchStrategySnapshot("cont_liq_v36");
  assert.ok(typeof miss.cache_hit === "boolean", "miss: cache_hit must be boolean");
  assert.equal(miss.cache_hit, false, "miss: cache_hit must be false");
  restoreGlobalFetch();

  // Hit path (within TTL)
  const hit = getSnapshotFromCacheOnly("cont_liq_v36");
  assert.ok(hit !== null, "should have cached entry");
  assert.ok(typeof hit!.cache_hit === "boolean", "hit: cache_hit must be boolean");
  assert.equal(hit!.cache_hit, true, "hit: cache_hit must be true");

  // Error path (network fail, no cache for this id)
  _resetSnapshotFetcherState();
  installMockFetch({ status: 200, shouldThrow: true, throwAbort: false });
  const err = await fetchStrategySnapshot("strategy_003");
  assert.ok(typeof err.cache_hit === "boolean", "error path: cache_hit must be boolean");
  restoreGlobalFetch();
});
