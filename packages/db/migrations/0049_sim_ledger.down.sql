-- 0049 down — drop F-AUTO SIM ledger tables
-- Safe to run only in dev/test — NEVER on prod with backfill data present.

DROP TABLE IF EXISTS sim_ledger_nav;
DROP TABLE IF EXISTS sim_ledger_holdings;
DROP TABLE IF EXISTS sim_ledger_weeks;
