-- Rollback: 0056_ai_recommendations_runs_workspace

DROP INDEX IF EXISTS ai_rec_runs_workspace_generated_at_idx;

ALTER TABLE IF EXISTS ai_recommendations_runs
  ALTER COLUMN workspace_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ai_rec_runs_generated_at_idx
  ON ai_recommendations_runs (generated_at DESC);
