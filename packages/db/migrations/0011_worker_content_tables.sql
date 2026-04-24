-- Round Jason 2026-04-24 — worker producer content tables
-- daily_briefs: persisted daily briefings (previously memory-only in postgres repo)
-- theme_summaries: worker-generated theme summaries
-- company_notes: worker-generated company notes

CREATE TABLE IF NOT EXISTS daily_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  date TEXT NOT NULL,
  market_state TEXT NOT NULL DEFAULT 'Balanced',
  sections JSONB NOT NULL DEFAULT '[]',
  generated_by TEXT NOT NULL DEFAULT 'worker',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_briefs_workspace_date_idx
  ON daily_briefs(workspace_id, date);

CREATE TABLE IF NOT EXISTS theme_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  theme_id UUID NOT NULL REFERENCES themes(id),
  summary TEXT NOT NULL,
  company_count INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS theme_summaries_theme_idx
  ON theme_summaries(theme_id, generated_at);

CREATE TABLE IF NOT EXISTS company_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  note TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_notes_company_idx
  ON company_notes(company_id, generated_at);
