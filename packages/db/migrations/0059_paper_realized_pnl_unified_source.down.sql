-- 0059 down — revert paper_realized_pnl to the 0058 shape.
--
-- CAVEAT (same pattern as other down.sql files in this repo): if any rows
-- exist with source='unified_paper' (order ids not present in paper_orders),
-- re-adding the FK constraints below will fail. Rollback of this migration is
-- only safe before any unified-pipeline sell has actually written a row.

DROP INDEX IF EXISTS paper_realized_pnl_account_idx;
ALTER TABLE paper_realized_pnl DROP COLUMN IF EXISTS account_id;
ALTER TABLE paper_realized_pnl DROP CONSTRAINT IF EXISTS paper_realized_pnl_source_check;
ALTER TABLE paper_realized_pnl DROP COLUMN IF EXISTS source;

ALTER TABLE paper_realized_pnl
  ADD CONSTRAINT paper_realized_pnl_buy_order_id_fkey
  FOREIGN KEY (buy_order_id) REFERENCES paper_orders(id) ON DELETE RESTRICT;

ALTER TABLE paper_realized_pnl
  ADD CONSTRAINT paper_realized_pnl_sell_order_id_fkey
  FOREIGN KEY (sell_order_id) REFERENCES paper_orders(id) ON DELETE RESTRICT;
