-- 0058 — paper_realized_pnl: persisted FIFO-matched realized P&L ledger
--
-- Problem solved: the paper trading channel's realized P&L was only ever a
-- live-recomputed view (domain/trading/paper-ledger-db.ts computeFifoRealizedPnl(),
-- re-scanning every filled order on each /api/v1/paper/positions request) — there
-- was no formal, immutable record of individual sell-closes produced. This table
-- persists one row per FIFO-matched (buy-lot slice, sell-fill) pair, written at
-- the moment a sell order fills (domain/trading/order-driver.ts driveOrder()), so
-- historical realized trades remain stable even if the live FIFO matcher's cost-
-- rate assumptions change later, and a dedicated endpoint can list them without
-- re-deriving from scratch on every request.
--
-- Write path: domain/trading/paper-ledger-db.ts recordRealizedPnlForSell(),
--             called from order-driver.ts driveOrder() right after a sell fill
--             is recorded via recordFill().
-- Read path:  domain/trading/paper-ledger-db.ts listRealizedPnlForUser(),
--             surfaced at GET /api/v1/paper/realized.
--
-- sell_order_id FK + index lets recordRealizedPnlForSell() check "have I
-- already written matches for this sell?" before inserting (defensive
-- idempotency guard; recordFill() itself is already idempotent per orderId,
-- this guards against driveOrder ever being re-invoked for the same fill).
--
-- ADDITIVE ONLY — no existing table modified.

CREATE TABLE IF NOT EXISTS paper_realized_pnl (
  id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID           NOT NULL,
  symbol             TEXT           NOT NULL,
  matched_qty_shares INTEGER        NOT NULL CHECK (matched_qty_shares > 0),
  buy_price          NUMERIC(14, 4) NOT NULL,
  sell_price         NUMERIC(14, 4) NOT NULL,
  buy_fill_time      TIMESTAMPTZ    NOT NULL,
  sell_fill_time     TIMESTAMPTZ    NOT NULL,
  realized_pnl_twd   NUMERIC(14, 2) NOT NULL,
  sell_order_id      UUID           NOT NULL REFERENCES paper_orders(id) ON DELETE CASCADE,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Covering index for the main read: "this user's realized trades, newest first,
-- optionally filtered to one symbol".
CREATE INDEX IF NOT EXISTS paper_realized_pnl_user_symbol_idx
  ON paper_realized_pnl (user_id, symbol, sell_fill_time DESC);

-- Idempotency check + cascade lookup.
CREATE INDEX IF NOT EXISTS paper_realized_pnl_sell_order_idx
  ON paper_realized_pnl (sell_order_id);
