-- 0018 — W7 D3: daily_theme_summaries table
--
-- Per-day AI-generated market theme summary produced by the daily-theme-summary
-- worker cron (09:00 TST daily).  Distinct from the existing per-theme
-- `theme_summaries` table which is per-theme not per-day.
--
-- Design notes:
--   - dt stored as TEXT 'YYYY-MM-DD' (same pattern as daily_briefs).
--   - summary_md: full markdown body from gpt-5.4-mini.
--   - theme_label: concise ≤80-char label for the dominant theme of the day.
--   - source_event_count: number of market_events rows sampled this run.
--   - generated_by: 'worker_cron' | 'manual_trigger'.
--   - UNIQUE (workspace_id, dt) — one summary per workspace per day.
--
-- ADDITIVE ONLY — no existing table modified.

CREATE TABLE IF NOT EXISTS daily_theme_summaries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID        NOT NULL,
  dt                  TEXT        NOT NULL,
  summary_md          TEXT        NOT NULL,
  theme_label         TEXT        NOT NULL DEFAULT '',
  source_event_count  INTEGER     NOT NULL DEFAULT 0,
  generated_by        TEXT        NOT NULL DEFAULT 'worker_cron',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_theme_summaries_workspace_dt_uidx
  ON daily_theme_summaries (workspace_id, dt);

CREATE INDEX IF NOT EXISTS daily_theme_summaries_dt_idx
  ON daily_theme_summaries (dt DESC);
