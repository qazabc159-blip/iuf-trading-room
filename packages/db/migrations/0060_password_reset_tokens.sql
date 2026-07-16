-- Migration 0060: password_reset_tokens + users.session_epoch
-- Purpose: admin-mediated "forgot password" flow (this app has no outbound
--   mailer capable of sending to an arbitrary end-user address today — see
--   workspace_invites, which uses the same admin-hands-over-a-link pattern
--   for registration). Two-step lifecycle:
--     1. User self-submits POST /auth/request-password-reset -> row inserted
--        with token_hash = NULL ("pending"; nothing usable exists yet).
--     2. Owner/Admin reviews the pending queue and calls
--        POST /admin/password-reset-requests/:id/generate-link, which fills
--        token_hash/expires_at/generated_by/generated_at. The plain token is
--        returned once in that response and never stored (same discipline as
--        workspace_invites.token_hash).
-- Security:
--   - token_hash stores SHA-256 hash only; plain token shown once at generation
--   - expires_at set at generation time (not at request time), TTL = 1 hour
--   - used_at set atomically via UPDATE ... WHERE used_at IS NULL (same
--     concurrent-claim guard as workspace_invites)
--   - revoked_at set when a newer self-submitted request supersedes this row
--   - session_epoch on users lets a successful reset invalidate every
--     previously-issued session cookie for that user in one write (the
--     signed cookie embeds the epoch it was issued with)
-- Review: awaiting Mike audit before deploy

-- 1. Session epoch for cookie invalidation (default 0 -> no existing session disrupted
--    until the column value actually changes, which only happens via reset-password).
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_epoch INTEGER NOT NULL DEFAULT 0;

-- 2. Reset token table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT        UNIQUE,              -- null until admin generates the link
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at  TIMESTAMPTZ,
  generated_by  UUID        REFERENCES users(id),
  expires_at    TIMESTAMPTZ,                      -- set at generation time (+1h)
  used_at       TIMESTAMPTZ,                       -- set atomically on claim
  revoked_at    TIMESTAMPTZ                        -- superseded by a newer request
);

-- Index for: admin pending-queue listing + per-user "supersede prior request" lookups
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx
  ON password_reset_tokens(user_id);

-- Index for: admin pending-queue ordering + future expiry-cleanup job
CREATE INDEX IF NOT EXISTS password_reset_tokens_requested_at_idx
  ON password_reset_tokens(requested_at);
