-- 0020_dedup_companies_unique_ticker.sql
-- P0 BLOCKED — requires 楊董 explicit ACK before merge + Railway prod backup before run.
--
-- Problem: companies table has no UNIQUE(workspace_id, ticker) constraint.
-- Running the import twice creates duplicate rows. Some tickers appear 2-3x.
--
-- Step 1: Dedup by keeping the row with the most relations (or earliest created_at on tie).
-- Step 2: Add UNIQUE constraint to prevent future duplicates.
--
-- SAFETY NOTES:
--   - Step 1 deletes rows. Cannot be reversed without a pre-migration backup.
--   - Create a Postgres dump before running on production:
--       pg_dump $DATABASE_URL -F c -f backup_pre_0020_$(date +%Y%m%d_%H%M%S).pgdump
--   - Cascading FK deletes: company_theme_links, company_relations, company_keywords
--     reference companies(id) with ON DELETE CASCADE (check schema before running).
--   - Run in a transaction so dedup + constraint are atomic.

BEGIN;

-- Step 1: Dedup companies — keep the row with most relations, then earliest created_at.
WITH ranked AS (
  SELECT
    c.id,
    c.workspace_id,
    c.ticker,
    ROW_NUMBER() OVER (
      PARTITION BY c.workspace_id, c.ticker
      ORDER BY (
        SELECT COUNT(*)
        FROM company_relations cr
        WHERE cr.company_id = c.id
      ) DESC,
      c.created_at ASC
    ) AS rn
  FROM companies c
)
DELETE FROM companies c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

-- Step 2: Add UNIQUE constraint.
ALTER TABLE companies
  ADD CONSTRAINT companies_workspace_ticker_unique
  UNIQUE (workspace_id, ticker);

COMMIT;
