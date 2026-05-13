-- 0030 down — DROP tw_announcements (reverse of 0030_tw_announcements.sql)
-- Safe: table is a cache layer only; no FK references to it from other tables.

DROP INDEX IF EXISTS tw_announcements_at_idx;
DROP INDEX IF EXISTS tw_announcements_ticker_at_idx;
DROP INDEX IF EXISTS tw_announcements_dedup_uidx;
DROP TABLE IF EXISTS tw_announcements;
