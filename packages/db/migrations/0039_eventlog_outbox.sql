-- migration: 0039_eventlog_outbox
-- purpose: EventLog Phase B — Outbox pattern for transactional event publishing
-- scope: additive-only (1 new table). No existing tables modified.
-- design: el_outbox stores pending events atomically with the business write.
--         A background poller (setInterval 500ms) drains el_outbox → el_events subscribers / SSE.
--         This prevents event loss if the API worker crashes between DB write and in-process broadcast.
-- AGPL compliance: IUF-original design. No OpenAlice source code referenced.
-- down migration: 0039_eventlog_outbox.down.sql
-- Mike audit checklist:
--   B1: no missing NOT NULL without DEFAULT — checked
--   W1: delivered_at NULL = pending; NOT NULL = delivered or failed (no separate status column needed)
--   W3: inline comments on non-obvious columns — checked
--   W4: no monetary columns — N/A
--   N4: no partial-fill concept — N/A

CREATE TABLE IF NOT EXISTS el_outbox (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  -- event_id: FK to el_events (the event that was written atomically with this outbox record)
  event_id      UUID        NOT NULL REFERENCES el_events(id) ON DELETE CASCADE,
  -- stream_id: denormalized for fast poller query (avoids JOIN to el_events on poll)
  stream_id     UUID        NOT NULL REFERENCES el_event_streams(id) ON DELETE CASCADE,
  -- event_type: denormalized for SSE subscriber routing
  event_type    TEXT        NOT NULL,
  -- payload: denormalized event payload snapshot (avoids JOIN to el_events on broadcast)
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- seq: denormalized per-stream sequence number (for ordered delivery)
  seq           BIGINT      NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- delivered_at: NULL = pending delivery; set to NOW() on success; set to '1970-01-01'::timestamptz on fatal failure
  delivered_at  TIMESTAMPTZ NULL,
  -- error_count: incremented on each delivery failure; >= 5 → mark as fatally failed
  error_count   INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT el_outbox_pkey PRIMARY KEY (id)
);

-- Partial index: only pending rows (delivered_at IS NULL) — poller uses this exclusively
CREATE INDEX IF NOT EXISTS el_outbox_pending_idx ON el_outbox (created_at ASC) WHERE delivered_at IS NULL;

-- Quarantine table (Mike audit requirement: paired quarantine per migration)
CREATE TABLE IF NOT EXISTS _quarantine_el_outbox (
  id               UUID        NOT NULL DEFAULT gen_random_uuid(),
  original_id      UUID        NOT NULL,
  event_id         UUID        NOT NULL,
  reason_code      TEXT        NOT NULL,
  quarantined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT quarantine_el_outbox_pkey PRIMARY KEY (id)
);
