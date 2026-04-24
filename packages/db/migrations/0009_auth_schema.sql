-- Round 18 — Auth schema: password hash + invite codes
-- Adds password_hash to users table and creates invite_codes table.
-- These columns are required for owner login gate (Jim) and invite-based onboarding.
-- password_hash: bcrypt hash only, NEVER plaintext stored here.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Viewer';

CREATE TABLE IF NOT EXISTS invite_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  created_by  UUID REFERENCES users(id),
  used_by     UUID REFERENCES users(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invite_codes_code_idx ON invite_codes(code);
CREATE INDEX IF NOT EXISTS invite_codes_expires_idx ON invite_codes(expires_at) WHERE used_at IS NULL;
