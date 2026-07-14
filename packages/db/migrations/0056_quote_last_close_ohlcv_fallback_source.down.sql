-- Rollback: 0056_quote_last_close_ohlcv_fallback_source

-- Refuse to collapse the constraint back to the narrower set while rows
-- actually use the value being removed — that would leave existing data
-- silently violating the restored CHECK constraint's intent (rows would
-- still be readable, but any future UPDATE touching them would fail
-- unexpectedly, and the column's own guarantee "only these sources exist"
-- would already be false at the moment of rollback).
DO $$
DECLARE
  ohlcv_fallback_rows BIGINT;
BEGIN
  SELECT COUNT(*) INTO ohlcv_fallback_rows
  FROM quote_last_close
  WHERE source = 'ohlcv_fallback';

  IF ohlcv_fallback_rows > 0 THEN
    RAISE EXCEPTION
      '0056 down refused: quote_last_close contains % row(s) with source=ohlcv_fallback',
      ohlcv_fallback_rows;
  END IF;
END $$;

ALTER TABLE quote_last_close
  DROP CONSTRAINT quote_last_close_source_check;

ALTER TABLE quote_last_close
  ADD CONSTRAINT quote_last_close_source_check
  CHECK (source IN ('twse_eod', 'tpex_eod', 'mis_close'));
