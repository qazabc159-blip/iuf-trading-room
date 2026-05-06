-- 0022 — DRAFT: FinMind 4 Fundamental Dataset Cache Tables
--
-- Status: DRAFT — not yet promoted. Mike must audit before promote.
-- Code-side (fundamentals-finmind-sync.ts) checks table existence before any
-- INSERT and emits state=DEGRADED (not throw) when this migration hasn't run.
--
-- Datasets:
--   1. tw_monthly_revenue       — TaiwanStockMonthRevenue (月營收)
--   2. tw_financial_statements  — TaiwanStockFinancialStatements (損益表)
--   3. tw_balance_sheet         — TaiwanStockBalanceSheet (資產負債表)
--   4. tw_cashflow_statement    — TaiwanStockCashFlowsStatement (現金流量表)
--
-- Upsert keys (per Athena spec §1):
--   tw_monthly_revenue:      (stock_id, revenue_year_month)
--   tw_financial_statements: (stock_id, period_end, item_name)
--   tw_balance_sheet:        (stock_id, period_end, item_name)
--   tw_cashflow_statement:   (stock_id, period_end, item_name)
--
-- Source trail columns (§3.3):
--   fetched_at TIMESTAMPTZ NOT NULL — wall-clock at ingest
--   source TEXT NOT NULL DEFAULT 'finmind' — provenance
--   source_version TEXT — nullable; FinMind API version when surfaced
--
-- Quarantine bins (§3.5): _quarantine_<table> for QA-failed rows.
-- All statements idempotent (IF NOT EXISTS). Safe to re-run.

-- ── 1. tw_monthly_revenue ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tw_monthly_revenue (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id            TEXT        NOT NULL,
  revenue_year_month  TEXT        NOT NULL,      -- 'YYYY-MM'
  revenue_date        TEXT        NOT NULL,      -- 'YYYY-MM-DD' (month start from API)
  revenue             NUMERIC     NOT NULL,
  revenue_month       INTEGER,
  revenue_year        INTEGER,
  country             TEXT        NOT NULL DEFAULT 'TW',
  fetched_at          TIMESTAMPTZ NOT NULL,
  source              TEXT        NOT NULL DEFAULT 'finmind',
  source_version      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_monthly_revenue_stock_month_uidx
  ON tw_monthly_revenue (stock_id, revenue_year_month);

CREATE INDEX IF NOT EXISTS tw_monthly_revenue_stock_id_idx
  ON tw_monthly_revenue (stock_id, revenue_date DESC);

-- Quarantine bin for tw_monthly_revenue
CREATE TABLE IF NOT EXISTS _quarantine_tw_monthly_revenue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. tw_financial_statements ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tw_financial_statements (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT        NOT NULL,
  period_end     TEXT        NOT NULL,   -- 'YYYY-MM-DD' (quarter end date)
  item_name      TEXT        NOT NULL,   -- FSC item type (e.g. 'Revenue', 'GrossProfit')
  value          NUMERIC     NOT NULL,
  origin_name    TEXT,                   -- original Chinese label from FinMind
  fetched_at     TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'finmind',
  source_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_financial_statements_stock_period_item_uidx
  ON tw_financial_statements (stock_id, period_end, item_name);

CREATE INDEX IF NOT EXISTS tw_financial_statements_stock_id_idx
  ON tw_financial_statements (stock_id, period_end DESC);

-- Quarantine bin
CREATE TABLE IF NOT EXISTS _quarantine_tw_financial_statements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. tw_balance_sheet ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tw_balance_sheet (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT        NOT NULL,
  period_end     TEXT        NOT NULL,
  item_name      TEXT        NOT NULL,
  value          NUMERIC     NOT NULL,
  origin_name    TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'finmind',
  source_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_balance_sheet_stock_period_item_uidx
  ON tw_balance_sheet (stock_id, period_end, item_name);

CREATE INDEX IF NOT EXISTS tw_balance_sheet_stock_id_idx
  ON tw_balance_sheet (stock_id, period_end DESC);

-- Quarantine bin
CREATE TABLE IF NOT EXISTS _quarantine_tw_balance_sheet (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. tw_cashflow_statement ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tw_cashflow_statement (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT        NOT NULL,
  period_end     TEXT        NOT NULL,
  item_name      TEXT        NOT NULL,
  value          NUMERIC     NOT NULL,
  origin_name    TEXT,
  fetched_at     TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'finmind',
  source_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_cashflow_statement_stock_period_item_uidx
  ON tw_cashflow_statement (stock_id, period_end, item_name);

CREATE INDEX IF NOT EXISTS tw_cashflow_statement_stock_id_idx
  ON tw_cashflow_statement (stock_id, period_end DESC);

-- Quarantine bin
CREATE TABLE IF NOT EXISTS _quarantine_tw_cashflow_statement (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        TEXT,
  reason_code     TEXT        NOT NULL,
  raw_json        TEXT        NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
