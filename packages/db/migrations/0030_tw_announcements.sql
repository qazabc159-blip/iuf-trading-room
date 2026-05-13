-- 0030 — tw_announcements: TWSE/MOPS official announcement cache table
--
-- Status: DRAFT — requires Mike audit before promoting to prod.
--
-- Purpose: Cache official TWSE/MOPS material disclosures (重大訊息).
--   Primary source: TWSE OpenAPI or MOPS scrape (future ingest job)
--   UI consumers:
--     - GET /api/v1/companies/:id/announcements (market-intel panel)
--     - GET /api/v1/market-intel/announcements (market-wide feed)
--     - GET /api/v1/announcements (global feed)
--     - dashboard news_recent panel (dashboard-snapshot-aggregator.ts)
--
-- Upsert key: (ticker_symbol, announced_at, title_hash)
--   title_hash = SHA-256(title) stored as hex TEXT — guards against long-title dups
--
-- All statements idempotent (IF NOT EXISTS / IF NOT EXISTS index). Safe to re-run.

CREATE TABLE IF NOT EXISTS tw_announcements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ticker may be NULL for market-wide announcements (e.g. TWSE system notices)
  ticker_symbol   TEXT,
  -- Official announcement timestamp from TWSE/MOPS
  announced_at    TIMESTAMPTZ NOT NULL,
  title           TEXT        NOT NULL,
  content         TEXT,                   -- full announcement body (may be NULL when not scraped)
  title_hash      TEXT        NOT NULL,   -- SHA-256(title) hex — dedup key
  source          TEXT        NOT NULL DEFAULT 'twse',   -- 'twse' | 'mops' | 'finmind'
  source_url      TEXT,                   -- original source URL (optional)
  fetched_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upsert dedup: (ticker_symbol, announced_at, title_hash)
-- NULL ticker_symbol uses IS NOT DISTINCT FROM semantics (NULLIF trick not needed with unique index).
-- Use COALESCE(ticker_symbol, '') for NULLable column in unique index.
CREATE UNIQUE INDEX IF NOT EXISTS tw_announcements_dedup_uidx
  ON tw_announcements (COALESCE(ticker_symbol, ''), announced_at, title_hash);

-- Primary lookup: by ticker + date range descending
CREATE INDEX IF NOT EXISTS tw_announcements_ticker_at_idx
  ON tw_announcements (ticker_symbol, announced_at DESC);

-- Market-wide feed: by date descending regardless of ticker
CREATE INDEX IF NOT EXISTS tw_announcements_at_idx
  ON tw_announcements (announced_at DESC);
