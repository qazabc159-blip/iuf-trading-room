-- Phase 1 follow-up — persistent execution event log.
-- The paper broker emits submit/ack/fill/cancel/reject/expire events to an
-- in-memory subscriber set so the SSE stream can broadcast them. Until now
-- those events vanished after a process restart and weren't queryable, so a
-- reconnecting client only saw events emitted after the SSE handshake.
-- This table makes the timeline historical: every emit is appended (fire-
-- and-forget from the broker hot path) and clients bootstrap from the most
-- recent N rows before subscribing to the live stream.
CREATE TABLE IF NOT EXISTS execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  payload JSONB,
  emitted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS execution_events_workspace_account_idx
  ON execution_events (workspace_id, account_id, emitted_at);

CREATE INDEX IF NOT EXISTS execution_events_order_idx
  ON execution_events (workspace_id, order_id);
