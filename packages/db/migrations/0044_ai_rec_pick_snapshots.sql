-- migration: 0044_ai_rec_pick_snapshots
-- purpose: forward-performance tracking table for AI pick snapshots
-- scope: new table ai_rec_pick_snapshots; additive-only (no existing tables modified)
-- Yang 2026-06-05: prove whether AI-picked stocks make money.
--   Records each daily AI pick with entry price, targets, and subsequently updates
--   ret_1d/5d/20d and excess returns vs TAIEX.
-- down migration: 0044_ai_rec_pick_snapshots.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are set at insert time -- checked
--   B2: JSONB columns: none in this table -- N/A
--   W1: additive-only new table -- no data loss on forward
--   W2: idempotent via IF NOT EXISTS on TABLE and INDEX
--   W3: down migration is clean DROP TABLE -- safe
--   W4: UNIQUE (pick_date, ticker) enforces idempotency of daily snapshot
--   W5: ret_1d/5d/20d and excess_* are nullable -- forward fill logic is async, fail-open

-- ============================================================
-- Quarantine check: ai_recommendations_runs must exist (0041 must run first)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ai_recommendations_runs'
  ) THEN
    RAISE EXCEPTION 'Quarantine FAIL: ai_recommendations_runs table does not exist. Run migration 0041 first.';
  END IF;
END;
$$;

-- ============================================================
-- Table: ai_rec_pick_snapshots
-- One row per (pick_date, ticker) — daily AI pick with entry context and forward returns.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_rec_pick_snapshots (
  id              UUID            NOT NULL DEFAULT gen_random_uuid(),
  -- pick_date: the TST calendar date this pick was generated (YYYY-MM-DD)
  pick_date       DATE            NOT NULL,
  -- ticker: 4-digit TWSE ticker (e.g. "2330")
  ticker          TEXT            NOT NULL,
  -- bucket: A+ / A / B / C per Yang SOP scoring
  bucket          TEXT            NOT NULL,
  -- action: v3 action string (e.g. "今日首選")
  action          TEXT            NOT NULL,
  -- confidence: LLM confidence score [0,1]
  confidence      REAL            NULL,
  -- total_score: Yang SOP 7-axis composite score [0,100]
  total_score     REAL            NULL,
  -- pick_price: closing price at time of pick (from companies_ohlcv)
  pick_price      NUMERIC(12,2)   NULL,
  -- entry zone from v3 STEP 5
  entry_low       NUMERIC(12,2)   NULL,
  entry_high      NUMERIC(12,2)   NULL,
  -- profit targets and stop from v3 STEP 5
  tp1             NUMERIC(12,2)   NULL,
  tp2             NUMERIC(12,2)   NULL,
  stop_loss       NUMERIC(12,2)   NULL,
  -- run_id: links back to ai_recommendations_runs.run_id for full trace
  run_id          TEXT            NOT NULL,
  -- Forward return columns (updated by daily cron after market close)
  -- ret_Nd = (price_at_+Nd_close - pick_price) / pick_price
  ret_1d          REAL            NULL,
  ret_5d          REAL            NULL,
  ret_20d         REAL            NULL,
  -- Excess returns vs TAIEX benchmark (ret_Nd - taiex_ret_Nd for same period)
  excess_1d       REAL            NULL,
  excess_5d       REAL            NULL,
  excess_20d      REAL            NULL,
  -- Timestamp of last forward-return update (NULL = not yet computed)
  ret_updated_at  TIMESTAMPTZ     NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_rec_pick_snaps_pkey PRIMARY KEY (id),
  -- Idempotency: one snapshot row per (date, ticker) — upsert on conflict
  CONSTRAINT ai_rec_pick_snaps_date_ticker_uq UNIQUE (pick_date, ticker),
  -- Validate bucket enum
  CONSTRAINT ai_rec_pick_snaps_bucket_chk CHECK (bucket IN ('A+', 'A', 'B', 'C')),
  -- pick_price non-negative when present
  CONSTRAINT ai_rec_pick_snaps_pick_price_chk CHECK (pick_price IS NULL OR pick_price >= 0)
);

-- ============================================================
-- Indexes
-- ============================================================

-- Primary lookup: by pick_date DESC (performance dashboard queries latest N days)
CREATE INDEX IF NOT EXISTS ai_rec_pick_snaps_pick_date_idx
  ON ai_rec_pick_snapshots (pick_date DESC);

-- Bucket filter (hit-rate by bucket queries)
CREATE INDEX IF NOT EXISTS ai_rec_pick_snaps_bucket_idx
  ON ai_rec_pick_snapshots (bucket, pick_date DESC);

-- Forward return update cron: find rows where ret_updated_at IS NULL or stale
CREATE INDEX IF NOT EXISTS ai_rec_pick_snaps_ret_updated_idx
  ON ai_rec_pick_snapshots (ret_updated_at NULLS FIRST, pick_date DESC);
