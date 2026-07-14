-- Migration: 0056_quote_last_close_ohlcv_fallback_source
-- Purpose: allow quote_last_close.source = 'ohlcv_fallback' — a new, honestly-
-- labeled last-resort mark-to-market tier reading companies_ohlcv (vendor
-- OHLCV, e.g. FinMind TaiwanStockPriceAdj — labeled "tej" in that table's own
-- source column) for symbols that TWSE's own STOCK_DAY_ALL / rwd afterTrading
-- daily-quote reports and the MIS post-session snapshot never publish at all
-- (verified 2026-07-14 for symbol 2071 / 震南鐵: absent from both official
-- endpoints via direct curl — not a parser/filter bug on our side, likely a
-- disposition/restricted-trading category excluded from the standard
-- board-lot daily report). See reports/epic_fauto_ledger_20260701/ for the
-- incident this fixes.
--
-- ADDITIVE ONLY — widens an existing CHECK constraint's allowed value set.
-- No existing rows touched, no column added/removed.

ALTER TABLE quote_last_close
  DROP CONSTRAINT quote_last_close_source_check;

ALTER TABLE quote_last_close
  ADD CONSTRAINT quote_last_close_source_check
  CHECK (source IN ('twse_eod', 'tpex_eod', 'mis_close', 'ohlcv_fallback'));
