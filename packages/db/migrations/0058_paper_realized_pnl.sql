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
-- 2026-07-15 Mike audit (NEEDS_FIX, 3 blockers, all addressed in this revision
-- before first merge — no prod data exists yet, so the table is edited in place
-- rather than superseded by a new migration number):
--   1. buy_order_id added — a realized-P&L row must cite its exact source buy
--      order, not just a soft buy_price/buy_fill_time link.
--   2. UNIQUE (sell_order_id, buy_order_id) — idempotency is now enforced at the
--      DB layer via ON CONFLICT DO NOTHING (see recordRealizedPnlForSell()),
--      not solely by the application's check-then-act hasMatchesForSellOrder()
--      pre-check, which cannot defend against a genuine race.
--   3. Both order_id FKs use ON DELETE RESTRICT, not CASCADE — this table is an
--      immutable ledger; a future order-deletion path must not be able to
--      silently erase realized-P&L history by deleting its source order rows.
--      (paper_fills.order_id CASCADEs by design because a fill is *part of* its
--      order; this ledger row is a *derived historical record referencing* two
--      orders, a materially different relationship.)
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
  buy_order_id       UUID           NOT NULL REFERENCES paper_orders(id) ON DELETE RESTRICT,
  sell_order_id      UUID           NOT NULL REFERENCES paper_orders(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  CONSTRAINT paper_realized_pnl_sell_buy_uidx UNIQUE (sell_order_id, buy_order_id)
);

-- Covering index for the main read: "this user's realized trades, newest first,
-- optionally filtered to one symbol".
CREATE INDEX IF NOT EXISTS paper_realized_pnl_user_symbol_idx
  ON paper_realized_pnl (user_id, symbol, sell_fill_time DESC);

-- Mike 🟡: an un-filtered "all of this user's realized trades" list (no symbol
-- filter) cannot use the composite index above for its sort. Cheap to add now.
CREATE INDEX IF NOT EXISTS paper_realized_pnl_user_idx
  ON paper_realized_pnl (user_id, sell_fill_time DESC);

-- buy_order_id lookup (e.g. "which realized trades cite this buy order").
CREATE INDEX IF NOT EXISTS paper_realized_pnl_buy_order_idx
  ON paper_realized_pnl (buy_order_id);
