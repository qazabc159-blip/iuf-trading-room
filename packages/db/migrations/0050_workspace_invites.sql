-- Migration 0050: workspace_invites + users.is_active
-- Purpose: Invite-based user onboarding (Owner issues invite → recipient registers).
-- Key design:
--   - Token stored as SHA-256 hash (plain token returned once at creation, never stored)
--   - role CHECK excludes Owner (max invite role = Admin)
--   - is_active on users enables soft-deactivation without data loss
--   - Concurrent double-claim prevented by UPDATE WHERE used_at IS NULL (atomic)
-- Review: awaiting Mike audit before deploy

-- 1. Add is_active to users (default true → no existing user disrupted)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Invite table
CREATE TABLE IF NOT EXISTS workspace_invites (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  role          TEXT        NOT NULL
    CHECK (role IN ('Admin','Analyst','Trader','Viewer')),
  invited_email TEXT,                       -- null = universal link
  label         TEXT,                       -- human-readable description
  created_by    UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,               -- set atomically on claim
  used_by       UUID        REFERENCES users(id),
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for: listing pending invites by workspace
CREATE INDEX IF NOT EXISTS workspace_invites_workspace_expires_idx
  ON workspace_invites(workspace_id, expires_at);

-- Index for: listing all invites by workspace newest-first
CREATE INDEX IF NOT EXISTS workspace_invites_workspace_created_idx
  ON workspace_invites(workspace_id, created_at DESC);

-- Index for: audit trail (who issued what)
CREATE INDEX IF NOT EXISTS workspace_invites_created_by_idx
  ON workspace_invites(created_by);

-- Partial UNIQUE index: prevent same workspace+email from having multiple active invites.
-- "Active" = not yet used AND not yet revoked.
-- Allows re-inviting the same email AFTER a previous invite was used or revoked.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invites_workspace_email_active_uidx
  ON workspace_invites(workspace_id, invited_email)
  WHERE invited_email IS NOT NULL AND used_at IS NULL AND revoked_at IS NULL;
