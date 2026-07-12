-- Migration: 0055_iuf_decisions_workspace
-- Purpose: make OpenAlice decisions tenant-owned and tenant-queryable.

ALTER TABLE iuf_decisions
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Prefer provenance over assumption: both trigger tables already carry
-- workspace_id. This safely attributes decisions whose trigger row remains.
UPDATE iuf_decisions AS d
SET workspace_id = e.workspace_id
FROM iuf_events AS e
WHERE d.workspace_id IS NULL
  AND d.trigger_type = 'event'
  AND d.trigger_id = e.id::text;

UPDATE iuf_decisions AS d
SET workspace_id = s.workspace_id
FROM signals AS s
WHERE d.workspace_id IS NULL
  AND d.trigger_type = 'signal'
  AND d.trigger_id = s.id::text;

-- Orphaned legacy decisions have no remaining trigger evidence. Preserve the
-- current single-workspace deployment, but refuse to guess once 0 or 2+
-- workspaces exist.
DO $$
DECLARE
  missing_workspace_rows BIGINT;
  workspace_count BIGINT;
  sole_workspace_id UUID;
BEGIN
  SELECT COUNT(*) INTO missing_workspace_rows
  FROM iuf_decisions
  WHERE workspace_id IS NULL;

  IF missing_workspace_rows > 0 THEN
    SELECT COUNT(*) INTO workspace_count FROM workspaces;
    IF workspace_count <> 1 THEN
      RAISE EXCEPTION
        '0055 cannot safely backfill % orphaned iuf_decisions rows: expected exactly one workspace, found %',
        missing_workspace_rows,
        workspace_count;
    END IF;

    SELECT id INTO sole_workspace_id
    FROM workspaces
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    UPDATE iuf_decisions
    SET workspace_id = sole_workspace_id
    WHERE workspace_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'iuf_decisions_workspace_id_fkey'
      AND conrelid = 'iuf_decisions'::regclass
  ) THEN
    ALTER TABLE iuf_decisions
      ADD CONSTRAINT iuf_decisions_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE iuf_decisions
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE iuf_decisions
  DROP CONSTRAINT IF EXISTS iuf_decisions_trigger_uidx;

DROP INDEX IF EXISTS iuf_decisions_trigger_uidx;
DROP INDEX IF EXISTS iuf_decisions_status_created_idx;
DROP INDEX IF EXISTS iuf_decisions_action_type_created_idx;
DROP INDEX IF EXISTS iuf_decisions_created_at_idx;

CREATE UNIQUE INDEX IF NOT EXISTS iuf_decisions_workspace_trigger_uidx
  ON iuf_decisions (workspace_id, trigger_type, trigger_id);

CREATE INDEX IF NOT EXISTS iuf_decisions_workspace_status_created_idx
  ON iuf_decisions (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS iuf_decisions_workspace_action_type_created_idx
  ON iuf_decisions (workspace_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS iuf_decisions_workspace_created_at_idx
  ON iuf_decisions (workspace_id, created_at DESC);
