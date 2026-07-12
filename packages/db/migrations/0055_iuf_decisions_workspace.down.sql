-- Rollback: 0055_iuf_decisions_workspace

-- Refuse to erase real tenancy or collapse two workspace-local trigger keys
-- into the legacy global unique key.
DO $$
DECLARE
  tenant_count BIGINT;
  duplicate_key_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'iuf_decisions'
      AND column_name = 'workspace_id'
  ) THEN
    SELECT COUNT(DISTINCT workspace_id) INTO tenant_count FROM iuf_decisions;
    IF tenant_count > 1 THEN
      RAISE EXCEPTION
        '0055 down refused: iuf_decisions contains rows for % workspaces',
        tenant_count;
    END IF;

    SELECT COUNT(*) INTO duplicate_key_count
    FROM (
      SELECT trigger_type, trigger_id
      FROM iuf_decisions
      GROUP BY trigger_type, trigger_id
      HAVING COUNT(*) > 1
    ) AS duplicate_keys;
    IF duplicate_key_count > 0 THEN
      RAISE EXCEPTION
        '0055 down refused: % trigger keys would violate the legacy global uniqueness constraint',
        duplicate_key_count;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS iuf_decisions_workspace_created_at_idx;
DROP INDEX IF EXISTS iuf_decisions_workspace_action_type_created_idx;
DROP INDEX IF EXISTS iuf_decisions_workspace_status_created_idx;
DROP INDEX IF EXISTS iuf_decisions_workspace_trigger_uidx;

ALTER TABLE IF EXISTS iuf_decisions
  DROP CONSTRAINT IF EXISTS iuf_decisions_workspace_id_fkey;

ALTER TABLE IF EXISTS iuf_decisions
  DROP COLUMN IF EXISTS workspace_id;

CREATE UNIQUE INDEX IF NOT EXISTS iuf_decisions_trigger_uidx
  ON iuf_decisions (trigger_type, trigger_id);

CREATE INDEX IF NOT EXISTS iuf_decisions_status_created_idx
  ON iuf_decisions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS iuf_decisions_action_type_created_idx
  ON iuf_decisions (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS iuf_decisions_created_at_idx
  ON iuf_decisions (created_at DESC);
