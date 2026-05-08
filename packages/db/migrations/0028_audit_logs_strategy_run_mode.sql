-- migration: 0028_audit_logs_strategy_run_mode
-- purpose: add strategy_run_mode tracking columns to audit_logs +
--          strategy_run_states table for paper observation lifecycle
-- Mike audit: additive-only; no column renames; all new cols nullable / default safe
-- down migration: 0028_audit_logs_strategy_run_mode.down.sql

-- ── 1. audit_logs: 3 new columns ─────────────────────────────────────────────

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS strategy_run_mode TEXT
    CHECK (strategy_run_mode IN ('paper', 'live'))
    NULL;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS paper_audit_id UUID NULL;

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS yang_explicit_ack BOOLEAN NOT NULL DEFAULT FALSE;

-- composite index for per-workspace strategy run mode queries (descending by time)
CREATE INDEX IF NOT EXISTS audit_logs_workspace_run_mode_created_at_idx
  ON audit_logs (workspace_id, strategy_run_mode, created_at DESC);

-- ── 2. strategy_run_states: paper observation lifecycle table ─────────────────
-- Stores the per-strategy mode state machine:
--   OFF → paper_observing → paper_complete → live
-- One active row per (workspace_id, strategy_id); prior rows kept for history.

CREATE TABLE IF NOT EXISTS strategy_run_states (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id),
  strategy_id   TEXT        NOT NULL,
  run_mode      TEXT        NOT NULL CHECK (run_mode IN ('OFF', 'PAPER', 'LIVE')),
  observation_state TEXT    NOT NULL
    CHECK (observation_state IN ('off', 'paper_observing', 'paper_complete', 'live')),
  capital_twd   NUMERIC     NULL,
  yang_explicit_ack BOOLEAN NOT NULL DEFAULT FALSE,
  start_at      TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- index for efficient lookup by workspace + strategy
CREATE INDEX IF NOT EXISTS strategy_run_states_workspace_strategy_idx
  ON strategy_run_states (workspace_id, strategy_id, created_at DESC);
