-- 0013 — content_drafts: OpenAlice result review queue before formal table write
-- Idempotent: uses DO block + IF NOT EXISTS so re-apply is safe.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_draft_status') THEN
    CREATE TYPE content_draft_status AS ENUM (
      'awaiting_review',
      'approved',
      'rejected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  source_job_id UUID REFERENCES openalice_jobs(id),
  target_table TEXT NOT NULL,
  target_entity_id UUID,
  payload JSONB NOT NULL,
  status content_draft_status NOT NULL DEFAULT 'awaiting_review',
  dedupe_key TEXT NOT NULL,
  producer_version TEXT NOT NULL DEFAULT 'v1',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  reject_reason TEXT,
  approved_ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS content_drafts_workspace_status_idx
  ON content_drafts (workspace_id, status, created_at);

CREATE INDEX IF NOT EXISTS content_drafts_dedupe_key_idx
  ON content_drafts (dedupe_key, created_at);

CREATE INDEX IF NOT EXISTS content_drafts_status_created_idx
  ON content_drafts (status, created_at);

CREATE INDEX IF NOT EXISTS content_drafts_source_job_idx
  ON content_drafts (source_job_id);
