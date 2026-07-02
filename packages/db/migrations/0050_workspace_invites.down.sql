-- Down migration 0050: remove workspace_invites + is_active
-- Safe to run: only removes tables/columns added in 0050

DROP TABLE IF EXISTS workspace_invites;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
