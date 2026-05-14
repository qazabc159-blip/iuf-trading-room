-- migration: 0031_companies_unique_ticker
-- purpose: eliminate duplicate companies rows and enforce unique (workspace_id, ticker)
-- root cause: seed/import scripts run multiple times with no conflict guard →
--             3470 rows ≈ 2× the expected 1734 → listCompanies() returns duplicates
-- Mike audit v3 (2026-05-14 fix): identified real rollback root cause.
--   company_relations has UNIQUE INDEX on (workspace_id, company_id, target_label, relation_type).
--   company_keywords  has UNIQUE INDEX on (workspace_id, company_id, label).
--   When Step 1b/1d rewired multiple dup company_ids to the same survivor_id,
--   child rows with identical unique-key fields collided → constraint violation → rollback.
--   Fix: deduplicate those child tables using survivor_id projection BEFORE the rewire UPDATE.
--   6 FK paths reference companies.id (RESTRICT by default in PostgreSQL):
--     1. company_theme_links.company_id  (0001_initial.sql:58)
--     2. company_relations.company_id    (0004_company_graph.sql:12)
--     3. company_relations.target_company_id (0004_company_graph.sql:14)
--     4. company_keywords.company_id     (0004_company_graph.sql:34)
--     5. trade_plans.company_id          (0001_initial.sql:75)
--     6. company_notes.company_id        (0011_worker_content_tables.sql:35)
-- Step 2 now uses EXISTS instead of NOT IN to avoid NULL-in-subquery correctness trap.
-- Renumbered 0030 → 0031: 0030 reserved by KGI orders migration stream.
-- Pre-deploy: operator must take Railway DB snapshot before running.
-- v4 (2026-05-14 uuid-min fix): companies.id, company_relations.id, company_keywords.id,
--   companies_ohlcv.id are all UUID. PostgreSQL has no built-in MIN() aggregate for UUID.
--   Replaced MIN(uuid_col) with ROW_NUMBER() OVER (... ORDER BY uuid_col::text ASC) = 1
--   pattern throughout (same deterministic ordering, works on all Postgres versions).
-- down migration: 0031_companies_unique_ticker.down.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0a: Pre-deduplicate company_relations before rewire.
--
-- company_relations_unique_edge_idx: UNIQUE (workspace_id, company_id, target_label, relation_type)
-- When we rewire dup company_ids → survivor, child rows that differ only in company_id
-- (currently dup1 vs dup2) will collide when both become survivor_id.
-- Solution: project each row's company_id to its survivor, then DELETE all rows where
-- a lower-id sibling already occupies the same (workspace_id, survivor_id, target_label, relation_type).
-- UUID has no MIN() aggregate → use ROW_NUMBER() ORDER BY id::text ASC instead.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM company_relations
WHERE id IN (
  SELECT cr2.id
  FROM (
    SELECT
      cr.id,
      ROW_NUMBER() OVER (
        PARTITION BY cr.workspace_id, s.survivor_id, cr.target_label, cr.relation_type
        ORDER BY cr.id::text ASC
      ) AS rn
    FROM company_relations cr
    JOIN (
      SELECT
        id,
        MIN(id::text) OVER (PARTITION BY workspace_id, ticker) AS survivor_text
      FROM companies
    ) s ON s.id = cr.company_id
  ) cr2
  WHERE cr2.rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0b: Pre-deduplicate company_keywords before rewire.
--
-- company_keywords_unique_keyword_idx: UNIQUE (workspace_id, company_id, label)
-- Same pattern: project company_id → survivor_id, keep lowest id::text per group.
-- UUID has no MIN() aggregate → use ROW_NUMBER() ORDER BY id::text ASC instead.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM company_keywords
WHERE id IN (
  SELECT ck2.id
  FROM (
    SELECT
      ck.id,
      ROW_NUMBER() OVER (
        PARTITION BY ck.workspace_id, s.survivor_text, ck.label
        ORDER BY ck.id::text ASC
      ) AS rn
    FROM company_keywords ck
    JOIN (
      SELECT
        id,
        MIN(id::text) OVER (PARTITION BY workspace_id, ticker) AS survivor_text
      FROM companies
    ) s ON s.id = ck.company_id
  ) ck2
  WHERE ck2.rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0c: Pre-deduplicate company_theme_links before rewire.
--
-- company_theme_links PRIMARY KEY (company_id, theme_id)
-- When we rewire dup company_ids → survivor, rows that differ only in company_id
-- (dup1 vs dup2) collide when both become survivor_id — PK violation → rollback.
-- Solution: project each row's company_id → survivor_id via ROW_NUMBER(),
-- DELETE all rows where rn > 1 (keeping the lowest original company_id per pair).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM company_theme_links
WHERE (company_id, theme_id) IN (
  SELECT company_id, theme_id
  FROM (
    SELECT
      ctl.company_id,
      ctl.theme_id,
      ROW_NUMBER() OVER (
        PARTITION BY s.survivor_text, ctl.theme_id
        ORDER BY ctl.company_id::text ASC
      ) AS rn
    FROM company_theme_links ctl
    JOIN (
      SELECT id, MIN(id::text) OVER (PARTITION BY workspace_id, ticker) AS survivor_text
      FROM companies
    ) s ON s.id = ctl.company_id
  ) ranked
  WHERE rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0d: Pre-deduplicate companies_ohlcv before rewire.
--
-- companies_ohlcv UNIQUE INDEX (company_id, dt, interval)
-- Same pattern: project company_id → survivor_id, keep lowest id::text per triple,
-- delete all other rows that would collide after rewire.
-- UUID has no MIN() aggregate → use ROW_NUMBER() ORDER BY id::text ASC instead.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM companies_ohlcv
WHERE id IN (
  SELECT o2.id
  FROM (
    SELECT
      o.id,
      ROW_NUMBER() OVER (
        PARTITION BY s.survivor_text, o.dt, o.interval
        ORDER BY o.id::text ASC
      ) AS rn
    FROM companies_ohlcv o
    JOIN (
      SELECT
        id,
        MIN(id::text) OVER (PARTITION BY workspace_id, ticker) AS survivor_text
      FROM companies
    ) s ON s.id = o.company_id
  ) o2
  WHERE o2.rn > 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1a: Rewire company_theme_links.company_id → survivor
-- (pre-deduped in Step 0c — safe to UPDATE now)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_theme_links ctl
SET company_id = survivor.id
FROM (
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE ctl.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1b: Rewire company_relations.company_id → survivor
-- (pre-deduped in Step 0a — safe to UPDATE now)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_relations cr
SET company_id = survivor.id
FROM (
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE cr.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1c: Rewire company_relations.target_company_id → survivor
-- target_company_id is nullable; only rewire rows that reference a duplicate.
-- No unique index on (workspace_id, target_company_id, ...) so no pre-dedup needed.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_relations cr
SET target_company_id = survivor.id
FROM (
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE cr.target_company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1d: Rewire company_keywords.company_id → survivor
-- (pre-deduped in Step 0b — safe to UPDATE now)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE company_keywords ck
SET company_id = survivor.id
FROM (
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
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
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
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
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE cn.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1g: Rewire companies_ohlcv.company_id → survivor
-- (pre-deduped in Step 0d — safe to UPDATE now)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE companies_ohlcv o
SET company_id = survivor.id
FROM (
  SELECT DISTINCT ON (workspace_id, ticker) id, workspace_id, ticker
  FROM companies
  ORDER BY workspace_id, ticker, id::text ASC
) survivor
JOIN companies dup
  ON dup.workspace_id = survivor.workspace_id
  AND dup.ticker = survivor.ticker
  AND dup.id != survivor.id
WHERE o.company_id = dup.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Safe DELETE of duplicate companies rows.
-- Uses EXISTS (not NOT IN) to avoid NULL-in-subquery correctness trap:
--   NOT IN returns no rows when subquery contains any NULL — EXISTS is always safe.
-- Deletes every row c where a lexicographically-smaller id exists for the same
-- (workspace_id, ticker) — i.e., only the MIN(id::text) survivor survives.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM companies c
WHERE EXISTS (
  SELECT 1
  FROM companies c2
  WHERE c2.workspace_id = c.workspace_id
    AND c2.ticker = c.ticker
    AND c2.id::text < c.id::text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Create unique index to prevent future duplicates.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS companies_workspace_ticker_uidx
  ON companies (workspace_id, ticker);
