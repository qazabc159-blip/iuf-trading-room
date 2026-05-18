-- migration: 0041_ai_recommendations_v2
-- purpose: AI Recommendations v2 — pure-AI independent judgment (no Athena fixture dependency)
-- scope: additive-only (1 new table + 5 new tool registry rows). No existing tables modified.
-- Yang 5/18 mandate: Brain ReAct loop sees full market data and independently recommends stocks.
-- Phase A: Owner-only endpoint. Manual refresh + 09:30/13:00 TST cron.
-- AGPL compliance: all SQL is IUF-original.
-- down migration: 0041_ai_recommendations_v2.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are required -- checked
--   W1: workspace_id FK ON DELETE RESTRICT (keep audit trail)
--   W2: run_id UNIQUE -- prevents duplicate async runs per cron window
--   W3: status CHECK enum -- running/complete/failed/budget_exceeded
--   W4: cost_usd NUMERIC(10,8) with CHECK >= 0 -- checked
--   W5: items JSONB array of StockRecommendation -- no partial fill concept N/A
--   W6: react_trace JSONB array of ReAct steps -- same shape as brain_decisions.react_trace
--   N1: 5 tool seed rows inserted into existing tools table (INSERT ON CONFLICT DO NOTHING)

-- ============================================================
-- Quarantine check: brain_decisions must exist (0040 must run first)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'brain_decisions') THEN
    RAISE EXCEPTION 'Quarantine FAIL: brain_decisions table does not exist. Run migration 0040 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tools') THEN
    RAISE EXCEPTION 'Quarantine FAIL: tools table does not exist. Run migration 0038 first.';
  END IF;
END;
$$;

-- ============================================================
-- Table: ai_recommendations_runs
-- One row per Brain ReAct AI recommendation generation run.
-- items: JSONB array of StockRecommendation (same schema as /api/v1/recommendations/today)
-- react_trace: JSONB array of ReAct steps (same shape as brain_decisions.react_trace)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_recommendations_runs (
  id                   UUID          NOT NULL DEFAULT gen_random_uuid(),
  -- workspace_id: NULL = system-level Owner-triggered run
  workspace_id         UUID          NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- run_id: unique string for idempotency (UUID as text, server-generated)
  run_id               TEXT          NOT NULL,
  -- generated_at: TST timestamp when this run was fired
  generated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- model: LLM model key used for this run
  model                TEXT          NOT NULL DEFAULT 'gpt-4o-mini',
  -- status: running | complete | failed | budget_exceeded
  status               TEXT          NOT NULL DEFAULT 'running',
  -- items: array of StockRecommendation objects
  --   [{id, ticker, companyName, action, confidence, entryPriceRange, tp1, tp2, stopLoss, rationale, ...}]
  items                JSONB         NOT NULL DEFAULT '[]',
  -- react_trace: ordered array of ReAct steps from the Brain loop
  react_trace          JSONB         NOT NULL DEFAULT '[]',
  -- final_report_markdown: raw markdown from Brain synthesis step
  final_report_markdown TEXT         NULL,
  -- cost_usd: total LLM cost in USD for this run
  cost_usd             NUMERIC(10,8) NOT NULL DEFAULT 0,
  -- total_tokens: sum of all LLM tokens used
  total_tokens         INTEGER       NOT NULL DEFAULT 0,
  -- trigger: how this run was initiated (cron_0930 | cron_1300 | manual_refresh | test)
  trigger              TEXT          NOT NULL DEFAULT 'manual_refresh',
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMPTZ   NULL,
  CONSTRAINT ai_rec_runs_pkey PRIMARY KEY (id),
  CONSTRAINT ai_rec_runs_run_id_unique UNIQUE (run_id),
  CONSTRAINT ai_rec_runs_cost_check CHECK (cost_usd >= 0),
  CONSTRAINT ai_rec_runs_tokens_check CHECK (total_tokens >= 0),
  CONSTRAINT ai_rec_runs_status_check CHECK (status IN ('running', 'complete', 'failed', 'budget_exceeded')),
  CONSTRAINT ai_rec_runs_trigger_check CHECK (trigger IN ('cron_0930', 'cron_1300', 'manual_refresh', 'test'))
);

-- Index for time-range queries (latest run lookup)
CREATE INDEX IF NOT EXISTS ai_rec_runs_generated_at_idx
  ON ai_recommendations_runs (generated_at DESC);

-- Index for workspace + status queries
CREATE INDEX IF NOT EXISTS ai_rec_runs_workspace_status_idx
  ON ai_recommendations_runs (workspace_id, status, generated_at DESC);

-- ============================================================
-- Seed 5 new read-only market tools into existing tools table.
-- These tools are called by Brain ReAct AI recommendation loop.
-- ON CONFLICT DO NOTHING — safe to re-run.
-- ============================================================
INSERT INTO tools (id, tool_key, display_name, description, tool_type, is_active, version, schema_input, schema_output, created_at, updated_at)
VALUES
  (
    gen_random_uuid(),
    'get_market_overview',
    '大盤總覽',
    'Fetches TWSE market overview: TAIEX index, OTC index, volume, advance/decline ratio.',
    'data_sync',
    true,
    '1.0.0',
    '{"type":"object","properties":{},"additionalProperties":false}',
    '{"type":"object","properties":{"taiex":{"type":"object"},"source":{"type":"string"}}}',
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'get_sector_rotation',
    '類股輪動強度',
    'Calculates 24h sector relative strength from institutional flow + OHLCV data.',
    'data_sync',
    true,
    '1.0.0',
    '{"type":"object","properties":{"limit":{"type":"integer","default":20}},"additionalProperties":false}',
    '{"type":"object","properties":{"sectors":{"type":"array"}}}',
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'get_company_technical',
    '個股技術面',
    'Returns K-line, RSI, MA200/60/20, volume characteristics for a given ticker.',
    'data_sync',
    true,
    '1.0.0',
    '{"type":"object","properties":{"ticker":{"type":"string"}},"required":["ticker"],"additionalProperties":false}',
    '{"type":"object","properties":{"ticker":{"type":"string"},"rsi":{"type":"number"},"ma20":{"type":"number"}}}',
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'get_institutional_flow',
    '三大法人籌碼',
    'Returns institutional buy/sell net flow for a given ticker (last 30 days).',
    'data_sync',
    true,
    '1.0.0',
    '{"type":"object","properties":{"ticker":{"type":"string"}},"required":["ticker"],"additionalProperties":false}',
    '{"type":"object","properties":{"ticker":{"type":"string"},"netBuy30d":{"type":"number"}}}',
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'get_news_top10',
    '今日熱點新聞',
    'Returns today top-10 AI-curated news items with sentiment from news-ai-selector.',
    'data_sync',
    true,
    '1.0.0',
    '{"type":"object","properties":{},"additionalProperties":false}',
    '{"type":"object","properties":{"items":{"type":"array"},"asOf":{"type":"string"}}}',
    NOW(),
    NOW()
  )
ON CONFLICT (tool_key) DO NOTHING;
