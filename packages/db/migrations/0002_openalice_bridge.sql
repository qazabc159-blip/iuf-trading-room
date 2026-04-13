CREATE TYPE openalice_device_status AS ENUM ('active', 'revoked');
CREATE TYPE openalice_job_status AS ENUM (
  'queued',
  'running',
  'draft_ready',
  'validation_failed',
  'failed',
  'published',
  'rejected'
);

CREATE TABLE openalice_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  external_device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  token_hash TEXT NOT NULL,
  status openalice_device_status NOT NULL DEFAULT 'active',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX openalice_devices_external_device_id_idx
  ON openalice_devices(external_device_id);

CREATE TABLE openalice_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  claimed_by_device_id UUID REFERENCES openalice_devices(id),
  status openalice_job_status NOT NULL DEFAULT 'queued',
  task_type TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  context_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  timeout_seconds INTEGER,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
