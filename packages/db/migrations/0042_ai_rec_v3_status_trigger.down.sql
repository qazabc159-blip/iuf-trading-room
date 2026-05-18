-- down migration: 0042_ai_rec_v3_status_trigger
-- Reverts the v3 status enum expansion added by the forward migration.
--
-- WARNING: Rollback collapses status enum values.
-- market_risk_off / insufficient_tools / synthesis_format_error → 'failed'
-- Original v3 termination reason will be permanently lost upon rollback.
--
-- This is intentional but irreversible: once this down migration runs,
-- per-run termination reasons for v3 runs are unrecoverable from the DB.
-- If audit trail matters, export affected rows before running:
--   SELECT id, run_id, status, completed_at FROM ai_recommendations_runs
--   WHERE status IN ('market_risk_off', 'insufficient_tools', 'synthesis_format_error');
--
-- Mike audit W1 fix — 2026-05-18: added this comment block.

-- Step 1: collapse v3-specific terminal statuses to 'failed' before removing the constraint
UPDATE ai_recommendations_runs
SET status = 'failed'
WHERE status IN ('market_risk_off', 'insufficient_tools', 'synthesis_format_error');

-- Step 2: restore the original v1/v2 status constraint (running/complete/failed/budget_exceeded only)
ALTER TABLE ai_recommendations_runs
  DROP CONSTRAINT IF EXISTS ai_rec_runs_status_check;

ALTER TABLE ai_recommendations_runs
  ADD CONSTRAINT ai_rec_runs_status_check
    CHECK (status IN ('running', 'complete', 'failed', 'budget_exceeded'));

-- Step 3: drop the v3 status trigger if it was added by the forward migration
DROP TRIGGER IF EXISTS ai_rec_runs_v3_status_trigger ON ai_recommendations_runs;
DROP FUNCTION IF EXISTS ai_rec_runs_v3_status_guard();
