-- Migration 0051: authenticated Web Push subscriptions.
-- VAPID keys are environment configuration and are never stored in this table.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL,
  keys       JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_subscriptions_keys_object_chk CHECK (
    jsonb_typeof(keys) = 'object'
    AND jsonb_typeof(keys->'p256dh') = 'string'
    AND jsonb_typeof(keys->'auth') = 'string'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uidx
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_created_idx
  ON push_subscriptions(user_id, created_at DESC);
