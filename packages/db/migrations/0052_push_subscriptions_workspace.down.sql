-- Down migration 0052: restore the single-tenant Web Push schema.
--
-- The old schema requires endpoint to be globally unique. Refuse rollback if
-- multi-workspace data can no longer satisfy that invariant; never delete a
-- valid subscription silently.

DO $$
BEGIN
  IF EXISTS (
    SELECT endpoint
    FROM push_subscriptions
    GROUP BY endpoint
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '0052 rollback blocked: duplicate endpoints exist across workspaces';
  END IF;
END
$$;

DROP INDEX IF EXISTS push_subscriptions_workspace_user_created_idx;
DROP INDEX IF EXISTS push_subscriptions_workspace_endpoint_uidx;

ALTER TABLE push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_workspace_id_fkey;

ALTER TABLE push_subscriptions
  DROP COLUMN IF EXISTS workspace_id;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uidx
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_created_idx
  ON push_subscriptions(user_id, created_at DESC);
