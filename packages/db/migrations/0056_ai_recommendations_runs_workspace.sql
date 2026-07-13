-- Migration: 0056_ai_recommendations_runs_workspace
-- Purpose: make every AI recommendation v3 run tenant-owned.

-- Legacy rows predate multi-workspace support. Preserve the current
-- single-workspace deployment, but never guess once tenancy is ambiguous.
DO $$
DECLARE
  missing_workspace_rows BIGINT;
  workspace_count BIGINT;
  sole_workspace_id UUID;
BEGIN
  SELECT COUNT(*) INTO missing_workspace_rows
  FROM ai_recommendations_runs
  WHERE workspace_id IS NULL;

  IF missing_workspace_rows > 0 THEN
    SELECT COUNT(*) INTO workspace_count FROM workspaces;
    IF workspace_count <> 1 THEN
      RAISE EXCEPTION
        '0056 cannot safely backfill % ai_recommendations_runs rows: expected exactly one workspace, found %',
        missing_workspace_rows,
        workspace_count;
    END IF;

    SELECT id INTO sole_workspace_id
    FROM workspaces
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    UPDATE ai_recommendations_runs
    SET workspace_id = sole_workspace_id
    WHERE workspace_id IS NULL;
  END IF;
END $$;

ALTER TABLE ai_recommendations_runs
  ALTER COLUMN workspace_id SET NOT NULL;

DROP INDEX IF EXISTS ai_rec_runs_generated_at_idx;

CREATE INDEX IF NOT EXISTS ai_rec_runs_workspace_generated_at_idx
  ON ai_recommendations_runs (workspace_id, generated_at DESC);
