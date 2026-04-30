-- 0017 — W7 D3: companies_ohlcv table
--
-- Daily OHLCV bars per company.  Source can be 'mock' (deterministic random
-- walk seeded by companyId) | 'kgi' (live feed, future) | 'tej' (TEJ, future).
--
-- Design notes:
--   - Primary query: (companyId, dt) range scan for chart rendering.
--   - UNIQUE (company_id, dt, interval) prevents duplicate bar upsert.
--   - workspaceId carried for multi-tenant safety; always filter by workspace.
--   - volume stored as BIGINT (TWSE shares can exceed INT4 on active days).
--   - open/high/low/close stored as NUMERIC(14,4) matching paper_orders price.
--
-- ADDITIVE ONLY — no existing table modified.

CREATE TABLE IF NOT EXISTS companies_ohlcv (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL,
  workspace_id UUID        NOT NULL,
  dt           DATE        NOT NULL,
  interval     TEXT        NOT NULL DEFAULT '1d' CHECK (interval IN ('1d', '1w', '1m')),
  open         NUMERIC(14,4) NOT NULL,
  high         NUMERIC(14,4) NOT NULL,
  low          NUMERIC(14,4) NOT NULL,
  close        NUMERIC(14,4) NOT NULL,
  volume       BIGINT      NOT NULL DEFAULT 0,
  source       TEXT        NOT NULL DEFAULT 'mock' CHECK (source IN ('mock', 'kgi', 'tej')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS companies_ohlcv_company_dt_interval_uidx
  ON companies_ohlcv (company_id, dt, interval);

CREATE INDEX IF NOT EXISTS companies_ohlcv_workspace_dt_idx
  ON companies_ohlcv (workspace_id, dt DESC);

CREATE INDEX IF NOT EXISTS companies_ohlcv_company_dt_idx
  ON companies_ohlcv (company_id, dt DESC);
