-- 0023 — DRAFT: FinMind 3 Trading-Flow Dataset Cache Tables
--
-- Status: DRAFT — not yet promoted. Mike must audit before promote.
-- Code-side (trading-flow-finmind-sync.ts) checks table existence before any
-- INSERT and emits state=DEGRADED (not throw) when this migration hasn't run.
--
-- Datasets (BLOCK #4 PR B — per Athena spec §1 datasets 6/7/8):
--   6. tw_institutional_buysell   — TaiwanStockInstitutionalInvestorsBuySell (三大法人)
--   7. tw_margin_short            — TaiwanStockMarginPurchaseShortSale (融資券餘額)
--   8. tw_shareholding            — TaiwanStockShareholding (集保戶數分佈)
--
-- Upsert keys (per Athena spec §1):
--   tw_institutional_buysell: (stock_id, date, name)
--   tw_margin_short:          (stock_id, date)
--   tw_shareholding:          (stock_id, date)
--
-- Source trail columns (§3.3):
--   fetched_at TIMESTAMPTZ NOT NULL — wall-clock at ingest
--   source TEXT NOT NULL DEFAULT 'finmind' — provenance
--   source_version TEXT — nullable; FinMind API version when surfaced
--
-- Quarantine bins (§3.5): _quarantine_<table> for QA-failed rows.
-- All statements idempotent (IF NOT EXISTS). Safe to re-run.

-- 6. tw_institutional_buysell
CREATE TABLE IF NOT EXISTS tw_institutional_buysell (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT        NOT NULL,
  date            TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  buy             NUMERIC     NOT NULL DEFAULT 0,
  sell            NUMERIC     NOT NULL DEFAULT 0,
  fetched_at      TIMESTAMPTZ NOT NULL,
  source          TEXT        NOT NULL DEFAULT 'finmind',
  source_version  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tw_institutional_buysell_stock_date_name_uidx
  ON tw_institutional_buysell (stock_id, date, name);
CREATE INDEX IF NOT EXISTS tw_institutional_buysell_stock_date_idx
  ON tw_institutional_buysell (stock_id, date DESC);
CREATE TABLE IF NOT EXISTS _quarantine_tw_institutional_buysell (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. tw_margin_short
CREATE TABLE IF NOT EXISTS tw_margin_short (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id                          TEXT        NOT NULL,
  date                              TEXT        NOT NULL,
  margin_purchase_buy               NUMERIC     NOT NULL DEFAULT 0,
  margin_purchase_sell              NUMERIC     NOT NULL DEFAULT 0,
  margin_purchase_cash_repayment    NUMERIC     NOT NULL DEFAULT 0,
  margin_purchase_limit             NUMERIC,
  margin_purchase_yesterday         NUMERIC,
  margin_purchase_today             NUMERIC,
  margin_purchase_yesterday_balance NUMERIC,
  margin_purchase_today_balance     NUMERIC,
  short_sale_buy                    NUMERIC     NOT NULL DEFAULT 0,
  short_sale_sell                   NUMERIC     NOT NULL DEFAULT 0,
  short_sale_limit                  NUMERIC,
  short_sale_yesterday              NUMERIC,
  short_sale_today                  NUMERIC,
  short_sale_yesterday_balance      NUMERIC,
  short_sale_today_balance          NUMERIC,
  fetched_at                        TIMESTAMPTZ NOT NULL,
  source                            TEXT        NOT NULL DEFAULT 'finmind',
  source_version                    TEXT,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tw_margin_short_stock_date_uidx
  ON tw_margin_short (stock_id, date);
CREATE INDEX IF NOT EXISTS tw_margin_short_stock_date_idx
  ON tw_margin_short (stock_id, date DESC);
CREATE TABLE IF NOT EXISTS _quarantine_tw_margin_short (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. tw_shareholding
CREATE TABLE IF NOT EXISTS tw_shareholding (
  id                                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id                             TEXT        NOT NULL,
  date                                 TEXT        NOT NULL,
  stock_name                           TEXT,
  international_code                   TEXT,
  foreign_investment_remaining_shares  NUMERIC,
  foreign_investment_shares            NUMERIC,
  foreign_investment_remain_ratio      NUMERIC,
  foreign_investment_shares_ratio      NUMERIC,
  foreign_investment_upper_limit_ratio NUMERIC,
  chinese_investment_upper_limit_ratio NUMERIC,
  number_of_shares_issued              NUMERIC,
  recently_declare_date                TEXT,
  note                                 TEXT,
  fetched_at                           TIMESTAMPTZ NOT NULL,
  source                               TEXT        NOT NULL DEFAULT 'finmind',
  source_version                       TEXT,
  created_at                           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tw_shareholding_stock_date_uidx
  ON tw_shareholding (stock_id, date);
CREATE INDEX IF NOT EXISTS tw_shareholding_stock_date_idx
  ON tw_shareholding (stock_id, date DESC);
CREATE TABLE IF NOT EXISTS _quarantine_tw_shareholding (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
