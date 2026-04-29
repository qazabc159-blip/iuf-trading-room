-- 0015 down — revert W6 Paper Trading Sprint scaffold
-- Drop in reverse-dependency order (paper_fills depends on paper_orders via FK CASCADE)

DROP INDEX IF EXISTS paper_positions_user_id_idx;
DROP TABLE IF EXISTS paper_positions;

DROP INDEX IF EXISTS paper_fills_order_id_idx;
DROP TABLE IF EXISTS paper_fills;

DROP INDEX IF EXISTS paper_orders_symbol_idx;
DROP INDEX IF EXISTS paper_orders_user_id_idx;
DROP INDEX IF EXISTS paper_orders_idempotency_key_idx;
DROP TABLE IF EXISTS paper_orders;
