-- Round Jason P1 2026-04-24 — P1 worker content tables
-- review_summaries: worker-generated retrospective/review content per theme
-- signal_clusters:  rule-based groupings of signals by theme or relation

CREATE TABLE IF NOT EXISTS review_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  theme_id UUID NOT NULL REFERENCES themes(id),
  body_md TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'week',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_summaries_theme_idx
  ON review_summaries(theme_id, generated_at);

CREATE INDEX IF NOT EXISTS review_summaries_workspace_period_idx
  ON review_summaries(workspace_id, period, generated_at);

CREATE TABLE IF NOT EXISTS signal_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  label TEXT NOT NULL,
  member_tickers JSONB NOT NULL DEFAULT '[]',
  member_themes JSONB NOT NULL DEFAULT '[]',
  rationale_md TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signal_clusters_workspace_idx
  ON signal_clusters(workspace_id, generated_at);
