-- migration: 0029_strategy_runs
-- purpose: persist strategy runs to PostgreSQL (replaces ephemeral filesystem JSONL)
-- root cause: Railway ephemeral container wipes runtime-data/ on every redeploy →
--             strategy_runs always empty → /runs page hero EMPTY state → paper chain broken
-- Mike audit: additive-only; new table + 2 indices; no schema mutations; all defaults safe
-- down migration: 0029_strategy_runs.down.sql

-- ── strategy_runs table ────────────────────────────────────────────────────────
-- Stores one row per strategy run created via POST /api/v1/strategy/runs.
-- workspace_id FK ensures rows are scoped to a workspace; ON DELETE RESTRICT
-- prevents accidental cascade wipe.
-- payload JSONB holds the full StrategyRunRecord (summary + items + outputs).

CREATE TABLE IF NOT EXISTS strategy_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  strategy_id           TEXT        NOT NULL,
  run_label             TEXT        NOT NULL,
  status                TEXT        NOT NULL
    CHECK (status IN ('queued', 'running', 'passed', 'failed', 'blocked')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  candidates_count      INTEGER     NOT NULL DEFAULT 0,
  observable_count      INTEGER     NOT NULL DEFAULT 0,
  pending_review_count  INTEGER     NOT NULL DEFAULT 0,
  rejected_count        INTEGER     NOT NULL DEFAULT 0,
  payload               JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- workspace-scoped listing (most recent first)
CREATE INDEX IF NOT EXISTS idx_strategy_runs_workspace_created
  ON strategy_runs (workspace_id, created_at DESC);

-- workspace + status filter for quick board queries
CREATE INDEX IF NOT EXISTS idx_strategy_runs_workspace_status
  ON strategy_runs (workspace_id, status);
