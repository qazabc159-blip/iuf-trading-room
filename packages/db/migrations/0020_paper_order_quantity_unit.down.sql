-- 0020 down — remove quantity_unit from paper_orders
ALTER TABLE paper_orders DROP COLUMN IF EXISTS quantity_unit;
