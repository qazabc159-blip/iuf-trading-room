-- 0024 — DRAFT: FinMind 4 Market-Intel Dataset Cache Tables
--
-- Status: DRAFT — not yet promoted. Mike must audit before promote.
-- Code-side (market-intel-finmind-sync.ts) checks table existence before any
-- INSERT and emits state=DEGRADED (not throw) when this migration hasn't run.
--
-- Datasets (BLOCK #4 PR C — per Athena spec §1 datasets 5/9/10/11 + valuation):
--   5.  tw_dividend          — TaiwanStockDividend (股利政策)
--   9.  tw_market_value      — TaiwanStockMarketValue (市值/股本)
--   10. tw_valuation         — TaiwanStockPER (本益比/股價淨值比)
--   11. tw_stock_news        — TaiwanStockNews (個股新聞) [experimental]
--
-- Upsert keys (per Athena spec §1):
--   tw_dividend:     (stock_id, year, dividend_type)
--   tw_market_value: (stock_id, date)
--   tw_valuation:    (stock_id, date)
--   tw_stock_news:   sha256(title + url + published_at) — stored as content_hash TEXT column
--
-- Source trail columns (§3.3):
--   fetched_at TIMESTAMPTZ NOT NULL — wall-clock at ingest
--   source TEXT NOT NULL DEFAULT 'finmind' — provenance
--   source_version TEXT — nullable; FinMind API version when surfaced
--
-- Quarantine bins (§3.5): _quarantine_<table> for QA-failed rows.
-- All statements idempotent (IF NOT EXISTS). Safe to re-run.
-- tw_stock_news marked EXPERIMENTAL — may degrade to state=DEGRADED if FinMind
-- news endpoint is unstable or authorization is restricted.

-- ── 5. tw_dividend ────────────────────────────────────────────────────────────
-- Upsert key: (stock_id, year, dividend_type)
-- dividend_type: 'stock' | 'cash' (derived from data shape)

CREATE TABLE IF NOT EXISTS tw_dividend (
  id                                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id                          TEXT        NOT NULL,
  year                              INTEGER     NOT NULL,
  dividend_type                     TEXT        NOT NULL,     -- 'stock' | 'cash'
  announcement_date                 TEXT,                     -- YYYY-MM-DD from API date field
  stock_earnings_distribution       NUMERIC     NOT NULL DEFAULT 0,
  stock_statutory_reserve_transfer  NUMERIC     NOT NULL DEFAULT 0,
  stock_capital_reserve_transfer    NUMERIC     NOT NULL DEFAULT 0,
  stock_reward                      NUMERIC     NOT NULL DEFAULT 0,
  total_stock_dividend              NUMERIC     NOT NULL DEFAULT 0,
  cash_earnings_distribution        NUMERIC     NOT NULL DEFAULT 0,
  cash_statutory_reserve_transfer   NUMERIC     NOT NULL DEFAULT 0,
  cash_capital_reserve_transfer     NUMERIC     NOT NULL DEFAULT 0,
  cash_reward                       NUMERIC     NOT NULL DEFAULT 0,
  total_cash_dividend               NUMERIC     NOT NULL DEFAULT 0,
  total_dividend                    NUMERIC     NOT NULL DEFAULT 0,
  fetched_at                        TIMESTAMPTZ NOT NULL,
  source                            TEXT        NOT NULL DEFAULT 'finmind',
  source_version                    TEXT,
  created_at                        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_dividend_stock_year_type_uidx
  ON tw_dividend (stock_id, year, dividend_type);

CREATE INDEX IF NOT EXISTS tw_dividend_stock_id_idx
  ON tw_dividend (stock_id, year DESC);

CREATE TABLE IF NOT EXISTS _quarantine_tw_dividend (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT,
  reason_code    TEXT        NOT NULL,
  raw_json       TEXT        NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. tw_market_value ────────────────────────────────────────────────────────
-- Upsert key: (stock_id, date)
-- Tracks daily closing market capitalization.

CREATE TABLE IF NOT EXISTS tw_market_value (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT        NOT NULL,
  date           TEXT        NOT NULL,    -- YYYY-MM-DD
  market_value   NUMERIC     NOT NULL,    -- TWD thousands
  fetched_at     TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'finmind',
  source_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_market_value_stock_date_uidx
  ON tw_market_value (stock_id, date);

CREATE INDEX IF NOT EXISTS tw_market_value_stock_date_idx
  ON tw_market_value (stock_id, date DESC);

CREATE TABLE IF NOT EXISTS _quarantine_tw_market_value (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT,
  reason_code    TEXT        NOT NULL,
  raw_json       TEXT        NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 10. tw_valuation ──────────────────────────────────────────────────────────
-- Upsert key: (stock_id, date)
-- Tracks daily PER / PBR / dividend_yield.

CREATE TABLE IF NOT EXISTS tw_valuation (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT        NOT NULL,
  date           TEXT        NOT NULL,    -- YYYY-MM-DD
  dividend_yield NUMERIC,                 -- %
  per            NUMERIC,                 -- Price-to-Earnings ratio
  pbr            NUMERIC,                 -- Price-to-Book ratio
  fetched_at     TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'finmind',
  source_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_valuation_stock_date_uidx
  ON tw_valuation (stock_id, date);

CREATE INDEX IF NOT EXISTS tw_valuation_stock_date_idx
  ON tw_valuation (stock_id, date DESC);

CREATE TABLE IF NOT EXISTS _quarantine_tw_valuation (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT,
  reason_code    TEXT        NOT NULL,
  raw_json       TEXT        NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 11. tw_stock_news [EXPERIMENTAL] ─────────────────────────────────────────
-- Upsert key: content_hash = sha256(title + url + published_at)
-- content_hash stored as hex TEXT for DB-portable deduplication.
-- EXPERIMENTAL: FinMind news availability depends on sponsor tier authorization.
-- If endpoint returns empty/403 consistently, code emits state=DEGRADED.

CREATE TABLE IF NOT EXISTS tw_stock_news (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT        NOT NULL,
  content_hash   TEXT        NOT NULL,    -- sha256(title + url + published_at) hex
  title          TEXT        NOT NULL,
  url            TEXT,
  published_at   TEXT,                    -- ISO string or YYYY-MM-DD from API
  source_name    TEXT,                    -- news outlet name when available
  fetched_at     TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL DEFAULT 'finmind',
  source_version TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tw_stock_news_content_hash_uidx
  ON tw_stock_news (content_hash);

CREATE INDEX IF NOT EXISTS tw_stock_news_stock_id_idx
  ON tw_stock_news (stock_id, published_at DESC);

CREATE INDEX IF NOT EXISTS tw_stock_news_fetched_idx
  ON tw_stock_news (fetched_at DESC);

CREATE TABLE IF NOT EXISTS _quarantine_tw_stock_news (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id       TEXT,
  reason_code    TEXT        NOT NULL,
  raw_json       TEXT        NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
