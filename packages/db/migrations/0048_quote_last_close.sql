-- 0048 — last-good EOD closing price persistence for mark-to-market fallback
--
-- Stores the most-recently confirmed closing price per symbol per trading day,
-- sourced from TWSE STOCK_DAY_ALL, TPEX mainboard, or post-session MIS.
--
-- Problem solved: after a deploy restart (or 盤後 when data suppliers stop serving),
-- buildS1PositionsSnapshot() had no closing price for F-AUTO holdings — market value
-- appeared null/blank. This table acts as the last-resort fallback tier.
--
-- Design:
--   PRIMARY KEY (symbol, trade_date) — one authoritative row per symbol per day.
--   Upsert: ON CONFLICT (symbol, trade_date) DO UPDATE — idempotent, safe to
--   call multiple times with the same or fresher data.
--   source CHECK: restricts to known EOD-equivalent sources only (not intraday).
--   close_price CHECK: must be positive.
--
-- Write path: buildS1PositionsSnapshot() (TWSE+TPEX official close, MIS close)
--             and server.ts TWSE-EOD-QUOTE-CRON (full TWSE universe, ~1400 stocks).
-- Read path:  getLastCloses() in quote-last-close-store.ts — called as last fallback
--             after TWSE/TPEX/MIS live fetches all miss.
--
-- ADDITIVE ONLY — no existing table modified.

CREATE TABLE IF NOT EXISTS quote_last_close (
  symbol      TEXT           NOT NULL,
  close_price NUMERIC(12, 2) NOT NULL CHECK (close_price > 0),
  trade_date  DATE           NOT NULL,
  source      TEXT           NOT NULL
                CHECK (source IN ('twse_eod', 'tpex_eod', 'mis_close')),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, trade_date)
);

-- Index on trade_date DESC for staleness checks (e.g. "find all rows older than N days")
CREATE INDEX IF NOT EXISTS quote_last_close_trade_date_idx
  ON quote_last_close (trade_date DESC);

-- Covering index for the most common read: lookup by symbol, return latest date
CREATE INDEX IF NOT EXISTS quote_last_close_symbol_date_idx
  ON quote_last_close (symbol, trade_date DESC);
