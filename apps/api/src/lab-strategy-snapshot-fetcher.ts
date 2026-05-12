/**
 * lab-strategy-snapshot-fetcher.ts
 *
 * Per-strategy snapshot consumer for the IUF Quant Lab.
 *
 * Stage 1 design (static JSON, Athena ACK locked 2026-05-09):
 *   - Fetches per-strategy snapshot JSON from GitHub raw URL (no Lab compute coupling).
 *   - 30s ETag cache per strategyId (in-memory Map).
 *   - 5s fetch timeout.
 *   - Circuit breaker: 3 consecutive fetch failures → 60s backoff per strategyId.
 *   - Stale-on-error: serves cached data with stale_reason if available on fetch fail.
 *   - Audit: action='lab.snapshot_fetched' per fetch (fire-and-forget, non-fatal).
 *
 * URL pattern (overrideable via env for dev/staging):
 *   LAB_SNAPSHOT_BASE_URL (default: https://raw.githubusercontent.com/qazabc159/IUF_QUANT_LAB/main)
 *   → {base}/reports/trading_room/strategy_snapshots/{strategyId}_snapshot_v0.json
 *
 * Hard lines:
 *   - No real orders / no broker write / no migration.
 *   - Never swallow fetch error — must surface stale_reason + cache status.
 *   - No token or credentials in the fetch URL (public GitHub raw URL only).
 *   - sampleTrades items must always carry source field per A4 ACK.
 *
 * Lane: backend strategy (Jason only). Do not modify broker / risk / migration / web.
 *
 * Schema: lab_tr_strategy_snapshot_v0 (Athena spec 2026-05-09)
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditLogs, getDb, isDatabaseMode } from "@iuf-trading-room/db";

// ── Constants ──────────────────────────────────────────────────────────────────

const LAB_SNAPSHOT_BASE_URL =
  process.env["LAB_SNAPSHOT_BASE_URL"] ??
  "https://raw.githubusercontent.com/qazabc159/IUF_QUANT_LAB/main";

const SNAPSHOT_PATH_TEMPLATE = (strategyId: string) =>
  `${LAB_SNAPSHOT_BASE_URL}/reports/trading_room/strategy_snapshots/${strategyId}_snapshot_v0.json`;

const INDEX_URL = `${LAB_SNAPSHOT_BASE_URL}/reports/trading_room/strategy_snapshots/_index.json`;

// Option A: resolve relative to compiled file — CWD-agnostic.
// Compiled to apps/api/dist/lab-strategy-snapshot-fetcher.js
// → ../../data/lab/strategy_snapshots = apps/api/data/lab/strategy_snapshots (Railway-safe)
// → ../../../../data/lab/strategy_snapshots = monorepo root data/ (Railway-safe fallback)
const _fileDir = fileURLToPath(new URL(".", import.meta.url));
const LOCAL_SNAPSHOT_DIRS = [
  process.env["LAB_SNAPSHOT_LOCAL_DIR"],
  // Option A primary: relative to compiled file → apps/api/data/lab/strategy_snapshots/
  join(_fileDir, "..", "..", "data", "lab", "strategy_snapshots"),
  // Option A fallback: relative to compiled file → monorepo root data/lab/strategy_snapshots/
  join(_fileDir, "..", "..", "..", "..", "data", "lab", "strategy_snapshots"),
  // Option B: CWD-relative (works when CWD = apps/api, e.g. Railway)
  join(process.cwd(), "data", "lab", "strategy_snapshots"),
  // Legacy path aliases
  join(process.cwd(), "lab-strategy-snapshots")
].filter((dir): dir is string => typeof dir === "string" && dir.length > 0);

/** Allowed strategyId values (A2 ACK — resolver locked). */
export const ALLOWED_STRATEGY_IDS = new Set([
  "cont_liq_v36",
  "strategy_002",
  "strategy_003"
]);

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 30_000;
const CIRCUIT_BREAKER_FAIL_THRESHOLD = 3;
const CIRCUIT_BREAKER_BACKOFF_MS = 60_000;

// ── Types ──────────────────────────────────────────────────────────────────────

export type LabSnapshotSource = "github" | "local_embedded" | "stale_cache";

