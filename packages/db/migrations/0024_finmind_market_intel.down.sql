-- 0024_finmind_market_intel.down.sql
-- Rollback for 0024_finmind_market_intel.DRAFT.sql (FinMind PR C — 4 market-intel datasets)
-- Drop order: quarantine bins first, then main tables (symmetric to forward migration).
-- All operations IF EXISTS — safe to apply on a partially-rolled-back state.
-- Authored: Jason BLOCK #4 PR C 2026-05-06.

BEGIN;

-- Quarantine bins (drop first)
DROP TABLE IF EXISTS _quarantine_tw_stock_news;
DROP TABLE IF EXISTS _quarantine_tw_valuation;
DROP TABLE IF EXISTS _quarantine_tw_market_value;
DROP TABLE IF EXISTS _quarantine_tw_dividend;

-- Main tables
DROP TABLE IF EXISTS tw_stock_news;
DROP TABLE IF EXISTS tw_valuation;
DROP TABLE IF EXISTS tw_market_value;
DROP TABLE IF EXISTS tw_dividend;

COMMIT;
