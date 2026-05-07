-- Migration: 0026_iuf_notification_preferences
-- Status: DRAFT — awaiting Mike (migration-auditor) audit before promotion
-- Owner: Jason (backend-strategy)
-- Purpose: Per-user notification preference storage for OpenAlice alert system (BLOCK #6)
--
-- This migration is skipped by migrate.ts (DRAFT suffix filter).
-- Do NOT promote until Mike audit sign-off.
--
-- Related: apps/api/src/openalice-email-digest.ts
-- Note: Current digest uses DIGEST_EMAIL env var as fallback;
--       this table provides per-user preference override.

CREATE TABLE IF NOT EXISTS iuf_notification_preferences (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Notification channels
  email_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  email_address TEXT        NOT NULL,         -- override per user (defaults to user.email)
  -- Severity filter: notify for events at or above this severity
  min_severity  TEXT        NOT NULL DEFAULT 'warning'
                CHECK (min_severity IN ('info', 'warning', 'critical')),
  -- Digest schedule: 'daily_close' (17:00 TST) | 'realtime' (SSE only, no email)
  digest_schedule TEXT      NOT NULL DEFAULT 'daily_close'
                CHECK (digest_schedule IN ('daily_close', 'realtime')),
  -- Rule filter: NULL = all rules; JSON array of rule IDs to subscribe
  rule_filter   JSONB       NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)  -- one preference row per user
);

CREATE INDEX IF NOT EXISTS iuf_notif_prefs_user_idx
  ON iuf_notification_preferences (user_id);

-- Quarantine table (Mike audit requirement)
CREATE TABLE IF NOT EXISTS _quarantine_iuf_notification_preferences (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id       UUID        NOT NULL,
  user_id           UUID        NOT NULL,
  reason_code       TEXT        NOT NULL,
  quarantined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload           JSONB       NOT NULL DEFAULT '{}'
);
