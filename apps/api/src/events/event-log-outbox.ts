/**
 * event-log-outbox.ts -- EventLog Phase B — Outbox pattern
 *
 * B-EL-4: Transactional event publishing via outbox table.
 *
 * Problem Phase A had:
 *   appendEvent() writes el_events, then in-process SSE broadcast.
 *   If worker crashes between DB write and broadcast, subscribers miss the event.
 *
 * Solution (Outbox pattern):
 *   appendEventWithOutbox() writes BOTH el_events AND el_outbox in ONE DB transaction.
 *   A background poller drains pending el_outbox rows:
 *     1. SELECT ... WHERE delivered_at IS NULL with bounded backoff
 *     2. Broadcast to registered SSE broadcasters
 *     3. UPDATE el_outbox SET delivered_at = NOW()
 *     4. On failure: error_count++; >= 5 marks as fatally failed
 *
 * Usage:
 *   - Call appendEventWithOutbox() instead of appendEvent() for critical paths.
 *   - appendEvent() still works for non-critical paths (backward compat).
 *   - Call startOutboxPoller() once at server startup.
 *
 * Non-DB mode: memory-mode falls through to appendEvent() (outbox is DB-only).
 *
 * AGPL compliance: IUF-original design. No OpenAlice source code referenced.
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { elEvents, elEventStreams, elOutbox, getDb, isDatabaseMode } from "@iuf-trading-room/db";
import { appendEvent, type AppendEventInput, type AppendEventResult } from "./event-log-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutboxBroadcaster = (event: {
  eventId: string;
  streamId: string;
  eventType: string;
  payload: Record<string, unknown>;
  seq: number;
}) => void | Promise<void>;

// ---------------------------------------------------------------------------
// In-memory state (per-process)
// ---------------------------------------------------------------------------

const _broadcasters: OutboxBroadcaster[] = [];
let _pollerHandle: ReturnType<typeof setInterval> | null = null;
let _initialPollerHandle: ReturnType<typeof setTimeout> | null = null;
let _pollInFlight = false;
let _pollFailureCount = 0;
let _pollBackoffUntil = 0;
const POLLER_INTERVAL_MS = 5_000;
const POLLER_INITIAL_DELAY_MS = 120_000;
const POLLER_MAX_BACKOFF_MS = 60_000;
const MAX_ERROR_COUNT = 5;
const POLLER_BATCH_SIZE = 50;

// Fatal failure sentinel: epoch timestamp = delivered_at in permanently-failed state
const EPOCH_TS = new Date(0); // 1970-01-01T00:00:00.000Z

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a broadcaster called by the poller when an outbox event is ready.
 * Typically this is the SSE push function.
 * Broadcasters run in parallel. If one throws, error_count increments.
 */
export function registerOutboxBroadcaster(fn: OutboxBroadcaster): void {
  _broadcasters.push(fn);
}

/**
 * Append an event AND write an outbox record in a single DB transaction.
 *
 * In non-DB mode: falls through to appendEvent() (outbox is DB-only).
 *
 * @param input     Standard AppendEventInput (same as appendEvent).
 * @returns         Same AppendEventResult as appendEvent.
 */
