-- 0057 — index daily-close history persistence (TAIEX line-chart data)
--
-- Problem solved: apps/api/src/data-sources/twse-openapi-client.ts's
-- fetchTaiexMonthDailyCloses() only cached each month's official TAIEX daily
-- closes in an in-memory Map (_taiexHistMonthCache, 30 min TTL). Every deploy
-- restart wipes that cache; if the live TWSE MI_5MINS_HIST fetch that follows
-- transiently fails (rate limit, network hiccup — more likely right after a
-- fresh restart, and 2026-07-14 saw 12 deploys in one day), the response for
-- that request/month has NO fallback at all — the homepage TAIEX line chart
-- (marketContext.index.history) goes empty for that window.
--
-- Design:
--   PRIMARY KEY (index_symbol, trade_date) — one authoritative row per index
--   per day. index_symbol is included (not hardcoded to TAIEX) so this table
--   can cover other indices later without a schema change.
--   Upsert: ON CONFLICT (index_symbol, trade_date) DO UPDATE — idempotent,
--   safe to call on every successful live fetch.
--   close NOT NULL + CHECK > 0 — this table only ever stores a real, valid
--   close (mirrors quote_last_close's close_price CHECK). open/high/low/
--   volume are nullable because TWSE MI_5MINS_HIST (the only current writer)
--   is close-only; a future OHLC-capable writer can populate them.
--
-- Write path: data-sources/twse-openapi-client.ts fetchTaiexMonthDailyCloses()
--             after each successful live TWSE fetch.
-- Read path:  same function, as a fallback when the live fetch fails/is empty
--             for a given month AND the in-memory cache has also expired.
--
-- ADDITIVE ONLY — no existing table modified.

CREATE TABLE IF NOT EXISTS index_history (
  index_symbol TEXT           NOT NULL,
  trade_date   DATE           NOT NULL,
  open         NUMERIC(12, 2),
  high         NUMERIC(12, 2),
  low          NUMERIC(12, 2),
  close        NUMERIC(12, 2) NOT NULL CHECK (close > 0),
  volume       NUMERIC(20, 0),
  source       TEXT           NOT NULL,
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (index_symbol, trade_date)
);

-- Index on trade_date DESC for range reads (e.g. "last 140 days")
CREATE INDEX IF NOT EXISTS index_history_trade_date_idx
  ON index_history (trade_date DESC);

-- Covering index for the common read: lookup by index_symbol, date range
CREATE INDEX IF NOT EXISTS index_history_symbol_date_idx
  ON index_history (index_symbol, trade_date DESC);
