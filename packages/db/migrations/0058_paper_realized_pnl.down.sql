-- 0058 down — drop paper_realized_pnl table and indexes

DROP INDEX IF EXISTS paper_realized_pnl_sell_order_idx;
DROP INDEX IF EXISTS paper_realized_pnl_user_symbol_idx;
DROP TABLE IF EXISTS paper_realized_pnl;
