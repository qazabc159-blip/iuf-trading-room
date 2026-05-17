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
 *   A background poller (setInterval 500ms) drains pending el_outbox rows:
 *     1. SELECT ... WHERE delivered_at IS NULL ... FOR UPDATE SKIP LOCKED
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
const POLLER_INTERVAL_MS = 500;
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

    // 2. Compute next seq atomically (FOR UPDATE holds row lock until commit)
    const seqResult = await tx.execute(
      sql`SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM el_events WHERE stream_id = ${streamRowId} FOR UPDATE`
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
 * Uses FOR UPDATE SKIP LOCKED for multi-instance Railway safety.
 *
 * @param extraBroadcaster  Optional one-off broadcaster added to registry.
 */
export function startOutboxPoller(extraBroadcaster?: OutboxBroadcaster): void {
  if (extraBroadcaster) {
    registerOutboxBroadcaster(extraBroadcaster);
  }

  if (_pollerHandle !== null) {
    return; // already running
  }

  if (!isDatabaseMode()) {
    console.info("[outbox-poller] Non-DB mode — poller skipped");
    return;
  }

  console.info("[outbox-poller] Starting (interval=500ms batch=50)");

  _pollerHandle = setInterval(() => {
    void _pollAndDeliver();
  }, POLLER_INTERVAL_MS);
}

/**
 * Stop the outbox poller. Used in tests / graceful shutdown.
 */
export function stopOutboxPoller(): void {
  if (_pollerHandle !== null) {
    clearInterval(_pollerHandle);
    _pollerHandle = null;
  }
}

/**
 * Internal: drain one batch of pending outbox rows.
 * Exported for direct test invocation without waiting for interval.
 */
export async function _pollAndDeliver(): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  let delivered = 0;

  try {
    const pending = await db.execute(
      sql`
        SELECT id, event_id, stream_id, event_type, payload, seq, error_count
        FROM el_outbox
        WHERE delivered_at IS NULL
        ORDER BY created_at ASC
        LIMIT ${POLLER_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
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
  } catch (e) {
    console.warn("[outbox-poller] Poll cycle failed:", e instanceof Error ? e.message : String(e));
  }

  return delivered;
}

/**
 * Get outbox diagnostics (pending + fatal count). Owner-only admin use.
 */
export async function getOutboxDiag(): Promise<{
  pendingCount: number;
  fatalCount: number;
  isPollerRunning: boolean;
}> {
  if (!isDatabaseMode()) {
    return { pendingCount: 0, fatalCount: 0, isPollerRunning: false };
  }

  const db = getDb();
  if (!db) {
    return { pendingCount: 0, fatalCount: 0, isPollerRunning: _pollerHandle !== null };
  }

  try {
    const pendingResult = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM el_outbox WHERE delivered_at IS NULL`
    ) as unknown;
    const pendingRows: { cnt: number | string }[] = Array.isArray(pendingResult)
      ? (pendingResult as { cnt: number | string }[])
      : ((pendingResult as { rows?: { cnt: number | string }[] }).rows ?? []);
    const pendingCount = Number(pendingRows[0]?.cnt ?? 0);

    const fatalResult = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM el_outbox WHERE delivered_at = ${EPOCH_TS}`
    ) as unknown;
    const fatalRows: { cnt: number | string }[] = Array.isArray(fatalResult)
      ? (fatalResult as { cnt: number | string }[])
      : ((fatalResult as { rows?: { cnt: number | string }[] }).rows ?? []);
    const fatalCount = Number(fatalRows[0]?.cnt ?? 0);

    return { pendingCount, fatalCount, isPollerRunning: _pollerHandle !== null };
  } catch (e) {
    console.warn("[outbox-diag] query failed:", e instanceof Error ? e.message : String(e));
    return { pendingCount: -1, fatalCount: -1, isPollerRunning: _pollerHandle !== null };
  }
}