export type LabSnapshotFetchResult =
  | {
      ok: true;
      snapshot: Record<string, unknown>;
      cache_hit: boolean;
      stale_reason: null;
      fetched_at: string;
      source: LabSnapshotSource;
    }
  | {
      ok: false;
      snapshot: Record<string, unknown> | null;
      cache_hit: boolean;
      stale_reason: string;
      fetched_at: string | null;
      source: LabSnapshotSource;
    };

export type LabIndexFetchResult =
  | {
      ok: true;
      strategies: LabIndexEntry[];
      cache_hit: boolean;
      stale_reason: null;
      fetched_at: string;
    }
  | {
      ok: false;
      strategies: LabIndexEntry[] | null;
      cache_hit: boolean;
      stale_reason: string;
      fetched_at: string | null;
    };

export type LabIndexEntry = {
  strategyId: string;
  displayName?: string;
  status?: string;
  demoOrder?: number;
  snapshotPath?: string;
};

// ── Cache state ────────────────────────────────────────────────────────────────

type CacheEntry = {
  data: Record<string, unknown>;
  etag: string | null;
  expiresAt: number; // Date.now() + 30s
};

type CircuitState = {
  consecutiveFails: number;
  backoffUntil: number; // Date.now() + 60s or 0
};

// per-strategyId cache
const _snapshotCache = new Map<string, CacheEntry>();
// per-strategyId circuit state
const _circuitState = new Map<string, CircuitState>();

// index cache (keyed by special sentinel)
const INDEX_CACHE_KEY = "__index__";
const _indexCache = new Map<string, CacheEntry>();
const _indexCircuit: CircuitState = { consecutiveFails: 0, backoffUntil: 0 };

// ── Test helpers (exported with underscore prefix, not for production use) ────

/** Reset all cache + circuit state. For unit tests only. */
export function _resetSnapshotFetcherState(): void {
  _snapshotCache.clear();
  _circuitState.clear();
  _indexCache.clear();
  _indexCircuit.consecutiveFails = 0;
  _indexCircuit.backoffUntil = 0;
}

/** Override the cache for a given strategyId. For unit tests only. */
export function _setSnapshotCache(
  strategyId: string,
  data: Record<string, unknown>,
  etag: string | null = null,
  ttlMs: number = CACHE_TTL_MS
): void {
  _snapshotCache.set(strategyId, {
    data,
    etag,
    expiresAt: Date.now() + ttlMs
  });
}

/** Simulate consecutive failures for circuit breaker testing. For unit tests only. */
export function _setCircuitFails(strategyId: string, fails: number): void {
  const state = _circuitState.get(strategyId) ?? { consecutiveFails: 0, backoffUntil: 0 };
  state.consecutiveFails = fails;
  if (fails >= CIRCUIT_BREAKER_FAIL_THRESHOLD) {
    state.backoffUntil = Date.now() + CIRCUIT_BREAKER_BACKOFF_MS;
  }
  _circuitState.set(strategyId, state);
}

// ── Circuit breaker helpers ────────────────────────────────────────────────────

function getCircuit(strategyId: string): CircuitState {
  if (!_circuitState.has(strategyId)) {
    _circuitState.set(strategyId, { consecutiveFails: 0, backoffUntil: 0 });
  }
  return _circuitState.get(strategyId)!;
}

function recordSuccess(strategyId: string): void {
  const c = getCircuit(strategyId);
  c.consecutiveFails = 0;
  c.backoffUntil = 0;
}

function recordFailure(strategyId: string): void {
  const c = getCircuit(strategyId);
  c.consecutiveFails += 1;
  if (c.consecutiveFails >= CIRCUIT_BREAKER_FAIL_THRESHOLD) {
    c.backoffUntil = Date.now() + CIRCUIT_BREAKER_BACKOFF_MS;
    console.warn(
      `[lab-snapshot] circuit OPEN for strategyId="${strategyId}" — ` +
        `${CIRCUIT_BREAKER_FAIL_THRESHOLD} consecutive fails; backoff ${CIRCUIT_BREAKER_BACKOFF_MS / 1000}s`
    );
  }
}

