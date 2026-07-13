-- Migration: 0054_iuf_events_workspace
-- Purpose: make the event/alert data plane tenant-safe before a second workspace is enabled.
-- Existing iuf_events rows were produced while the product had exactly one workspace.

ALTER TABLE iuf_events
  ADD COLUMN IF NOT EXISTS workspace_id UUID;

-- Fail closed: legacy events have no ownership evidence. Do NOT infer from
-- "how many workspaces exist" -- prod carries 18 workspaces as of
-- 2026-07-13 (17 are 2026-04 test residue, 1 real "Primary Desk"), so a
-- single-workspace assumption is provably false here and previously took
-- prod down for ~40 minutes (see
-- reports/tenancy_readiness_20260712/FIX_FORWARD_0054_SPEC_2026_07_13.md,
-- fix-forward option ii). Assign orphans to the one workspace that has ever
-- produced this data; fail closed if that workspace is ever renamed or
-- removed instead of silently guessing.
DO $$
DECLARE
  missing_workspace_rows BIGINT;
  default_workspace_id CONSTANT UUID := '888fd3bd-4a48-4656-9e6a-ac19360cc0de'; -- Primary Desk
BEGIN
  SELECT COUNT(*) INTO missing_workspace_rows
  FROM iuf_events
  WHERE workspace_id IS NULL;

  IF missing_workspace_rows > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = default_workspace_id) THEN
      RAISE EXCEPTION
        '0054 cannot safely backfill % iuf_events rows: hard-coded default workspace % (Primary Desk) not found',
        missing_workspace_rows,
        default_workspace_id;
    END IF;

    UPDATE iuf_events
    SET workspace_id = default_workspace_id
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
