-- Round Jason 2026-04-24 — auth users extended
-- Extends 0009_auth_schema.sql which may already exist.
-- All ops are IF NOT EXISTS / ADD COLUMN IF NOT EXISTS to be idempotent.
-- Adds: workspace_id to users; normalises invite_codes (adds issued_by).

-- add workspace_id if not present
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Viewer';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id);

-- create invite_codes if not already created by 0009
CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  issued_by UUID REFERENCES users(id),
  used_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON invite_codes(code);

-- add issued_by in case table was created by 0009 with only created_by
ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES users(id);
