-- 0020.down.sql — reverse of 0020_dedup_companies_unique_ticker.sql
--
-- NOTE: The dedup DELETE in 0020 is NOT reversible via a migration.
-- If you need to restore deleted rows, use the pre-migration Postgres backup dump.
--
-- This down file only removes the UNIQUE constraint.

ALTER TABLE companies
  DROP CONSTRAINT IF EXISTS companies_workspace_ticker_unique;

-- Reminder: restore deleted rows from backup if needed:
--   pg_restore -d $DATABASE_URL -F c backup_pre_0020_<timestamp>.pgdump --table=companies
