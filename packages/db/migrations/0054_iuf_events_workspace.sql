-- Migration: 0054_iuf_events_workspace
-- Purpose: make the event/alert data plane tenant-safe before a second workspace is enabled.
-- Existing iuf_events rows were produced while the product had exactly one workspace.

ALTER TABLE iuf_events
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Fail closed: legacy events have no ownership evidence. They may only be
-- attributed automatically when exactly one workspace exists.
DO $$
DECLARE
  missing_workspace_rows BIGINT;
  workspace_count BIGINT;
  sole_workspace_id UUID;
BEGIN
  SELECT COUNT(*) INTO missing_workspace_rows
  FROM iuf_events
  WHERE workspace_id IS NULL;

  IF missing_workspace_rows > 0 THEN
    SELECT COUNT(*) INTO workspace_count FROM workspaces;
    IF workspace_count <> 1 THEN
      RAISE EXCEPTION
        '0054 cannot safely backfill % iuf_events rows: expected exactly one workspace, found %',
        missing_workspace_rows,
        workspace_count;
    END IF;

    SELECT id INTO sole_workspace_id
    FROM workspaces
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    UPDATE iuf_events
    SET workspace_id = sole_workspace_id
    WHERE workspace_id IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'iuf_events_workspace_id_fkey'
      AND conrelid = 'iuf_events'::regclass
  ) THEN
    ALTER TABLE iuf_events
      ADD CONSTRAINT iuf_events_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE iuf_events
  ALTER COLUMN workspace_id SET NOT NULL;

DROP INDEX IF EXISTS iuf_events_rule_ticker_time_idx;
DROP INDEX IF EXISTS iuf_events_triggered_at_idx;
DROP INDEX IF EXISTS iuf_events_unread_idx;

CREATE INDEX IF NOT EXISTS iuf_events_workspace_rule_ticker_time_idx
  ON iuf_events (workspace_id, rule_id, ticker, triggered_at DESC);

CREATE INDEX IF NOT EXISTS iuf_events_workspace_triggered_at_idx
  ON iuf_events (workspace_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS iuf_events_workspace_unread_idx
  ON iuf_events (workspace_id, triggered_at DESC)
  WHERE acknowledged = FALSE;
