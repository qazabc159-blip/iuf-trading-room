-- 0049 — F-AUTO SIM Continuous Ledger
--
-- Converts F-AUTO from "weekly paper reset" to a continuous compounding
-- equity account that tracks realized PnL across rebalance cycles.
--
-- Background (2026-07-01 楊董 ACK):
--   KGI SIM never fills (filled_shares=0); positions are audit-log reconstructions.
--   Five rebalance cycles ran: 6/2, 6/9, 6/16, 6/23, 6/30.
--   Each week: assumed-fill at Tuesday close → hold 5 days → exit at next Tuesday close.
--   This schema persists the continuous ledger so NAV survives deploy restarts.
--
-- Tables:
--   sim_ledger_weeks   — one row per rebalance cycle (realized PnL + equity)
--   sim_ledger_nav     — daily NAV curve points
--   sim_ledger_holdings — per-position cost basis + exit detail
--
-- Hard lines:
--   SIM-only: no real-money writes ever touch this table.
--   Idempotent upserts — safe to re-run backfill multiple times.
--   source CHECK ensures only known data origins are stored.
--
-- ADDITIVE ONLY — no existing table modified.

-- ── sim_ledger_weeks ──────────────────────────────────────────────────────────
-- One row per rebalance cycle. Equity carries forward across rows.

CREATE TABLE IF NOT EXISTS sim_ledger_weeks (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  week_num        INTEGER       NOT NULL CHECK (week_num >= 1),
  basket_date     DATE          NOT NULL,        -- Tuesday of this cycle
  initial_equity  NUMERIC(16,2) NOT NULL CHECK (initial_equity > 0),
  basket_cost_twd NUMERIC(16,2) NOT NULL CHECK (basket_cost_twd >= 0),
  cash_residual_twd NUMERIC(16,2) NOT NULL,      -- equity - basket_cost
  realized_pnl_twd  NUMERIC(16,2),               -- NULL for week 1 (first entry)
  equity_after_twd  NUMERIC(16,2) NOT NULL,      -- equity at start of this week
  source          TEXT          NOT NULL
                    CHECK (source IN ('backfill_dry_run', 'live')),
  notes           JSONB         NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (basket_date, source)
);

CREATE INDEX IF NOT EXISTS sim_ledger_weeks_basket_date_idx
  ON sim_ledger_weeks (basket_date DESC);

-- ── sim_ledger_holdings ────────────────────────────────────────────────────────
-- One row per symbol per week. Entry price = Tuesday close (assumed fill).
-- Exit price = next Tuesday close (or NULL if still open).

CREATE TABLE IF NOT EXISTS sim_ledger_holdings (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  week_num        INTEGER       NOT NULL CHECK (week_num >= 1),
  basket_date     DATE          NOT NULL,
  symbol          TEXT          NOT NULL,
  shares          INTEGER       NOT NULL CHECK (shares > 0),
  entry_price_twd NUMERIC(12,4) NOT NULL CHECK (entry_price_twd > 0),
  exit_price_twd  NUMERIC(12,4),                 -- NULL = still open
  exit_date       DATE,                          -- NULL = still open
  realized_pnl_twd NUMERIC(16,2),               -- NULL = still open
  entry_source    TEXT          NOT NULL DEFAULT 'finmind_close'
                    CHECK (entry_source IN ('finmind_close', 'twse_eod', 'tpex_eod', 'basket_latest_price', 'manual')),
  exit_source     TEXT
                    CHECK (exit_source IN ('finmind_close', 'twse_eod', 'tpex_eod', 'basket_latest_price', 'manual')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (basket_date, symbol)
);

CREATE INDEX IF NOT EXISTS sim_ledger_holdings_week_idx
  ON sim_ledger_holdings (week_num, basket_date);

CREATE INDEX IF NOT EXISTS sim_ledger_holdings_symbol_idx
  ON sim_ledger_holdings (symbol, basket_date DESC);

-- ── sim_ledger_nav ────────────────────────────────────────────────────────────
-- Daily NAV curve. One row per trading day.
-- equity_twd = cash + mark-to-market value of open positions at that day's close.

CREATE TABLE IF NOT EXISTS sim_ledger_nav (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  nav_date        DATE          NOT NULL,
  equity_twd      NUMERIC(16,2) NOT NULL,
  initial_equity  NUMERIC(16,2) NOT NULL,        -- for return calculation
  return_pct      NUMERIC(8,4)  NOT NULL,        -- (equity - initial) / initial * 100
  week_num        INTEGER       NOT NULL,        -- which weekly basket was open
  source          TEXT          NOT NULL
                    CHECK (source IN ('backfill_dry_run', 'live_eod', 'live_intraday')),
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (nav_date, source)
);

CREATE INDEX IF NOT EXISTS sim_ledger_nav_date_idx
  ON sim_ledger_nav (nav_date DESC);
