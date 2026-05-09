/**
 * strategy-runs-store.ts
 *
 * Dual-mode persistence for strategy runs:
 *
 * PERSISTENCE_MODE=database (Railway production):
 *   → PostgreSQL via Drizzle ORM (strategy_runs table, migration 0029)
 *   → Survives container restarts / redeployments
 *
 * PERSISTENCE_MODE=memory (CI / local dev without DB):
 *   → In-process Map<workspaceSlug, StrategyRunRecord[]>
 *   → Equivalent to the old JSONL behaviour within a single process
 *   → Does NOT survive restarts (acceptable for CI / local dev)
 *
 * API surface is unchanged from the old JSONL implementation so strategy-engine.ts
 * needs zero changes:
 *   loadPersistedStrategyRuns(workspaceSlug)  → StrategyRunRecord[]
 *   appendPersistedStrategyRun(slug, run)     → void
 *   resetPersistedStrategyRuns(slug)          → void
 *
 * DB unavailable despite PERSISTENCE_MODE=database:
 *   → falls back to in-process Map + console.warn; never throws.
 */

import { eq, desc } from "drizzle-orm";

import { isDatabaseMode, getDb, strategyRuns, workspaces } from "@iuf-trading-room/db";
import { strategyRunRecordSchema, type StrategyRunRecord } from "@iuf-trading-room/contracts";

// ---------------------------------------------------------------------------
// In-process fallback store (memory mode OR DB unavailable)
// ---------------------------------------------------------------------------

const _memoryStore = new Map<string, StrategyRunRecord[]>();

