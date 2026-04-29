-- 0016 — W7 Market Agent: market_events table
--
-- Append-only ledger for all KGI-origin market events pushed from the
-- Market Agent (Windows gateway) to the Cloud API ingest endpoint.
--
-- Design notes:
--   - Idempotency key = (symbol, type, seq); duplicate replay is rejected by
--     the ingest handler BEFORE hitting the DB (in-memory seq tracking),
--     but the UNIQUE index provides a hard guard.
--   - agent_ts = timestamp emitted by the agent (not server receive time).
--   - received_at = server clock — used for staleness auditing.
--   - data JSONB = raw event payload; type-discriminated by event_type.
--   - hmac_hex stored for audit; secret never written to DB.
--
-- THIS IS ADDITIVE ONLY — no existing table modified.

CREATE TABLE IF NOT EXISTS market_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   TEXT        NOT NULL CHECK (event_type IN ('quote', 'tick', 'bidask', 'kbar')),
  symbol       TEXT        NOT NULL,
  agent_ts     TIMESTAMPTZ NOT NULL,
  seq          BIGINT      NOT NULL CHECK (seq >= 0),
  hmac_hex     TEXT        NOT NULL,
  data         JSONB       NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness guard: same (symbol, event_type, seq) must not be replayed.
CREATE UNIQUE INDEX IF NOT EXISTS market_events_symbol_type_seq_uidx
  ON market_events (symbol, event_type, seq);

-- Primary query pattern: fetch recent events per symbol ordered newest-first.
CREATE INDEX IF NOT EXISTS market_events_symbol_ts_idx
  ON market_events (symbol, agent_ts DESC);

-- Allow efficient full-scan by event_type for diagnostics / ops.
CREATE INDEX IF NOT EXISTS market_events_event_type_idx
  ON market_events (event_type, received_at DESC);
