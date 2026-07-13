-- Rollback: 0054_iuf_events_workspace

-- Dropping workspace_id is only reversible while all stored events still
-- belong to at most one workspace. Refuse to collapse real multi-tenant data.
DO $$
DECLARE
  tenant_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'iuf_events'
      AND column_name = 'workspace_id'
  ) THEN
    SELECT COUNT(DISTINCT workspace_id) INTO tenant_count FROM iuf_events;
    IF tenant_count > 1 THEN
      RAISE EXCEPTION
        '0054 down refused: iuf_events contains rows for % workspaces',
        tenant_count;
    END IF;
  END IF;
END $$;

DROP INDEX IF EXISTS iuf_events_workspace_unread_idx;
DROP INDEX IF EXISTS iuf_events_workspace_triggered_at_idx;
DROP INDEX IF EXISTS iuf_events_workspace_rule_ticker_time_idx;

ALTER TABLE IF EXISTS iuf_events
  DROP CONSTRAINT IF EXISTS iuf_events_workspace_id_fkey;

ALTER TABLE IF EXISTS iuf_events
  DROP COLUMN IF EXISTS workspace_id;

CREATE INDEX IF NOT EXISTS iuf_events_rule_ticker_time_idx
  ON iuf_events (rule_id, ticker, triggered_at DESC);

CREATE INDEX IF NOT EXISTS iuf_events_triggered_at_idx
  ON iuf_events (triggered_at DESC);

CREATE INDEX IF NOT EXISTS iuf_events_unread_idx
  ON iuf_events (acknowledged, triggered_at DESC)
  WHERE acknowledged = FALSE;
