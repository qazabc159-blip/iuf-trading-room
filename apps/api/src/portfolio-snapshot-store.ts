/**
 * portfolio-snapshot-store.ts
 *
 * OpenAlice Trading-as-Git Phase A — Portfolio Snapshot Store
 *
 * Dual-mode persistence:
 *
 * PERSISTENCE_MODE=database (Railway production):
 *   → PostgreSQL via Drizzle ORM (portfolio_snapshots + portfolio_diffs tables, migration 0037)
 *   → Survives container restarts / redeployments
 *
 * PERSISTENCE_MODE=memory (CI / local dev without DB):
 *   → In-process Maps
 *   → Equivalent behaviour within a single process
 *   → Does NOT survive restarts (acceptable for CI / local dev)
 *
 * Phase A scope:
 *   - createSnapshot()       — write snapshot + compute/write diff vs parent
 *   - listSnapshots()        — cursor-based list (by createdAt DESC)
 *   - getSnapshotById()      — fetch single snapshot
 *   - getSnapshotDiffs()     — diffs for a snapshot (where to_snapshot_id = snapshotId)
 *   - computePositionDiff()  — pure function, exported for tests
 *
 * Phase B (not here):
 *   - EOD auto-snapshot job
 *   - strategy_param_versions
 *   - branch/rollback execution
 *   - live broker integration
 */

import { z } from "zod";
import { eq, desc, and, lt } from "drizzle-orm";
import { isDatabaseMode, getDb, portfolioSnapshots, portfolioDiffs } from "@iuf-trading-room/db";

// ---------------------------------------------------------------------------
// Position schema (Zod)
// ---------------------------------------------------------------------------

export const positionSchema = z.object({
  shares:     z.number().nonnegative(),
  avgCost:    z.number().nonnegative(),
  sector:     z.string().optional(),
  lastPrice:  z.number().nonnegative().optional()
});

export const positionsMapSchema = z.record(z.string(), positionSchema);

export type Position = z.infer<typeof positionSchema>;
export type PositionsMap = z.infer<typeof positionsMapSchema>;

export const snapshotTriggerSchema = z.enum(["manual", "strategy_run", "eod_auto", "rollback"]);
export type SnapshotTrigger = z.infer<typeof snapshotTriggerSchema>;

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export interface PositionChange {
  from: Position;
  to:   Position;
}

export interface PositionDiff {
  added:    PositionsMap;             // ticker → position (new)
  removed:  PositionsMap;             // ticker → position (deleted)
  changed:  Record<string, PositionChange>; // ticker → {from, to}
  summary:  string;
}

// ---------------------------------------------------------------------------
// In-process fallback store (memory mode OR DB unavailable)
// ---------------------------------------------------------------------------

export interface SnapshotRecord {
  id:            string;
  workspaceId:   string;
  parentId:      string | null;
  positions:     PositionsMap;
  trigger:       SnapshotTrigger;
  triggerRefId:  string | null;
  metadata:      Record<string, unknown>;
  createdAt:     Date;
}

export interface DiffRecord {
  id:               string;
  fromSnapshotId:   string | null;
  toSnapshotId:     string;
  addedPositions:   PositionsMap;
  removedPositions: PositionsMap;
  changedPositions: Record<string, PositionChange>;
  summary:          string;
  createdAt:        Date;
}

// memory-mode store: workspaceId → SnapshotRecord[]
const _memSnapshots = new Map<string, SnapshotRecord[]>();
// memory-mode diff store: toSnapshotId → DiffRecord
const _memDiffs = new Map<string, DiffRecord>();

/** Test helper: reset all in-memory state. */
export function _resetPortfolioSnapshotStoreForTests(): void {
  _memSnapshots.clear();
  _memDiffs.clear();
}

// ---------------------------------------------------------------------------
// computePositionDiff — pure function, no I/O
// ---------------------------------------------------------------------------

export function computePositionDiff(
  from: PositionsMap,
  to:   PositionsMap
): PositionDiff {
  const fromTickers = new Set(Object.keys(from));
  const toTickers   = new Set(Object.keys(to));

  const added:   PositionsMap                   = {};
  const removed: PositionsMap                   = {};
  const changed: Record<string, PositionChange> = {};

  // Tickers in to but not from → added
  for (const ticker of toTickers) {
    if (!fromTickers.has(ticker)) {
      added[ticker] = to[ticker]!;
    }
  }

  // Tickers in from but not to → removed
  for (const ticker of fromTickers) {
    if (!toTickers.has(ticker)) {
      removed[ticker] = from[ticker]!;
    }
  }

  // Tickers in both → check if changed
  for (const ticker of fromTickers) {
    if (!toTickers.has(ticker)) continue;
    const f = from[ticker]!;
    const t = to[ticker]!;
    if (
      f.shares    !== t.shares   ||
      f.avgCost   !== t.avgCost  ||
      f.sector    !== t.sector   ||
      f.lastPrice !== t.lastPrice
    ) {
      changed[ticker] = { from: f, to: t };
    }
  }

  const addedCount   = Object.keys(added).length;
  const removedCount = Object.keys(removed).length;
  const changedCount = Object.keys(changed).length;

  const parts: string[] = [];
  if (addedCount > 0)   parts.push(`+${addedCount} added`);
  if (removedCount > 0) parts.push(`-${removedCount} removed`);
  if (changedCount > 0) parts.push(`~${changedCount} changed`);
  const summary = parts.length > 0 ? parts.join(", ") : "no change";

  return { added, removed, changed, summary };
}