export async function appendEventWithOutbox(
  input: AppendEventInput
): Promise<AppendEventResult> {
  if (!isDatabaseMode()) {
    return appendEvent(input);
  }

  const db = getDb();
  if (!db) {
    return appendEvent(input);
  }

  return db.transaction(async (tx) => {
    // 1. Upsert stream
    const [streamRow] = await tx
      .insert(elEventStreams)
      .values({
        workspaceId: input.workspaceId,
        streamType: input.streamType,
        streamId: input.streamId,
        metadata: {}
      })
      .onConflictDoUpdate({
        target: [elEventStreams.workspaceId, elEventStreams.streamType, elEventStreams.streamId],
        set: { streamType: elEventStreams.streamType }
      })
      .returning({ id: elEventStreams.id });

    if (!streamRow) throw new Error("el_event_streams upsert returned no row");
    const streamRowId = streamRow.id;

    // 2. Compute next seq atomically. PostgreSQL cannot apply FOR UPDATE to an
    // aggregate query, so lock by stream UUID first, then read MAX(seq).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${streamRowId}, 0))`);
    const seqResult = await tx.execute(
      sql`SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM el_events WHERE stream_id = ${streamRowId}`
    );
    const seqRaw: unknown = seqResult;
    const seqRows: { next_seq: unknown }[] = Array.isArray(seqRaw)
      ? (seqRaw as { next_seq: unknown }[])
      : ((seqRaw as { rows?: { next_seq: unknown }[] }).rows ?? []);
    const nextSeq = Number(seqRows[0]?.next_seq ?? 1);

    // 3. Insert event row
    const now = new Date();
    const occurredAt = input.occurredAt ?? now;
    const [eventRow] = await tx
      .insert(elEvents)
      .values({
        streamId: streamRowId,
        seq: nextSeq,
        eventType: input.eventType,
        schemaVersion: input.schemaVersion ?? 1,
        actorId: input.actorId ?? null,
        payload: input.payload,
        occurredAt,
        recordedAt: now
      })
      .returning({ id: elEvents.id, seq: elEvents.seq, recordedAt: elEvents.recordedAt });

    if (!eventRow) throw new Error("el_events insert returned no row");

    // 4. Insert outbox record atomically in the same TX
    await tx.insert(elOutbox).values({
      id: randomUUID(),
      eventId: eventRow.id,
      streamId: streamRowId,
      eventType: input.eventType,
      payload: input.payload,
      seq: nextSeq,
      deliveredAt: null,
      errorCount: 0
    });

    return {
      id: eventRow.id,
      seq: eventRow.seq,
      recordedAt: eventRow.recordedAt.toISOString()
    };
  });
}

// ---------------------------------------------------------------------------
// Outbox poller
// ---------------------------------------------------------------------------

/**
 * Start the outbox poller. Idempotent — calling multiple times is a no-op.
 * Call once at server startup.
 *
 * The poller intentionally starts after the API boot gate. EventLog delivery is
 * important, but it must not starve auth/login or market data during deploy.
 *
 * @param extraBroadcaster  Optional one-off broadcaster added to registry.
 */
export function startOutboxPoller(extraBroadcaster?: OutboxBroadcaster): void {
  if (extraBroadcaster) {
    registerOutboxBroadcaster(extraBroadcaster);
  }

  if (_pollerHandle !== null || _initialPollerHandle !== null) {
    return; // already running
  }

  if (!isDatabaseMode()) {
    console.info("[outbox-poller] Non-DB mode — poller skipped");
    return;
  }

  console.info(
    `[outbox-poller] Starting (initialDelay=${POLLER_INITIAL_DELAY_MS}ms interval=${POLLER_INTERVAL_MS}ms batch=${POLLER_BATCH_SIZE})`
  );

  const startInterval = () => {
    _initialPollerHandle = null;
    _pollerHandle = setInterval(() => {
      void _pollAndDeliver();
    }, POLLER_INTERVAL_MS);
    _pollerHandle.unref?.();
    void _pollAndDeliver();
  };

  _initialPollerHandle = setTimeout(startInterval, POLLER_INITIAL_DELAY_MS);
  _initialPollerHandle.unref?.();
}

/**
 * Stop the outbox poller. Used in tests / graceful shutdown.
 */
export function stopOutboxPoller(): void {
  if (_initialPollerHandle !== null) {
    clearTimeout(_initialPollerHandle);
    _initialPollerHandle = null;
  }
  if (_pollerHandle !== null) {
    clearInterval(_pollerHandle);
    _pollerHandle = null;
  }
  _pollInFlight = false;
  _pollFailureCount = 0;
  _pollBackoffUntil = 0;
}

/**
 * Internal: drain one batch of pending outbox rows.
 * Exported for direct test invocation without waiting for interval.
 */
