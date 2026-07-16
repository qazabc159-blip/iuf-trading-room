-- Down migration 0060: remove password_reset_tokens + users.session_epoch
-- Safe to run: only removes objects added in 0060

DROP TABLE IF EXISTS password_reset_tokens;
ALTER TABLE users DROP COLUMN IF EXISTS session_epoch;
