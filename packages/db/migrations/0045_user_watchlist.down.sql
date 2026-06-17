-- down migration: 0045_user_watchlist
-- Reverses 0045_user_watchlist.sql. Clean DROP of the additive table.
-- Indexes are dropped automatically with the table.

DROP TABLE IF EXISTS user_watchlist;
