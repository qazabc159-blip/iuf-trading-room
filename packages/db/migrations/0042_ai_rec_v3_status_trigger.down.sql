-- down migration: 0042_ai_rec_v3_status_trigger
-- Reverts the v3 status and trigger constraint expansion added by the forward migration.
--
-- WARNING: Rollback collapses status enum values.
-- market_risk_off / insufficient_tools / synthesis_format_error collapse to 'failed'.
-- Original v3 termination reason will be permanently lost upon rollback.
--
-- This is intentional but irreversible: once this down migration runs,
-- per-run termination reasons for v3 runs are unrecoverable from the DB.
-- If audit trail matters, export affected rows before running:
--   SELECT id, run_id, status, completed_at FROM ai_recommendations_runs
--   WHERE status IN ('market_risk_off', 'insufficient_tools', 'synthesis_format_error');
--
-- Mike audit W1 fix, 2026-05-18: keep this data-loss disclosure before any DML.

-- Step 1: collapse v3-specific terminal statuses before restoring the old status constraint.
UPDATE ai_recommendations_runs
SET status = 'failed'
WHERE status IN ('market_risk_off', 'insufficient_tools', 'synthesis_format_error');

-- Step 2: collapse v3 trigger values before restoring the old trigger constraint.
UPDATE ai_recommendations_runs
SET trigger = replace(trigger, ':v3', '')
WHERE trigger LIKE '%:v3';

-- Step 3: restore the original v1/v2 status constraint.
ALTER TABLE ai_recommendations_runs
  DROP CONSTRAINT IF EXISTS ai_rec_runs_status_check;

ALTER TABLE ai_recommendations_runs
  ADD CONSTRAINT ai_rec_runs_status_check
  CHECK (status IN ('running', 'complete', 'failed', 'budget_exceeded'));

-- Step 4: restore the original v1/v2 trigger constraint.
ALTER TABLE ai_recommendations_runs
  DROP CONSTRAINT IF EXISTS ai_rec_runs_trigger_check;

ALTER TABLE ai_recommendations_runs
  ADD CONSTRAINT ai_rec_runs_trigger_check
  CHECK (trigger IN ('cron_0930', 'cron_1300', 'manual_refresh', 'test'));

-- Step 5: harmless cleanup if a future forward migration introduces DB triggers.
DROP TRIGGER IF EXISTS ai_rec_runs_v3_status_trigger ON ai_recommendations_runs;
DROP FUNCTION IF EXISTS ai_rec_runs_v3_status_guard();
