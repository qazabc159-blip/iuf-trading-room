-- Migration 0052: scope Web Push subscriptions to a workspace.
--
-- Existing production is single-tenant. Backfill uses the owning user's
-- workspace (the primary workspace today); legacy users with a NULL workspace
-- deterministically fall back to the oldest workspace.

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

UPDATE push_subscriptions AS ps
SET workspace_id = COALESCE(
  u.workspace_id,
  (
    SELECT w.id
    FROM workspaces AS w
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT 1
  )
)
FROM users AS u
WHERE ps.user_id = u.id
  AND ps.workspace_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM push_subscriptions
    WHERE workspace_id IS NULL
  ) THEN
    RAISE EXCEPTION '0052 backfill failed: push_subscriptions.workspace_id remains NULL';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'push_subscriptions_workspace_id_fkey'
      AND conrelid = 'push_subscriptions'::regclass
  ) THEN
    ALTER TABLE push_subscriptions
      ADD CONSTRAINT push_subscriptions_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END
$$;

ALTER TABLE push_subscriptions
  ALTER COLUMN workspace_id SET NOT NULL;

DROP INDEX IF EXISTS push_subscriptions_endpoint_uidx;
DROP INDEX IF EXISTS push_subscriptions_user_created_idx;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_workspace_endpoint_uidx
  ON push_subscriptions(workspace_id, endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_workspace_user_created_idx
  ON push_subscriptions(workspace_id, user_id, created_at DESC);