function isCircuitOpen(strategyId: string): boolean {
  const c = getCircuit(strategyId);
  if (c.consecutiveFails < CIRCUIT_BREAKER_FAIL_THRESHOLD) return false;
  if (Date.now() < c.backoffUntil) return true;
  // backoff period expired — allow one probe attempt (reset counters)
  c.consecutiveFails = 0;
  c.backoffUntil = 0;
  return false;
}

// ── Audit ──────────────────────────────────────────────────────────────────────

async function writeSnapshotAudit(params: {
  workspaceId: string;
  actorId: string | null;
  strategyId: string;
  cacheHit: boolean;
  ok: boolean;
  staleReason: string | null;
  source?: LabSnapshotSource;
}): Promise<void> {
  if (!isDatabaseMode()) return;
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      workspaceId: params.workspaceId,
      actorId: params.actorId,
      action: "lab.snapshot_fetched" as string,
      entityType: "lab_strategy_snapshot",
      entityId: params.strategyId,
      payload: {
        strategyId: params.strategyId,
        cache_hit: params.cacheHit,
        ok: params.ok,
        stale_reason: params.staleReason,
        source: params.source ?? null
      }
    });
  } catch (err) {
    console.warn(
      "[lab-snapshot] audit log write failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ── Fetch helper ───────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function readLocalJson(fileName: string): Promise<Record<string, unknown> | null> {
  for (const dir of LOCAL_SNAPSHOT_DIRS) {
    try {
      const raw = await readFile(join(dir, fileName), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      console.warn(
        `[lab-snapshot] local bundle read failed for "${fileName}":`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return null;
}

async function readLocalSnapshot(strategyId: string): Promise<Record<string, unknown> | null> {
  return readLocalJson(`${strategyId}_snapshot_v0.json`);
}

async function readLocalIndex(): Promise<Record<string, unknown> | null> {
  return readLocalJson("_index.json");
}

async function serveLocalSnapshotFallback(params: {
  strategyId: string;
  fetchedAt: string;
  auditCtx?: { workspaceId: string; actorId: string | null };
}): Promise<LabSnapshotFetchResult | null> {
  const local = await readLocalSnapshot(params.strategyId);
  if (!local) return null;

  _snapshotCache.set(params.strategyId, {
    data: local,
    etag: "local-bundle",
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  recordSuccess(params.strategyId);

  if (params.auditCtx) {
    void writeSnapshotAudit({
      workspaceId: params.auditCtx.workspaceId,
      actorId: params.auditCtx.actorId,
      strategyId: params.strategyId,
      cacheHit: false,
      ok: true,
      staleReason: null
    });
  }

  return {
    ok: true,
    snapshot: local,
    cache_hit: false,
    stale_reason: null,
    fetched_at: params.fetchedAt,
    source: "local_embedded" as LabSnapshotSource
  };
}

async function serveLocalIndexFallback(fetchedAt: string): Promise<LabIndexFetchResult | null> {
  const local = await readLocalIndex();
  if (!local) return null;

  _indexCache.set(INDEX_CACHE_KEY, {
    data: local,
    etag: "local-bundle",
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  _indexCircuit.consecutiveFails = 0;
  _indexCircuit.backoffUntil = 0;

  return {
    ok: true,
    strategies: parseIndexData(local),
    cache_hit: false,
    stale_reason: null,
    fetched_at: fetchedAt
  };
}

// ── Per-strategy snapshot fetch ───────────────────────────────────────────────

/**
 * Fetch (or return cached) snapshot for a given strategyId.
 *
 * @param strategyId - must be in ALLOWED_STRATEGY_IDS
 * @param auditCtx - optional audit context (workspaceId + actorId); if omitted, audit is skipped
 */
export async function fetchStrategySnapshot(
  strategyId: string,
  auditCtx?: { workspaceId: string; actorId: string | null }
): Promise<LabSnapshotFetchResult> {
  const now = Date.now();
  const fetchedAt = new Date(now).toISOString();

  // 1. Circuit breaker check
  if (isCircuitOpen(strategyId)) {
    const cached = _snapshotCache.get(strategyId);
    const staleReason = `circuit_open_${CIRCUIT_BREAKER_BACKOFF_MS / 1000}s_backoff`;
    if (auditCtx) {
      void writeSnapshotAudit({
        workspaceId: auditCtx.workspaceId,
        actorId: auditCtx.actorId,
        strategyId,
        cacheHit: !!cached,
        ok: false,
        staleReason
      });
    }
    const localFallback = await serveLocalSnapshotFallback({ strategyId, fetchedAt, auditCtx });
    if (localFallback) return localFallback;
    if (cached) {
      return {
        ok: false,
        snapshot: cached.data,
        cache_hit: true,
        stale_reason: staleReason,
        fetched_at: null,
        source: "stale_cache" as LabSnapshotSource
      };
    }
    return {
      ok: false,
      snapshot: null,
      cache_hit: false,
      stale_reason: staleReason,
      fetched_at: null,
      source: "stale_cache" as LabSnapshotSource
    };
  }

  // 2. ETag-aware cache check
  const cached = _snapshotCache.get(strategyId);
  const headers: HeadersInit = {};
  if (cached?.etag) {
    headers["If-None-Match"] = cached.etag;
  }

  // 3. Attempt network fetch
  const url = SNAPSHOT_PATH_TEMPLATE(strategyId);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers });
  } catch (err) {
    // Timeout or network error
    recordFailure(strategyId);
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "fetch_timeout_5s"
        : `fetch_error:${err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80)}`;

    if (auditCtx) {
      void writeSnapshotAudit({
        workspaceId: auditCtx.workspaceId,
        actorId: auditCtx.actorId,
        strategyId,
        cacheHit: !!cached,
        ok: false,
        staleReason: reason
      });
    }

    const localFallback = await serveLocalSnapshotFallback({ strategyId, fetchedAt, auditCtx });
    if (localFallback) return localFallback;

    if (cached) {
      console.warn(`[lab-snapshot] fetch failed for "${strategyId}"; serving stale cache. reason=${reason}`);
      return {
        ok: false,
        snapshot: cached.data,
        cache_hit: true,
        stale_reason: reason,
        fetched_at: null,
        source: "stale_cache" as LabSnapshotSource
      };
    }
    return {
      ok: false,
      snapshot: null,
      cache_hit: false,
      stale_reason: reason,
      fetched_at: null,
      source: "stale_cache" as LabSnapshotSource
    };
  }

  // 4. 304 Not Modified — serve from cache
  if (res.status === 304 && cached) {
    // Extend TTL on 304
    cached.expiresAt = now + CACHE_TTL_MS;
    recordSuccess(strategyId);
    if (auditCtx) {
      void writeSnapshotAudit({
        workspaceId: auditCtx.workspaceId,
        actorId: auditCtx.actorId,
        strategyId,
        cacheHit: true,
        ok: true,
        staleReason: null
      });
    }
    return {
      ok: true,
      snapshot: cached.data,
      cache_hit: true,
      stale_reason: null,
      fetched_at: fetchedAt,
      source: "github" as LabSnapshotSource
    };
  }

  // 5. Non-2xx failure
  if (!res.ok) {
    recordFailure(strategyId);
    const reason =
      res.status === 404
        ? "snapshot_not_found"
        : `github_http_${res.status}`;

    if (auditCtx) {
      void writeSnapshotAudit({
        workspaceId: auditCtx.workspaceId,
        actorId: auditCtx.actorId,
        strategyId,
        cacheHit: !!cached,
        ok: false,
        staleReason: reason
      });
    }

    const localFallback = await serveLocalSnapshotFallback({ strategyId, fetchedAt, auditCtx });
    if (localFallback) return localFallback;

    if (cached) {
      console.warn(`[lab-snapshot] HTTP ${res.status} for "${strategyId}"; serving stale cache.`);
      return {
        ok: false,
        snapshot: cached.data,
        cache_hit: true,
        stale_reason: reason,
        fetched_at: null,
        source: "stale_cache" as LabSnapshotSource
      };
    }
    return {
      ok: false,
      snapshot: null,
      cache_hit: false,
      stale_reason: reason,
      fetched_at: null,
      source: "stale_cache" as LabSnapshotSource
    };
  }

  // 6. Parse JSON
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    recordFailure(strategyId);
    const reason = `json_parse_error:${err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80)}`;
    if (auditCtx) {
      void writeSnapshotAudit({
        workspaceId: auditCtx.workspaceId,
        actorId: auditCtx.actorId,
        strategyId,
        cacheHit: !!cached,
        ok: false,
        staleReason: reason
      });
    }
    if (cached) {
      return {
        ok: false,
        snapshot: cached.data,
        cache_hit: true,
        stale_reason: reason,
        fetched_at: null,
        source: "stale_cache" as LabSnapshotSource
      };
    }
    return {
      ok: false,
      snapshot: null,
      cache_hit: false,
      stale_reason: reason,
      fetched_at: null,
      source: "stale_cache" as LabSnapshotSource
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    recordFailure(strategyId);
    const reason = "invalid_json_not_object";
    if (auditCtx) {
      void writeSnapshotAudit({
        workspaceId: auditCtx.workspaceId,
        actorId: auditCtx.actorId,
        strategyId,
        cacheHit: false,
        ok: false,
        staleReason: reason
      });
    }
    if (cached) {
      return { ok: false, snapshot: cached.data, cache_hit: true, stale_reason: reason, fetched_at: null, source: "stale_cache" as LabSnapshotSource };
    }
    return { ok: false, snapshot: null, cache_hit: false, stale_reason: reason, fetched_at: null, source: "stale_cache" as LabSnapshotSource };
  }

  // 7. Store in cache with ETag
  const data = parsed as Record<string, unknown>;
  const etag = res.headers.get("etag");
  _snapshotCache.set(strategyId, {
    data,
    etag,
    expiresAt: now + CACHE_TTL_MS
  });
  recordSuccess(strategyId);

  if (auditCtx) {
    void writeSnapshotAudit({
      workspaceId: auditCtx.workspaceId,
      actorId: auditCtx.actorId,
      strategyId,
      cacheHit: false,
      ok: true,
      staleReason: null
    });
  }

  return {
    ok: true,
    snapshot: data,
    cache_hit: false,
    stale_reason: null,
    fetched_at: fetchedAt,
    source: "github" as LabSnapshotSource
  };
}

// ── In-process cache hit (no network) ────────────────────────────────────────

/**
 * Return cached snapshot immediately if within TTL, bypassing network entirely.
 * Used to short-circuit 2nd+ requests within the 30s window.
 */
export function getSnapshotFromCacheOnly(strategyId: string): LabSnapshotFetchResult | null {
  const now = Date.now();
  const cached = _snapshotCache.get(strategyId);
  if (!cached || now > cached.expiresAt) return null;
  return {
    ok: true,
    snapshot: cached.data,
    cache_hit: true,
    stale_reason: null,
    fetched_at: new Date(now).toISOString(),
    source: "github" as LabSnapshotSource
  };
}

// ── Index fetch (aggregate list) ──────────────────────────────────────────────

/**
 * Fetch (or return cached) _index.json from Lab repo.
 * Used by GET /api/v1/lab/three-strategy/snapshot to return list of strategyIds
 * with displayName + status for the 3-card frontend list.
 */
export async function fetchStrategyIndex(auditCtx?: {
  workspaceId: string;
  actorId: string | null;
}): Promise<LabIndexFetchResult> {
  const now = Date.now();
  const fetchedAt = new Date(now).toISOString();

  // Circuit breaker
  if (
    _indexCircuit.consecutiveFails >= CIRCUIT_BREAKER_FAIL_THRESHOLD &&
    now < _indexCircuit.backoffUntil
  ) {
    const cached = _indexCache.get(INDEX_CACHE_KEY);
    const staleReason = `circuit_open_${CIRCUIT_BREAKER_BACKOFF_MS / 1000}s_backoff`;
    const localFallback = await serveLocalIndexFallback(fetchedAt);
    if (localFallback) return localFallback;
    if (cached) {
      const entries = parseIndexData(cached.data);
      return { ok: false, strategies: entries, cache_hit: true, stale_reason: staleReason, fetched_at: null };
    }
    return { ok: false, strategies: null, cache_hit: false, stale_reason: staleReason, fetched_at: null };
  }

  // ETag cache check
  const cached = _indexCache.get(INDEX_CACHE_KEY);
  const headers: HeadersInit = {};
  if (cached?.etag) {
    headers["If-None-Match"] = cached.etag;
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(INDEX_URL, { headers });
  } catch (err) {
    _indexCircuit.consecutiveFails += 1;
    if (_indexCircuit.consecutiveFails >= CIRCUIT_BREAKER_FAIL_THRESHOLD) {
      _indexCircuit.backoffUntil = now + CIRCUIT_BREAKER_BACKOFF_MS;
    }
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "fetch_timeout_5s"
        : `fetch_error:${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`;
    const localFallback = await serveLocalIndexFallback(fetchedAt);
    if (localFallback) return localFallback;
    if (cached) {
      const entries = parseIndexData(cached.data);
      return { ok: false, strategies: entries, cache_hit: true, stale_reason: reason, fetched_at: null };
    }
    return { ok: false, strategies: null, cache_hit: false, stale_reason: reason, fetched_at: null };
  }

  if (res.status === 304 && cached) {
    cached.expiresAt = now + CACHE_TTL_MS;
    _indexCircuit.consecutiveFails = 0;
    _indexCircuit.backoffUntil = 0;
    const entries = parseIndexData(cached.data);
    return { ok: true, strategies: entries, cache_hit: true, stale_reason: null, fetched_at: fetchedAt };
  }

  if (!res.ok) {
    _indexCircuit.consecutiveFails += 1;
    const reason = res.status === 404 ? "index_not_found" : `github_http_${res.status}`;
    const localFallback = await serveLocalIndexFallback(fetchedAt);
    if (localFallback) return localFallback;
    if (cached) {
      const entries = parseIndexData(cached.data);
      return { ok: false, strategies: entries, cache_hit: true, stale_reason: reason, fetched_at: null };
    }
    return { ok: false, strategies: null, cache_hit: false, stale_reason: reason, fetched_at: null };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    _indexCircuit.consecutiveFails += 1;
    const reason = "json_parse_error";
    if (cached) {
      const entries = parseIndexData(cached.data);
      return { ok: false, strategies: entries, cache_hit: true, stale_reason: reason, fetched_at: null };
    }
    return { ok: false, strategies: null, cache_hit: false, stale_reason: reason, fetched_at: null };
  }

  if (typeof parsed !== "object" || parsed === null) {
    _indexCircuit.consecutiveFails += 1;
    if (cached) {
      const entries = parseIndexData(cached.data);
      return { ok: false, strategies: entries, cache_hit: true, stale_reason: "invalid_json_not_object", fetched_at: null };
    }
    return { ok: false, strategies: null, cache_hit: false, stale_reason: "invalid_json_not_object", fetched_at: null };
  }

  const data = parsed as Record<string, unknown>;
  const etag = res.headers.get("etag");
  _indexCache.set(INDEX_CACHE_KEY, { data, etag, expiresAt: now + CACHE_TTL_MS });
  _indexCircuit.consecutiveFails = 0;
  _indexCircuit.backoffUntil = 0;

  const entries = parseIndexData(data);
  return { ok: true, strategies: entries, cache_hit: false, stale_reason: null, fetched_at: fetchedAt };
}

function parseIndexData(data: Record<string, unknown>): LabIndexEntry[] {
  if (!Array.isArray(data["strategies"])) return [];
  return (data["strategies"] as unknown[]).map((item) => {
    if (typeof item !== "object" || item === null) return { strategyId: "unknown" };
    const entry = item as Record<string, unknown>;
    return {
      strategyId: typeof entry["strategyId"] === "string" ? entry["strategyId"] : "unknown",
      displayName: typeof entry["displayName"] === "string" ? entry["displayName"] : undefined,
      status: typeof entry["status"] === "string" ? entry["status"] : undefined,
      demoOrder: typeof entry["demoOrder"] === "number" ? entry["demoOrder"] : undefined,
      snapshotPath: typeof entry["snapshotPath"] === "string" ? entry["snapshotPath"] : undefined
    };
  });
}

// ── Expose CACHE_TTL_MS for test assertions ───────────────────────────────────
export const SNAPSHOT_CACHE_TTL_MS = CACHE_TTL_MS;
export const SNAPSHOT_CIRCUIT_FAIL_THRESHOLD = CIRCUIT_BREAKER_FAIL_THRESHOLD;
export const SNAPSHOT_CIRCUIT_BACKOFF_MS = CIRCUIT_BREAKER_BACKOFF_MS;