/** Test helper: clear in-memory store for a slug (or all if no slug given). */
export function _resetMemoryStore(slug?: string) {
  if (slug) {
    _memoryStore.delete(slug);
  } else {
    _memoryStore.clear();
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/**
 * Resolve workspace UUID from slug.
 * Strategy-engine passes workspaceSlug (e.g. "default"); the DB FK requires UUID.
 * Cached in-process per slug to avoid repeated SELECTs.
 */
const _slugToId = new Map<string, string>();

async function resolveWorkspaceId(slug: string): Promise<string | null> {
  const cached = _slugToId.get(slug);
  if (cached) return cached;

  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);

    const id = rows[0]?.id ?? null;
    if (id) _slugToId.set(slug, id);
    return id;
  } catch (err) {
    console.warn(
      "[strategy-runs-store] resolveWorkspaceId failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** Reset slug→id cache (test helper). */
export function _resetSlugCache() {
  _slugToId.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all strategy runs for a workspace, sorted most-recent-first.
 *
 * DB mode: SELECT from strategy_runs WHERE workspace_id = ?  ORDER BY created_at DESC
 * Memory mode: returns slice of in-process Map, sorted desc
 * DB unavailable: falls back to in-process Map + console.warn
 */
export async function loadPersistedStrategyRuns(workspaceSlug: string): Promise<StrategyRunRecord[]> {
  // ── DB path ──────────────────────────────────────────────────────────────
  if (isDatabaseMode()) {
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch (err) {
      console.warn(
        "[strategy-runs-store] getDb() failed (falling back to memory):",
        err instanceof Error ? err.message : String(err)
      );
      return _memoryLoad(workspaceSlug);
    }

    if (!db) return _memoryLoad(workspaceSlug);

    const workspaceId = await resolveWorkspaceId(workspaceSlug);
    if (!workspaceId) {
      console.warn("[strategy-runs-store] workspace not found for slug:", workspaceSlug);
      return [];
    }

    try {
      const rows = await db
        .select({ payload: strategyRuns.payload })
        .from(strategyRuns)
        .where(eq(strategyRuns.workspaceId, workspaceId))
        .orderBy(desc(strategyRuns.createdAt));

      return rows.flatMap((row) => {
        try {
          return [strategyRunRecordSchema.parse(row.payload)];
        } catch {
          return [];
        }
      });
    } catch (err) {
      console.warn(
        "[strategy-runs-store] load query failed (falling back to memory):",
        err instanceof Error ? err.message : String(err)
      );
      return _memoryLoad(workspaceSlug);
    }
  }

  // ── Memory path ───────────────────────────────────────────────────────────
  return _memoryLoad(workspaceSlug);
}

/**
 * Insert/append a new strategy run.
 *
 * DB mode: INSERT INTO strategy_runs ...
 * Memory mode: push to in-process Map
 * DB unavailable: falls back to in-process Map + console.warn
 */
export async function appendPersistedStrategyRun(
  workspaceSlug: string,
  run: StrategyRunRecord
): Promise<void> {
  // ── DB path ──────────────────────────────────────────────────────────────
  if (isDatabaseMode()) {
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch (err) {
      console.warn(
        "[strategy-runs-store] getDb() failed (falling back to memory):",
        err instanceof Error ? err.message : String(err)
      );
      _memoryAppend(workspaceSlug, run);
      return;
    }

    if (!db) {
      _memoryAppend(workspaceSlug, run);
      return;
    }

    const workspaceId = await resolveWorkspaceId(workspaceSlug);
    if (!workspaceId) {
      console.warn(
        "[strategy-runs-store] workspace not found for slug:",
        workspaceSlug,
        "— run NOT persisted to DB, stored in memory"
      );
      _memoryAppend(workspaceSlug, run);
      return;
    }

    // Derive a human-readable label from query params (best-effort)
    const runLabel = [
      run.query.market ?? "",
      run.query.symbol ?? "",
      run.query.decisionMode ?? "strategy",
      new Date(run.createdAt).toISOString().slice(0, 10)
    ]
      .filter(Boolean)
      .join(" | ") || `run-${run.id.slice(0, 8)}`;

    // Primary strategy identifier from first output symbol
    const strategyId = run.outputs[0]?.symbol ?? "multi";

    try {
      await db.insert(strategyRuns).values({
        id:                 run.id,
        workspaceId,
        strategyId,
        runLabel,
        status:             "passed",
        candidatesCount:    run.summary.total,
        observableCount:    run.summary.allow,
        pendingReviewCount: run.summary.review,
        rejectedCount:      run.summary.block,
        payload:            run as unknown as Record<string, unknown>
      });
    } catch (err) {
      console.warn(
        "[strategy-runs-store] insert failed (storing in memory as fallback):",
        err instanceof Error ? err.message : String(err)
      );
      _memoryAppend(workspaceSlug, run);
    }
    return;
  }

  // ── Memory path ───────────────────────────────────────────────────────────
  _memoryAppend(workspaceSlug, run);
}

/**
 * Delete all strategy runs for a workspace.
 * Used in dev/test resets; not called in production flow.
 */
export async function resetPersistedStrategyRuns(workspaceSlug: string): Promise<void> {
  // Always clear in-memory regardless of mode
  _memoryStore.delete(workspaceSlug);

  if (!isDatabaseMode()) return;

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
    if (!db) return;
  } catch (err) {
    console.warn(
      "[strategy-runs-store] getDb() failed during reset:",
      err instanceof Error ? err.message : String(err)
    );
    return;
  }

  const workspaceId = await resolveWorkspaceId(workspaceSlug);
  if (!workspaceId) return;

  try {
    await db.delete(strategyRuns).where(eq(strategyRuns.workspaceId, workspaceId));
    _slugToId.delete(workspaceSlug);
  } catch (err) {
    console.warn(
      "[strategy-runs-store] reset failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

// ---------------------------------------------------------------------------
// In-process memory helpers (private)
// ---------------------------------------------------------------------------

function _memoryLoad(workspaceSlug: string): StrategyRunRecord[] {
  const runs = _memoryStore.get(workspaceSlug) ?? [];
  // Return copy sorted most-recent-first (same as DB query)
  return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function _memoryAppend(workspaceSlug: string, run: StrategyRunRecord) {
  const existing = _memoryStore.get(workspaceSlug) ?? [];
  _memoryStore.set(workspaceSlug, [...existing, run]);
}
