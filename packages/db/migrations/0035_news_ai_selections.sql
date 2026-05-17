-- migration: 0035_news_ai_selections
-- purpose: Persist AI-selected news top-10 results to DB
--          Enables boot recovery without never_run state after deploy.
-- scope: additive-only (1 new table). No existing tables modified.
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are required -- checked
--   B2: id TEXT PK (run_id as UUID string, stable across in-memory/DB)
--   W1: index on as_of DESC for getLatest() query performance
--   W2: no FK to workspaces -- system-level table, survives workspace operations
--   W3: items JSONB -- stores full NewsAiItem[] array (no monetary columns)
--   N1: selection_mode CHECK ensures only ai|fallback
--   quarantine table: _quarantine_news_ai_selections_0035 included per Mike standard
-- down migration: 0035_news_ai_selections.down.sql

-- ============================================================
-- Table: news_ai_selections
-- Persists each AI selection run result (cron or manual).
-- getLatest() queries ORDER BY as_of DESC LIMIT 1.
-- ============================================================
CREATE TABLE IF NOT EXISTS news_ai_selections (
  -- run_id: UUID from randomUUID() -- stable identifier across in-memory and DB
  id                  TEXT        NOT NULL,
  run_id              TEXT        NOT NULL,
  as_of               TIMESTAMPTZ NOT NULL,
  window_label        TEXT        NOT NULL,
  selection_mode      TEXT        NOT NULL,
  items               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  input_row_count     INTEGER     NOT NULL DEFAULT 0,
  ai_call_success     BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT news_ai_selections_pkey      PRIMARY KEY (id),
  CONSTRAINT news_ai_selections_mode_chk  CHECK (selection_mode IN ('ai', 'fallback'))
);

-- Index for getLatest() -- ORDER BY as_of DESC LIMIT 1
CREATE INDEX IF NOT EXISTS news_ai_selections_as_of_idx
  ON news_ai_selections (as_of DESC);

-- ============================================================
-- Quarantine (Mike standard -- 0035 scope marker)
-- ============================================================
CREATE TABLE IF NOT EXISTS _quarantine_news_ai_selections_0035 (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT
);
