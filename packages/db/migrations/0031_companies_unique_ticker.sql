-- migration: 0031_companies_unique_ticker
-- purpose: eliminate duplicate companies rows and enforce unique (workspace_id, ticker)
-- root cause: seed/import scripts run multiple times with no conflict guard →
--             3470 rows ≈ 2× the expected 1734 → listCompanies() returns duplicates
-- Mike audit v2: FK rewire before DELETE to avoid RESTRICT constraint abort.
--   6 FK paths reference companies.id (RESTRICT by default in PostgreSQL):
--     1. company_theme_links.company_id  (0001_initial.sql:58)
--     2. company_relations.company_id    (0004_company_graph.sql:12)
--     3. company_relations.target_company_id (0004_company_graph.sql:14)
--     4. company_keywords.company_id     (0004_company_graph.sql:34)
--     5. trade_plans.company_id          (0001_initial.sql:75)
--     6. company_notes.company_id        (0011_worker_content_tables.sql:35)
--   Step 1 rewires all 6 child tables to the survivor (MIN(id)) before DELETE.
-- Renumbered 0030 → 0031: 0030 reserved by KGI orders migration stream.
-- Comment correction: MIN(id) on UUID v4 is lexicographically smallest, not "oldest row".
--   UUID v4 is random; MIN(id) is deterministic per group but not time-ordered.
-- Pre-deploy: operator must take Railway DB snapshot before running.
-- down migration: 0031_companies_unique_ticker.down.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1a: Rewire company_theme_links.company_id → survivor
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_theme_links ctl
SET company_id = survivor.id
FROM (
  SELECT MIN(id) AS id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE ctl.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1b: Rewire company_relations.company_id → survivor
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_relations cr
SET company_id = survivor.id
FROM (
  SELECT MIN(id) AS id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE cr.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1c: Rewire company_relations.target_company_id → survivor
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_relations cr
SET target_company_id = survivor.id
FROM (
  SELECT MIN(id) AS id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE cr.target_company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1d: Rewire company_keywords.company_id → survivor
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_keywords ck
SET company_id = survivor.id
FROM (
  SELECT MIN(id) AS id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE ck.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1e: Rewire trade_plans.company_id → survivor
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE trade_plans tp
SET company_id = survivor.id
FROM (
  SELECT MIN(id) AS id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE tp.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1f: Rewire company_notes.company_id → survivor
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_notes cn
SET company_id = survivor.id
FROM (
  SELECT MIN(id) AS id, workspace_id, ticker
  FROM companies
  GROUP BY workspace_id, ticker
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE cn.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Safe DELETE of duplicate companies (all FK children now point to survivor)
-- MIN(id) is the lexicographically smallest UUID per (workspace_id, ticker) group.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM companies
WHERE id NOT IN (
  SELECT MIN(id)::uuid
  FROM companies
  GROUP BY workspace_id, ticker
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Create unique index to prevent future duplicates.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_ticker_uidx
  ON companies (workspace_id, ticker);
