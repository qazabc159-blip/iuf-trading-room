-- down migration: 0036_news_ai_drop_runid
-- Restore run_id column and remove CHECK constraint.

ALTER TABLE news_ai_selections
  DROP CONSTRAINT IF EXISTS news_ai_selections_items_arr_chk;

ALTER TABLE news_ai_selections
  ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT '';

DROP TABLE IF EXISTS _quarantine_news_ai_drop_runid_0036;
