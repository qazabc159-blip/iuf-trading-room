-- migration: 0030_companies_unique_ticker
-- purpose: eliminate duplicate companies rows and enforce unique (workspace_id, ticker)
-- root cause: seed/import scripts run multiple times with no conflict guard →
--             3470 rows ≈ 2× the expected 1734 → listCompanies() returns duplicates
-- Mike audit: dedup DELETE before index; CREATE UNIQUE INDEX CONCURRENTLY not used
--             (table is small <10k rows; CONCURRENTLY inside txn not allowed);
--             IF NOT EXISTS on index makes re-run safe; ON CONFLICT DO NOTHING added
--             to insert scripts separately.
-- down migration: 0030_companies_unique_ticker.down.sql

-- Step 1: Remove duplicate companies, keeping the row with MIN(id) per (workspace_id, ticker).
-- This is safe: MIN(id) is deterministic (UUID v4 lexicographic) and preserves oldest row.
-- Rows with FK references in company_theme_links / company_relations will block DELETE
-- if they point to a dup. The subquery excludes the survivor row so only true dups are deleted.
DELETE FROM companies
WHERE id NOT IN (
  SELECT MIN(id)::uuid
  FROM companies
  GROUP BY workspace_id, ticker
);

-- Step 2: Create unique index to prevent future duplicates.
-- Covers the full composite key: workspace + ticker.
CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_ticker_uidx
  ON companies (workspace_id, ticker);
