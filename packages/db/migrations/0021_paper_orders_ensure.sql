-- 0021 — Defensive re-assertion for paper_orders + paper_fills + paper_positions.
--
-- Root cause (2026-05-05 incident):
--   The pg_advisory_lock hang at prior deploys caused migrate.ts to exit before
--   migrations 0015–0020 could run. lock_timeout=15s (0016 patch) freed the lock
--   but the tables were already absent. This migration ensures all three paper
--   tables exist regardless of whether 0015/0020 recorded in schema_migrations.
--
-- All statements are fully idempotent (IF NOT EXISTS / IF NOT EXISTS column).
-- Safe to run on empty or partially-populated tables.

-- ── paper_orders ──────────────────────────────────────────────────────────────

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

-- idempotency_key unique constraint — skip if already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paper_orders_idempotency_key_key'
      AND conrelid = 'paper_orders'::regclass
  ) THEN
    ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_idempotency_key_key UNIQUE (idempotency_key);
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS paper_orders_idempotency_key_idx
  ON paper_orders (idempotency_key);

CREATE INDEX IF NOT EXISTS paper_orders_user_id_idx
  ON paper_orders (user_id);

CREATE INDEX IF NOT EXISTS paper_orders_symbol_idx
  ON paper_orders (symbol, created_at DESC);

-- quantity_unit column (added by 0020 — may or may not exist)
ALTER TABLE paper_orders
  ADD COLUMN IF NOT EXISTS quantity_unit TEXT NOT NULL DEFAULT 'LOT'
    CHECK (quantity_unit IN ('SHARE', 'LOT'));

-- ── paper_fills ───────────────────────────────────────────────────────────────

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

-- ── paper_positions ───────────────────────────────────────────────────────────

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
