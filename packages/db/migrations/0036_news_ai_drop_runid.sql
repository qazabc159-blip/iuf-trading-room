-- migration: 0036_news_ai_drop_runid
-- purpose: Remove redundant run_id column from news_ai_selections.
--          id (PK) always equaled run_id (both set to randomUUID()) --
--          drop run_id to eliminate dual-identity ambiguity (Mike W1 fix).
--          Add jsonb_typeof CHECK on items to enforce array type (Mike W2 fix).
-- scope: additive-only change on existing 0035 table. No data loss (run_id == id).
-- down migration: 0036_news_ai_drop_runid.down.sql

-- W1 fix: drop redundant run_id column (id PK is the sole unique identifier)
ALTER TABLE news_ai_selections
  DROP COLUMN IF EXISTS run_id;

-- W2 fix: items must be a JSON array (not object or scalar)
ALTER TABLE news_ai_selections
  ADD CONSTRAINT news_ai_selections_items_arr_chk
    CHECK (jsonb_typeof(items) = 'array');

-- ============================================================
-- Quarantine (Mike standard -- 0036 scope marker)
-- ============================================================
CREATE TABLE IF NOT EXISTS _quarantine_news_ai_drop_runid_0036 (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT
);
