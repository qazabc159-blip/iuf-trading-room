-- down migration: 0029_strategy_runs
-- reverses 0029_strategy_runs.sql

DROP INDEX IF EXISTS idx_strategy_runs_workspace_status;
DROP INDEX IF EXISTS idx_strategy_runs_workspace_created;
DROP TABLE IF EXISTS strategy_runs;
