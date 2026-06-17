-- migration: 0045_user_watchlist
-- purpose: user-managed trade-desk watchlist (replaces the hardcoded default 8 symbols)
-- scope: new table user_watchlist; additive-only (no existing tables modified)
-- Yang 2026-06-17: the watchlist must be user-editable (add/remove own symbols),
--   not a hardcoded list. Each user curates their own, persisted per workspace.
-- down migration: 0045_user_watchlist.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are set at insert time -- checked
--       (id default, name default '', sort_order default 0, created_at default now;
--        workspace_id/user_id/symbol set at insert)
--   B2: JSONB columns: none -- N/A
--   W1: additive-only new table -- no data loss on forward
--   W2: idempotent via IF NOT EXISTS on TABLE and INDEX
--   W3: down migration is a clean DROP TABLE -- safe
--   W4: UNIQUE (workspace_id, user_id, symbol) enforces no duplicate symbols per user
--   W5: FK cascade — ON DELETE CASCADE so removing a workspace/user cleans up rows

CREATE TABLE IF NOT EXISTS user_watchlist (
  id            UUID         NOT NULL DEFAULT gen_random_uuid(),
  workspace_id  UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        TEXT         NOT NULL,
  name          TEXT         NOT NULL DEFAULT '',
  sort_order    REAL         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT user_watchlist_pkey PRIMARY KEY (id)
);

-- Idempotency: one row per (workspace, user, symbol). Add is upsert-safe.
CREATE UNIQUE INDEX IF NOT EXISTS user_watchlist_user_symbol_uidx
  ON user_watchlist (workspace_id, user_id, symbol);

-- List queries filter by workspace+user and order by sort_order.
CREATE INDEX IF NOT EXISTS user_watchlist_user_idx
  ON user_watchlist (workspace_id, user_id, sort_order);
