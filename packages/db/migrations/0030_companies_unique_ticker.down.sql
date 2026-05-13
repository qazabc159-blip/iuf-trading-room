-- down migration: 0030_companies_unique_ticker
-- reverses 0030_companies_unique_ticker.sql
-- NOTE: dedup DELETE is irreversible — this only drops the index

DROP INDEX IF EXISTS companies_workspace_ticker_uidx;
