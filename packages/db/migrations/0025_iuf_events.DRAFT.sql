-- Migration: 0025_iuf_events
-- Status: DRAFT — awaiting Mike (migration-auditor) audit before promotion
-- Owner: Jason (backend-strategy)
-- Purpose: iuf_events table for OpenAlice event rule engine (BLOCK #6)
--
-- This migration is skipped by migrate.ts (DRAFT suffix filter).
-- Do NOT promote until Mike audit sign-off.
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
