/**
 * event-log-store.ts -- EventLog Phase A
 *
 * Append-only event store backed by el_event_streams + el_events tables.
 * Phase A scope:
 *   - appendEvent():      upsert stream, atomic seq, insert event
 *   - readStreamEvents(): cursor-based paginated stream read
 *   - readEventsAt():     time-travel query (occurred_at <= asOf)
 *
 * Design constraints:
 *   - seq generation MUST be inside the same DB transaction (multi-instance Railway safety)
 *   - double-write failure MUST NOT propagate to caller (degraded-gracefully pattern)
 *   - market_events tick volume NOT routed here (Phase B evaluation)
 *   - AGPL: no OpenAlice source code referenced; IUF-original implementation
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { elEvents, elEventStreams, getDb, isDatabaseMode } from "@iuf-trading-room/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AppendEventInput = {
  /** Workspace this stream belongs to. */
  workspaceId: string;
  /** Logical category: "strategy" | "order" | "workspace" | "session" | "kgi" | string */
  streamType: string;
  /** Entity key within the stream type (e.g. "cont_liq_v36", order UUID). */
  streamId: string;
  /** Dotted namespaced event type: "strategy.subscribed", "order.filled", etc. */
  eventType: string;
  /** Event payload -- must be JSON-serializable. */
  payload: Record<string, unknown>;
  /** When the event happened (business clock). Defaults to now. */
  occurredAt?: Date;
  /** Payload schema version. Defaults to 1. */
  schemaVersion?: number;
  /** Actor UUID. Null for system-generated events. */
  actorId?: string | null;
};

export type EventLogRow = {
  id: string;
  streamId: string;
  seq: number;
  eventType: string;
  schemaVersion: number;
  actorId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string; // ISO8601
  recordedAt: string; // ISO8601
};

export type AppendEventResult = {
  id: string;
  seq: number;
  recordedAt: string;
};

export type ReadStreamEventsInput = {
  workspaceId: string;
  streamType: string;
  streamId: string;
  fromSeq?: number;
  toSeq?: number;
  limit?: number;
  eventType?: string;
};

export type ReadStreamEventsResult = {
  events: EventLogRow[];
  nextSeq: number | null;
  hasMore: boolean;
};

export type ReadEventsAtInput = {
  workspaceId: string;
  streamType: string;
  streamId: string;
  asOf: Date;
  limit?: number;
};

// ---------------------------------------------------------------------------
// In-memory fallback store (non-DB / test mode)
// ---------------------------------------------------------------------------

type MemEvent = {
  id: string;
  streamId: string;
  seq: number;
  eventType: string;
  schemaVersion: number;
  actorId: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  recordedAt: Date;
};

const _memStreams = new Map<string, { id: string; workspaceId: string; streamType: string; streamId: string; createdAt: Date }>();
const _memEvents: MemEvent[] = [];
const _memSeqCounter = new Map<string, number>(); // streamRowId -> last seq

export function _resetEventLogStoreForTests(): void {
  _memStreams.clear();
  _memEvents.length = 0;
  _memSeqCounter.clear();
}

function memStreamKey(workspaceId: string, streamType: string, streamId: string): string {
  return workspaceId + "::" + streamType + "::" + streamId;
}