export async function _pollAndDeliver(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  if (_pollInFlight) return 0;
  if (_pollBackoffUntil > Date.now()) return 0;

  let delivered = 0;
  _pollInFlight = true;

  try {
    const pending = await db.execute(
      sql`
        SELECT id, event_id, stream_id, event_type, payload, seq, error_count
        FROM el_outbox
        WHERE delivered_at IS NULL
        ORDER BY created_at ASC
        LIMIT ${POLLER_BATCH_SIZE}
      `
    ) as unknown;

    const rows: Array<{
      id: string;
      event_id: string;
      stream_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      seq: number | string;
      error_count: number | string;
    }> = Array.isArray(pending)
      ? (pending as typeof rows)
      : ((pending as { rows?: typeof rows }).rows ?? []);

    for (const row of rows) {
      const errorCount = Number(row.error_count ?? 0);
      const seq = Number(row.seq);
      let broadcastOk = true;

      if (_broadcasters.length > 0) {
        const broadcastInput = {
          eventId: row.event_id,
          streamId: row.stream_id,
          eventType: row.event_type,
          payload: (row.payload ?? {}) as Record<string, unknown>,
          seq
        };

        const results = await Promise.allSettled(
          _broadcasters.map((fn) => fn(broadcastInput))
        );

        broadcastOk = results.every((r) => r.status === "fulfilled");

        if (!broadcastOk) {
          const errs = results
            .filter((r): r is PromiseRejectedResult => r.status === "rejected")
            .map((r) => String(r.reason))
            .join("; ");
          console.warn(`[outbox-poller] Broadcast failed for outbox row ${row.id}: ${errs}`);
        }
      }

      if (broadcastOk || _broadcasters.length === 0) {
        await db
          .update(elOutbox)
          .set({ deliveredAt: new Date() })
          .where(eq(elOutbox.id, row.id));
        delivered++;
      } else {
        const newErrorCount = errorCount + 1;
        if (newErrorCount >= MAX_ERROR_COUNT) {
          console.error(`[outbox-poller] Row ${row.id} fatally failed after ${MAX_ERROR_COUNT} attempts`);
          await db
            .update(elOutbox)
            .set({ deliveredAt: EPOCH_TS, errorCount: newErrorCount })
            .where(eq(elOutbox.id, row.id));
        } else {
          await db
            .update(elOutbox)
            .set({ errorCount: newErrorCount })
            .where(eq(elOutbox.id, row.id));
        }
      }
    }
    _pollFailureCount = 0;
    _pollBackoffUntil = 0;
  } catch (e) {
    _pollFailureCount++;
    const backoffMs = Math.min(POLLER_MAX_BACKOFF_MS, POLLER_INTERVAL_MS * 2 ** Math.min(_pollFailureCount, 4));
    _pollBackoffUntil = Date.now() + backoffMs;
    console.warn(
      `[outbox-poller] Poll cycle failed (failure=${_pollFailureCount}, backoffMs=${backoffMs}):`,
      e instanceof Error ? e.message : String(e)
    );
  } finally {
    _pollInFlight = false;
  }

  return delivered;
}

/**
 * Get outbox diagnostics (pending + fatal count). Owner-only admin use.
 */
export async function getOutboxDiag(): Promise<{
  pendingCount: number;
  fatalCount: number;
  oldestPendingAt: string | null;
  isPollerRunning: boolean;
}> {
  if (!isDatabaseMode()) {
    return { pendingCount: 0, fatalCount: 0, oldestPendingAt: null, isPollerRunning: false };
  }

  const db = getDb();
  if (!db) {
    return {
      pendingCount: 0,
      fatalCount: 0,
      oldestPendingAt: null,
      isPollerRunning: _pollerHandle !== null || _initialPollerHandle !== null
    };
  }

  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE delivered_at IS NULL)::int AS pending_count,
        COUNT(*) FILTER (WHERE delivered_at <= TIMESTAMPTZ '1970-01-01 00:00:01+00')::int AS fatal_count,
        MIN(created_at) FILTER (WHERE delivered_at IS NULL)::text AS oldest_pending_at
      FROM el_outbox
    `) as unknown;
    const rows = Array.isArray(result)
      ? (result as Array<Record<string, unknown>>)
      : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []);
    const row = rows[0] ?? {};
    const pendingCount = Number(row["pending_count"] ?? 0);
    const fatalCount = Number(row["fatal_count"] ?? 0);
    const oldestPendingAt = typeof row["oldest_pending_at"] === "string"
      ? row["oldest_pending_at"]
      : null;

    return {
      pendingCount: Number.isFinite(pendingCount) && pendingCount >= 0 ? pendingCount : -1,
      fatalCount: Number.isFinite(fatalCount) && fatalCount >= 0 ? fatalCount : -1,
      oldestPendingAt,
      isPollerRunning: _pollerHandle !== null || _initialPollerHandle !== null
    };
  } catch (e) {
    console.warn("[outbox-diag] query failed:", e instanceof Error ? e.message : String(e));
    return {
      pendingCount: -1,
      fatalCount: -1,
      oldestPendingAt: null,
      isPollerRunning: _pollerHandle !== null || _initialPollerHandle !== null
    };
  }
}
