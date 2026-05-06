-- 0023_finmind_trading_flow.down.sql
-- Rollback for 0023_finmind_trading_flow.DRAFT.sql (FinMind PR B — 3 trading-flow datasets)
-- Drop order: quarantine bins first, then main tables (symmetric to forward migration).
-- All operations IF EXISTS — safe to apply on a partially-rolled-back state.
-- Authored: Jason BLOCK #4 PR B 2026-05-06.

BEGIN;

-- Quarantine bins (drop first)
DROP TABLE IF EXISTS _quarantine_tw_shareholding;
DROP TABLE IF EXISTS _quarantine_tw_margin_short;
DROP TABLE IF EXISTS _quarantine_tw_institutional_buysell;

-- Main tables
DROP TABLE IF EXISTS tw_shareholding;
DROP TABLE IF EXISTS tw_margin_short;
DROP TABLE IF EXISTS tw_institutional_buysell;

COMMIT;
