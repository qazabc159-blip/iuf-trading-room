-- 0022_finmind_fundamentals.down.sql
-- Rollback for 0022_finmind_fundamentals.DRAFT.sql (FinMind PR A — 4 fundamental datasets)
--
-- Drop order: quarantine bins first, then main tables (quarantine has no FK
-- to main, but ordering keeps the rollback diff symmetric to the forward
-- migration's table creation order).
--
-- All operations IF EXISTS — safe to apply on a partially-rolled-back state.
--
-- Authored: Mike audit blocker fix 2026-05-06.

BEGIN;

-- Quarantine bins (drop first — symmetric to forward order)
DROP TABLE IF EXISTS _quarantine_tw_cashflow_statement;
DROP TABLE IF EXISTS _quarantine_tw_balance_sheet;
DROP TABLE IF EXISTS _quarantine_tw_financial_statements;
DROP TABLE IF EXISTS _quarantine_tw_monthly_revenue;

-- Main tables
DROP TABLE IF EXISTS tw_cashflow_statement;
DROP TABLE IF EXISTS tw_balance_sheet;
DROP TABLE IF EXISTS tw_financial_statements;
DROP TABLE IF EXISTS tw_monthly_revenue;

COMMIT;
