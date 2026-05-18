-- migration: 0042_ai_rec_v3_status_trigger
-- purpose: allow AI recommendation v3 runs to persist explicit v3 triggers and terminal statuses.
-- down migration: 0042_ai_rec_v3_status_trigger.down.sql

ALTER TABLE ai_recommendations_runs
  DROP CONSTRAINT IF EXISTS ai_rec_runs_status_check;

ALTER TABLE ai_recommendations_runs
  ADD CONSTRAINT ai_rec_runs_status_check
  CHECK (status IN (
    'running',
    'complete',
    'failed',
    'budget_exceeded',
    'market_risk_off',
    'insufficient_tools',
    'synthesis_format_error'
  ));

ALTER TABLE ai_recommendations_runs
  DROP CONSTRAINT IF EXISTS ai_rec_runs_trigger_check;

ALTER TABLE ai_recommendations_runs
  ADD CONSTRAINT ai_rec_runs_trigger_check
  CHECK (trigger IN (
    'cron_0930',
    'cron_1300',
    'manual_refresh',
    'test',
    'cron_0930:v3',
    'cron_1300:v3',
    'manual_refresh:v3',
    'test:v3'
  ));