// ---------------------------------------------------------------------------
// createSnapshot
// ---------------------------------------------------------------------------

export async function createSnapshot(opts: {
  workspaceId:   string;
  positions:     PositionsMap;
  trigger:       SnapshotTrigger;
  triggerRefId?: string | null;
  metadata?:     Record<string, unknown>;
}): Promise<SnapshotRecord> {
  const { workspaceId, positions, trigger, triggerRefId = null, metadata = {} } = opts;

  // Validate positions
  positionsMapSchema.parse(positions);
  snapshotTriggerSchema.parse(trigger);

  const id        = crypto.randomUUID();
  const createdAt = new Date();

  if (!isDatabaseMode()) {
    // Memory mode
    const existing = _memSnapshots.get(workspaceId) ?? [];
    const parentId = existing.length > 0 ? (existing[existing.length - 1]?.id ?? null) : null;

    const snapshot: SnapshotRecord = {
      id, workspaceId, parentId, positions, trigger,
      triggerRefId, metadata, createdAt
    };

    // Compute + store diff
    if (parentId !== null) {
      const parentSnap = existing[existing.length - 1]!;
      const diff = computePositionDiff(parentSnap.positions, positions);
      const diffRecord: DiffRecord = {
        id:               crypto.randomUUID(),
        fromSnapshotId:   parentId,
        toSnapshotId:     id,
        addedPositions:   diff.added,
        removedPositions: diff.removed,
        changedPositions: diff.changed,
        summary:          diff.summary,
        createdAt
      };
      _memDiffs.set(id, diffRecord);
    } else {
      // Root snapshot: diff from empty
      const diff = computePositionDiff({}, positions);
      const diffRecord: DiffRecord = {
        id:               crypto.randomUUID(),
        fromSnapshotId:   null,
        toSnapshotId:     id,
        addedPositions:   diff.added,
        removedPositions: diff.removed,
        changedPositions: diff.changed,
        summary:          diff.summary,
        createdAt
      };
      _memDiffs.set(id, diffRecord);
    }

    existing.push(snapshot);
    _memSnapshots.set(workspaceId, existing);
    return snapshot;
  }

  // Database mode
  const db = getDb();
  if (!db) {
    // Fallback to memory
    return createSnapshotMemoryFallback({ id, workspaceId, positions, trigger, triggerRefId, metadata, createdAt });
  }

  try {
    // Find latest existing snapshot for this workspace to determine parentId
    const latestRows = await db
      .select({ id: portfolioSnapshots.id, positions: portfolioSnapshots.positions })
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.workspaceId, workspaceId))
      .orderBy(desc(portfolioSnapshots.createdAt))
      .limit(1);

    const parentRow   = latestRows[0] ?? null;
    const parentId    = parentRow?.id ?? null;
    const parentPositions = (parentRow?.positions ?? {}) as PositionsMap;

    // Insert snapshot
    const [inserted] = await db.insert(portfolioSnapshots).values({
      id,
      workspaceId,
      parentId,
      positions,
      trigger,
      triggerRefId,
      metadata,
      createdAt
    }).returning();

    // Compute and write diff
    const diff = computePositionDiff(parentPositions, positions);
    await db.insert(portfolioDiffs).values({
      id:               crypto.randomUUID(),
      fromSnapshotId:   parentId,
      toSnapshotId:     id,
      addedPositions:   diff.added,
      removedPositions: diff.removed,
      changedPositions: diff.changed,
      summary:          diff.summary,
      createdAt
    });

    return dbRowToSnapshot(inserted!);
  } catch (err) {
    console.warn("[portfolio-snapshot-store] DB write failed, falling back to memory:", err);
    return createSnapshotMemoryFallback({ id, workspaceId, positions, trigger, triggerRefId, metadata, createdAt });
  }
}

// memory fallback helper (avoids duplicating the memory logic)
function createSnapshotMemoryFallback(opts: {
  id: string; workspaceId: string; positions: PositionsMap;
  trigger: SnapshotTrigger; triggerRefId: string | null;
  metadata: Record<string, unknown>; createdAt: Date;
}): SnapshotRecord {
  const { id, workspaceId, positions, trigger, triggerRefId, metadata, createdAt } = opts;
  const existing = _memSnapshots.get(workspaceId) ?? [];
  const parentId = existing.length > 0 ? (existing[existing.length - 1]?.id ?? null) : null;
  const parentPositions = parentId !== null ? (existing[existing.length - 1]!.positions) : {};
  const snapshot: SnapshotRecord = { id, workspaceId, parentId, positions, trigger, triggerRefId, metadata, createdAt };
  const diff = computePositionDiff(parentPositions, positions);
  _memDiffs.set(id, {
    id: crypto.randomUUID(), fromSnapshotId: parentId, toSnapshotId: id,
    addedPositions: diff.added, removedPositions: diff.removed,
    changedPositions: diff.changed, summary: diff.summary, createdAt
  });
  existing.push(snapshot);
  _memSnapshots.set(workspaceId, existing);
  return snapshot;
}

