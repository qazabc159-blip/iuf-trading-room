-- down migration: 0028_audit_logs_strategy_run_mode
-- reverses 0028_audit_logs_strategy_run_mode.sql

DROP INDEX IF EXISTS strategy_run_states_workspace_strategy_idx;
DROP TABLE IF EXISTS strategy_run_states;

DROP INDEX IF EXISTS audit_logs_workspace_run_mode_created_at_idx;

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS yang_explicit_ack;

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS paper_audit_id;

ALTER TABLE audit_logs
  DROP COLUMN IF EXISTS strategy_run_mode;
