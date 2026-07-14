-- 0057 down — drop index_history table and indexes

DROP INDEX IF EXISTS index_history_symbol_date_idx;
DROP INDEX IF EXISTS index_history_trade_date_idx;
DROP TABLE IF EXISTS index_history;