// ---------------------------------------------------------------------------
// listSnapshots — cursor-based pagination
// ---------------------------------------------------------------------------

export async function listSnapshots(opts: {
  workspaceId: string;
  limit:       number;
  before?:     string | null; // snapshot id to paginate before
}): Promise<SnapshotRecord[]> {
  const { workspaceId, limit, before = null } = opts;
  const safeLimit = Math.min(Math.max(1, limit), 100);

  if (!isDatabaseMode()) {
    const all = (_memSnapshots.get(workspaceId) ?? []).slice().reverse(); // newest first
    if (!before) return all.slice(0, safeLimit);
    const idx = all.findIndex((s) => s.id === before);
    return idx === -1 ? [] : all.slice(idx + 1, idx + 1 + safeLimit);
  }

  const db = getDb();
  if (!db) return [];

  try {
    if (before) {
      // Cursor: find the createdAt of the cursor row, then filter rows older than it
      const cursorRows = await db
        .select({ createdAt: portfolioSnapshots.createdAt })
        .from(portfolioSnapshots)
        .where(eq(portfolioSnapshots.id, before))
        .limit(1);

      if (cursorRows.length === 0) return [];
      const cursorDate = cursorRows[0]!.createdAt;

      const rows = await db
        .select()
        .from(portfolioSnapshots)
        .where(and(
          eq(portfolioSnapshots.workspaceId, workspaceId),
          lt(portfolioSnapshots.createdAt, cursorDate)
        ))
        .orderBy(desc(portfolioSnapshots.createdAt))
        .limit(safeLimit);

      return rows.map(dbRowToSnapshot);
    }

    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.workspaceId, workspaceId))
      .orderBy(desc(portfolioSnapshots.createdAt))
      .limit(safeLimit);

    return rows.map(dbRowToSnapshot);
  } catch (err) {
    console.warn("[portfolio-snapshot-store] listSnapshots DB error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// getSnapshotById
// ---------------------------------------------------------------------------

export async function getSnapshotById(id: string): Promise<SnapshotRecord | null> {
  if (!isDatabaseMode()) {
    for (const snapshots of _memSnapshots.values()) {
      const found = snapshots.find((s) => s.id === id);
      if (found) return found;
    }
    return null;
  }

  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.id, id))
      .limit(1);

    return rows[0] ? dbRowToSnapshot(rows[0]) : null;
  } catch (err) {
    console.warn("[portfolio-snapshot-store] getSnapshotById DB error:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// getSnapshotDiffs — diffs where to_snapshot_id = snapshotId
// ---------------------------------------------------------------------------

export async function getSnapshotDiffs(snapshotId: string): Promise<DiffRecord[]> {
  if (!isDatabaseMode()) {
    const diff = _memDiffs.get(snapshotId);
    return diff ? [diff] : [];
  }

  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select()
      .from(portfolioDiffs)
      .where(eq(portfolioDiffs.toSnapshotId, snapshotId));

    return rows.map(dbRowToDiff);
  } catch (err) {
    console.warn("[portfolio-snapshot-store] getSnapshotDiffs DB error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// computeSnapshotDiff — on-demand diff between two arbitrary snapshots
// ---------------------------------------------------------------------------

export async function computeSnapshotDiff(
  fromId: string,
  toId:   string
): Promise<PositionDiff | null> {
  const [fromSnap, toSnap] = await Promise.all([
    getSnapshotById(fromId),
    getSnapshotById(toId)
  ]);

  if (!fromSnap || !toSnap) return null;
  return computePositionDiff(fromSnap.positions, toSnap.positions);
}

// ---------------------------------------------------------------------------
// DB row → record mappers
// ---------------------------------------------------------------------------

function dbRowToSnapshot(row: typeof portfolioSnapshots.$inferSelect): SnapshotRecord {
  return {
    id:            row.id,
    workspaceId:   row.workspaceId,
    parentId:      row.parentId ?? null,
    positions:     (row.positions ?? {}) as PositionsMap,
    trigger:       row.trigger as SnapshotTrigger,
    triggerRefId:  row.triggerRefId ?? null,
    metadata:      (row.metadata ?? {}) as Record<string, unknown>,
    createdAt:     row.createdAt
  };
}

function dbRowToDiff(row: typeof portfolioDiffs.$inferSelect): DiffRecord {
  return {
    id:               row.id,
    fromSnapshotId:   row.fromSnapshotId ?? null,
    toSnapshotId:     row.toSnapshotId,
    addedPositions:   (row.addedPositions ?? {}) as PositionsMap,
    removedPositions: (row.removedPositions ?? {}) as PositionsMap,
    changedPositions: (row.changedPositions ?? {}) as Record<string, PositionChange>,
    summary:          row.summary,
    createdAt:        row.createdAt
  };
}
