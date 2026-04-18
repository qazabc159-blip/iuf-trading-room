-- Phase 1 follow-up — restart-safe paper broker state.
-- One snapshot row per (workspace, account) holds the full account state
-- (cash, positions, orders, fills, realized PnL). The paper broker stays
-- in-memory for hot-path mutations and upserts the snapshot after every
-- write so a process restart can rehydrate without losing state.
CREATE TABLE IF NOT EXISTS paper_broker_state (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, account_id)
);