async function memUpsertStream(workspaceId: string, streamType: string, streamId: string): Promise<string> {
  const key = memStreamKey(workspaceId, streamType, streamId);
  if (!_memStreams.has(key)) {
    _memStreams.set(key, { id: randomUUID(), workspaceId, streamType, streamId, createdAt: new Date() });
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return _memStreams.get(key)!.id;
}

async function memAppendEvent(input: AppendEventInput): Promise<AppendEventResult> {
  const streamRowId = await memUpsertStream(input.workspaceId, input.streamType, input.streamId);
  const lastSeq = _memSeqCounter.get(streamRowId) ?? 0;
  const seq = lastSeq + 1;
  _memSeqCounter.set(streamRowId, seq);
  const id = randomUUID();
  const recordedAt = new Date();
  _memEvents.push({
    id,
    streamId: streamRowId,
    seq,
    eventType: input.eventType,
    schemaVersion: input.schemaVersion ?? 1,
    actorId: input.actorId ?? null,
    payload: input.payload,
    occurredAt: input.occurredAt ?? recordedAt,
    recordedAt,
  });
  return { id, seq, recordedAt: recordedAt.toISOString() };
}

function memGetStreamId(workspaceId: string, streamType: string, streamId: string): string | null {
  const key = memStreamKey(workspaceId, streamType, streamId);
  return _memStreams.get(key)?.id ?? null;
}

function toEventLogRow(e: MemEvent): EventLogRow {
  return {
    id: e.id,
    streamId: e.streamId,
    seq: e.seq,
    eventType: e.eventType,
    schemaVersion: e.schemaVersion,
    actorId: e.actorId,
    payload: e.payload,
    occurredAt: e.occurredAt.toISOString(),
    recordedAt: e.recordedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append an event to a stream.
 *
 * Atomically: upserts stream, computes next seq, inserts event -- all in one TX.
 * In non-DB mode: uses in-memory store (tests / preview).
 *
 * Failure policy: throws on unexpected error. Callers doing "fire-and-forget"
 * double-write MUST wrap in try/catch and degrade gracefully.
 */
export async function appendEvent(input: AppendEventInput): Promise<AppendEventResult> {
  if (!isDatabaseMode()) {
    return memAppendEvent(input);
  }

  const db = getDb();
  if (!db) {
    return memAppendEvent(input);
  }

  return db.transaction(async (tx) => {
    // 1. Upsert stream -- returns the canonical stream row UUID.
    const [streamRow] = await tx
      .insert(elEventStreams)
      .values({
        workspaceId: input.workspaceId,
        streamType: input.streamType,
        streamId: input.streamId,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [elEventStreams.workspaceId, elEventStreams.streamType, elEventStreams.streamId],
        // no-op update to force RETURNING to return the existing row id
        set: { streamType: elEventStreams.streamType },
      })
      .returning({ id: elEventStreams.id });

    if (!streamRow) throw new Error("el_event_streams upsert returned no row");
    const streamRowId = streamRow.id;

    // 2. Compute next seq atomically -- FOR UPDATE prevents concurrent writers from racing.
    //    Must stay inside same transaction to hold row-level lock until commit.
    //    Cast through unknown to handle RowList<> vs plain array variance in drizzle-orm types.
    const seqResult = await tx.execute(
      sql`SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM el_events WHERE stream_id = ${streamRowId} FOR UPDATE`
    );
    const seqRaw: unknown = seqResult;
    const seqRows: { next_seq: unknown }[] = Array.isArray(seqRaw)
      ? (seqRaw as { next_seq: unknown }[])
      : ((seqRaw as { rows?: { next_seq: unknown }[] }).rows ?? []);
    const nextSeq = Number(seqRows[0]?.next_seq ?? 1);

    // 3. Insert event row.
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
        recordedAt: now,
      })
      .returning({ id: elEvents.id, seq: elEvents.seq, recordedAt: elEvents.recordedAt });

    if (!eventRow) throw new Error("el_events insert returned no row");

    return {
      id: eventRow.id,
      seq: eventRow.seq,
      recordedAt: eventRow.recordedAt.toISOString(),
    };
  });
}

/**
 * Read events from a stream with optional seq range and cursor-based pagination.
 */
export async function readStreamEvents(input: ReadStreamEventsInput): Promise<ReadStreamEventsResult> {
  const limit = Math.min(input.limit ?? 50, 500);

  if (!isDatabaseMode()) {
    const streamRowId = memGetStreamId(input.workspaceId, input.streamType, input.streamId);
    if (!streamRowId) return { events: [], nextSeq: null, hasMore: false };

    const rows = _memEvents
      .filter((e) => {
        if (e.streamId !== streamRowId) return false;
        if (input.fromSeq !== undefined && e.seq < input.fromSeq) return false;
        if (input.toSeq !== undefined && e.seq > input.toSeq) return false;
        if (input.eventType && e.eventType !== input.eventType) return false;
        return true;
      })
      .sort((a, b) => a.seq - b.seq);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const nextSeq = hasMore ? (page[page.length - 1]?.seq ?? 0) + 1 : null;
    return { events: page.map(toEventLogRow), nextSeq, hasMore };
  }

  const db = getDb();
  if (!db) return { events: [], nextSeq: null, hasMore: false };

  // Resolve stream UUID
  const streamRows = await db
    .select({ id: elEventStreams.id })
    .from(elEventStreams)
    .where(
      and(
        eq(elEventStreams.workspaceId, input.workspaceId),
        eq(elEventStreams.streamType, input.streamType),
        eq(elEventStreams.streamId, input.streamId)
      )
    )
    .limit(1);

  const streamRowId = streamRows[0]?.id;
  if (!streamRowId) return { events: [], nextSeq: null, hasMore: false };

  const filters = [eq(elEvents.streamId, streamRowId)];
  if (input.fromSeq !== undefined) filters.push(gte(elEvents.seq, input.fromSeq));
  if (input.toSeq !== undefined) filters.push(lte(elEvents.seq, input.toSeq));
  if (input.eventType) filters.push(eq(elEvents.eventType, input.eventType));

  const rows = await db
    .select()
    .from(elEvents)
    .where(and(...filters))
    .orderBy(asc(elEvents.seq))
    .limit(limit + 1); // fetch one extra to detect hasMore

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextSeq = hasMore ? (page[page.length - 1]?.seq ?? 0) + 1 : null;

  return {
    events: page.map((r) => ({
      id: r.id,
      streamId: r.streamId,
      seq: r.seq,
      eventType: r.eventType,
      schemaVersion: r.schemaVersion,
      actorId: r.actorId,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      occurredAt: r.occurredAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
    })),
    nextSeq,
    hasMore,
  };
}

/**
 * Time-travel query: return all events for a stream where occurred_at <= asOf.
 * Returns at most limit events (default 200, max 1000).
 */
export async function readEventsAt(input: ReadEventsAtInput): Promise<{ events: EventLogRow[] }> {
  const limit = Math.min(input.limit ?? 200, 1000);

  if (!isDatabaseMode()) {
    const streamRowId = memGetStreamId(input.workspaceId, input.streamType, input.streamId);
    if (!streamRowId) return { events: [] };

    const rows = _memEvents
      .filter((e) => e.streamId === streamRowId && e.occurredAt <= input.asOf)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);

    return { events: rows.map(toEventLogRow) };
  }

  const db = getDb();
  if (!db) return { events: [] };

  const streamRows = await db
    .select({ id: elEventStreams.id })
    .from(elEventStreams)
    .where(
      and(
        eq(elEventStreams.workspaceId, input.workspaceId),
        eq(elEventStreams.streamType, input.streamType),
        eq(elEventStreams.streamId, input.streamId)
      )
    )
    .limit(1);

  const streamRowId = streamRows[0]?.id;
  if (!streamRowId) return { events: [] };

  const rows = await db
    .select()
    .from(elEvents)
    .where(
      and(
        eq(elEvents.streamId, streamRowId),
        lte(elEvents.occurredAt, input.asOf)
      )
    )
    .orderBy(asc(elEvents.seq))
    .limit(limit);

  return {
    events: rows.map((r) => ({
      id: r.id,
      streamId: r.streamId,
      seq: r.seq,
      eventType: r.eventType,
      schemaVersion: r.schemaVersion,
      actorId: r.actorId,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      occurredAt: r.occurredAt.toISOString(),
      recordedAt: r.recordedAt.toISOString(),
    })),
  };
}

/**
 * List all streams for a workspace (optional: filter by stream_type).
 */
export async function listEventStreams(input: {
  workspaceId: string;
  streamType?: string;
  limit?: number;
}): Promise<{ id: string; streamType: string; streamId: string; createdAt: string }[]> {
  const limit = Math.min(input.limit ?? 100, 500);

  if (!isDatabaseMode()) {
    const results = [..._memStreams.values()]
      .filter((s) => {
        if (s.workspaceId !== input.workspaceId) return false;
        if (input.streamType && s.streamType !== input.streamType) return false;
        return true;
      })
      .slice(0, limit);
    return results.map((s) => ({
      id: s.id,
      streamType: s.streamType,
      streamId: s.streamId,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  const db = getDb();
  if (!db) return [];

  const filters = [eq(elEventStreams.workspaceId, input.workspaceId)];
  if (input.streamType) filters.push(eq(elEventStreams.streamType, input.streamType));

  const rows = await db
    .select()
    .from(elEventStreams)
    .where(and(...filters))
    .orderBy(desc(elEventStreams.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    streamType: r.streamType,
    streamId: r.streamId,
    createdAt: r.createdAt.toISOString(),
  }));
}
