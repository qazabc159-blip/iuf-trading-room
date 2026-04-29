-- 0015 — W6 Paper Trading Sprint: paper_orders / paper_fills / paper_positions
-- Standalone ledger for the paper execution path.
-- Completely independent of KGI broker tables and the /order/create gateway.
-- idempotency_key UNIQUE prevents duplicate submissions.
-- user_id indexed for future portfolio / P&L queries.

CREATE TABLE IF NOT EXISTS paper_orders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  TEXT        NOT NULL,
  symbol           TEXT        NOT NULL,
  side             TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type       TEXT        NOT NULL CHECK (order_type IN ('market', 'limit', 'stop', 'stop_limit')),
  qty              INTEGER     NOT NULL CHECK (qty > 0),
  price            NUMERIC(14, 4),
  status           TEXT        NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING', 'ACCEPTED', 'FILLED', 'REJECTED', 'CANCELLED')),
  reason           TEXT,
  user_id          UUID        NOT NULL,
  intent_id        UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_idempotency_key_idx
  ON paper_orders (idempotency_key);

CREATE INDEX IF NOT EXISTS paper_orders_user_id_idx
  ON paper_orders (user_id);

CREATE INDEX IF NOT EXISTS paper_orders_symbol_idx
  ON paper_orders (symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_fills (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID        NOT NULL REFERENCES paper_orders(id) ON DELETE CASCADE,
  fill_qty      INTEGER     NOT NULL CHECK (fill_qty > 0),
  fill_price    NUMERIC(14, 4) NOT NULL,
  fill_time     TIMESTAMPTZ NOT NULL,
  simulated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paper_fills_order_id_idx
  ON paper_fills (order_id);

CREATE TABLE IF NOT EXISTS paper_positions (
  user_id      UUID        NOT NULL,
  symbol       TEXT        NOT NULL,
  qty          INTEGER     NOT NULL DEFAULT 0,
  avg_cost     NUMERIC(14, 4),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS paper_positions_user_id_idx
  ON paper_positions (user_id);
