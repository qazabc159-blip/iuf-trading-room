-- 0048 down — drop quote_last_close table and indexes

DROP INDEX IF EXISTS quote_last_close_symbol_date_idx;
DROP INDEX IF EXISTS quote_last_close_trade_date_idx;
DROP TABLE IF EXISTS quote_last_close;
