-- down migration: 0043_ai_rec_v3_score_breakdown
-- Reverts the score_breakdown column added by the forward migration.
--
-- WARNING: score_breakdown data will be permanently deleted upon rollback.
-- If audit trail matters, export affected rows before running:
--   SELECT id, run_id, score_breakdown FROM ai_recommendations_runs
--   WHERE score_breakdown IS NOT NULL;

ALTER TABLE ai_recommendations_runs
  DROP COLUMN IF EXISTS score_breakdown;
