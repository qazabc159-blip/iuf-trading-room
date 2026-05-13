-- down migration: 0031_companies_unique_ticker
-- reverses 0031_companies_unique_ticker.sql
-- NOTE: dedup DELETE is irreversible — this only drops the unique index.
--   FK rewire UPDATEs are also irreversible (no way to know which child rows
--   originally pointed to the now-deleted duplicate company_id).
--   Full rollback requires restoring from the Railway DB snapshot taken pre-deploy.

DROP INDEX IF EXISTS companies_workspace_ticker_uidx;
