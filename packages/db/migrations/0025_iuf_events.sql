-- Migration: 0025_iuf_events
-- Status: PROMOTED — Mike audit complete (2026-05-12), P0 unblock for iuf_events table
-- Owner: Jason (backend-strategy)
-- Purpose: iuf_events table for OpenAlice event rule engine (BLOCK #6)
--
-- Note: filename has no .DRAFT. infix — this migration IS applied by migrate.ts.
-- Previously held as draft by SQL comment only (incorrect — migrate.ts checks filename, not comment).
-- P0 promote: Bruce R5 confirmed table not present in production → events silently dropped.
--
-- Related: apps/api/src/openalice-event-rule-engine.ts

CREATE TABLE IF NOT EXISTS iuf_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       TEXT        NOT NULL,
  rule_name     TEXT        NOT NULL,
  severity      TEXT        NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  ticker        TEXT        NULL,          -- NULL for system-level events (R08, R09, R10)
  payload       JSONB       NOT NULL DEFAULT '{}',
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged  BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Index: fast lookups for dedup check (rule+ticker+time) and list queries
CREATE INDEX IF NOT EXISTS iuf_events_rule_ticker_time_idx
  ON iuf_events (rule_id, ticker, triggered_at DESC);

CREATE INDEX IF NOT EXISTS iuf_events_triggered_at_idx
  ON iuf_events (triggered_at DESC);

CREATE INDEX IF NOT EXISTS iuf_events_unread_idx
  ON iuf_events (acknowledged, triggered_at DESC)
  WHERE acknowledged = FALSE;

-- Quarantine table (Mike audit requirement: paired quarantine per migration)
CREATE TABLE IF NOT EXISTS _quarantine_iuf_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id   UUID        NOT NULL,
  rule_id       TEXT        NOT NULL,
  reason_code   TEXT        NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload       JSONB       NOT NULL DEFAULT '{}'
);
