-- migration: 0033_eventlog_phase_a
-- purpose: EventLog Phase A — append-only event store + time-travel API
-- scope: additive-only (3 new tables). No existing tables modified.
-- NOTE: existing iuf_events (migration 0025) is the event-rule-engine table (rule_id/severity/ticker/acknowledged).
--       This migration adds the EventLog tables with "el_" prefix to avoid collision.
-- AGPL compliance: design-only inspiration from OpenAlice public README/docs. All SQL is IUF-original.
-- down migration: 0033_eventlog_phase_a.down.sql
-- Mike audit checklist:
--   B1: no missing NOT NULL without DEFAULT — checked
--   W1: no idempotency_key needed (append-only, UUID PK = natural dedup)
--   W3: inline comments on non-obvious columns — checked
--   W4: no monetary columns — N/A
--   N4: no partial-fill concept — N/A

-- Table 1: el_event_streams
-- Registry of known event streams. Each stream is identified by (workspace_id, stream_type, stream_id).
-- stream_type: category of stream (e.g. "strategy", "order", "workspace")
-- stream_id:   entity-specific key (e.g. "cont_liq_v36", "order-uuid")
CREATE TABLE IF NOT EXISTS el_event_streams (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- stream_type: logical category for grouping events (strategy / order / workspace / session / kgi)
  stream_type   TEXT        NOT NULL,
  -- stream_id: entity-level key within the stream_type namespace (e.g. strategy canonical id)
  stream_id     TEXT        NOT NULL,
  -- metadata: optional JSONB bag for stream-level annotations (schema_version hints, tags)
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT el_event_streams_pkey PRIMARY KEY (id),
  -- enforce one stream per (workspace, type, id) tuple — prevents phantom stream duplication
  CONSTRAINT el_event_streams_workspace_type_id_uidx UNIQUE (workspace_id, stream_type, stream_id)
);

CREATE INDEX IF NOT EXISTS el_event_streams_workspace_idx ON el_event_streams (workspace_id);
CREATE INDEX IF NOT EXISTS el_event_streams_type_idx ON el_event_streams (stream_type);

-- Table 2: el_events
-- Append-only event log. Every business event is written as a new row; no UPDATE/DELETE.
-- seq: per-stream monotonically increasing sequence number.
--      Generated inside DB transaction: SELECT MAX(seq)+1 FROM el_events WHERE stream_id=$1 FOR UPDATE.
--      Railway multi-instance safe because FOR UPDATE holds row lock until commit.
-- occurred_at: business clock (when the event happened, may be supplied by caller)
-- recorded_at: server clock (when the event was written to DB) — always auto-set
-- schema_version: payload format version for future upcasters (Phase B)
CREATE TABLE IF NOT EXISTS el_events (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  stream_id       UUID        NOT NULL REFERENCES el_event_streams(id) ON DELETE RESTRICT,
  -- seq: per-stream strictly monotonic. UNIQUE (stream_id, seq) enforces full ordering.
  seq             BIGINT      NOT NULL,
  -- event_type: dotted namespaced string (e.g. "strategy.subscribed", "order.filled")
  event_type      TEXT        NOT NULL,
  -- schema_version: payload structure version; 1 = Phase A initial. Increment on breaking changes.
  schema_version  INTEGER     NOT NULL DEFAULT 1,
  -- actor_id: nullable — system-generated events (cron, scheduler) have no actor
  actor_id        UUID        NULL,
  -- payload: event-specific data; schema is governed by event_type + schema_version
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- occurred_at: business time (defaults to now() if caller does not supply)
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- recorded_at: server write time (always server-assigned)
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT el_events_pkey PRIMARY KEY (id),
  -- full per-stream ordering guarantee
  CONSTRAINT el_events_stream_seq_uidx UNIQUE (stream_id, seq)
);

-- fast stream replay: scan events for a stream in seq order
CREATE INDEX IF NOT EXISTS el_events_stream_seq_idx ON el_events (stream_id, seq ASC);
-- fast event-type queries across streams
CREATE INDEX IF NOT EXISTS el_events_event_type_recorded_idx ON el_events (event_type, recorded_at DESC);
-- fast time-travel query: events for a stream up to a given occurred_at
CREATE INDEX IF NOT EXISTS el_events_stream_occurred_idx ON el_events (stream_id, occurred_at ASC);

-- Table 3: el_event_snapshots
-- Periodic snapshot for log compaction (Phase B). Phase A: table exists but no writes.
-- up_to_seq: the snapshot captures stream state through and including this seq.
-- state: materialized read-model state at up_to_seq; format is projection-specific.
CREATE TABLE IF NOT EXISTS el_event_snapshots (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  stream_id   UUID        NOT NULL REFERENCES el_event_streams(id) ON DELETE RESTRICT,
  -- up_to_seq: replay from (up_to_seq + 1) to get events after this snapshot
  up_to_seq   BIGINT      NOT NULL,
  state       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT el_event_snapshots_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS el_event_snapshots_stream_seq_idx ON el_event_snapshots (stream_id, up_to_seq DESC);

-- Quarantine table (Mike audit requirement: paired quarantine per migration)
CREATE TABLE IF NOT EXISTS _quarantine_el_eventlog_phase_a (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  original_table   TEXT        NOT NULL,  -- 'el_events' | 'el_event_streams'
  original_id      UUID        NOT NULL,
  reason_code      TEXT        NOT NULL,
  quarantined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT quarantine_el_eventlog_pkey PRIMARY KEY (id)
);
