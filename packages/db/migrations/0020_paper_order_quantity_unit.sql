-- 0020 — W7 P0 Demo: add quantity_unit column to paper_orders
-- Tracks whether an order is board-lot (LOT) or odd-lot (SHARE).
-- Existing rows default to 'LOT' for backward compatibility.
--
-- Taiwan market:
--   LOT  = 1 lot = 1,000 shares (整股 board lot)
--   SHARE = 1–999 shares (零股 odd-lot)
--
-- 2026-05-05 hardening: wrap in DO block so this migration records as applied
-- even when paper_orders table is missing on prod (recovery path: 0021 ensure
-- recreates the table + column on the same deploy).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'paper_orders'
  ) THEN
    ALTER TABLE paper_orders
      ADD COLUMN IF NOT EXISTS quantity_unit TEXT NOT NULL DEFAULT 'LOT'
        CHECK (quantity_unit IN ('SHARE', 'LOT'));
  END IF;
END $$;
