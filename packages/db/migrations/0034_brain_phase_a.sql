-- migration: 0034_brain_phase_a
-- purpose: OpenAlice Brain Phase A — LLM model registry + call ledger + daily cost rollup
-- scope: additive-only (3 new tables). No existing tables modified.
-- Yang 5/17 critical mandate: unified LLM gateway + cost tracking + model registry.
-- AGPL compliance: design-only inspiration from OpenAlice public README/docs. All SQL is IUF-original.
-- down migration: 0034_brain_phase_a.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are required — checked
--   W1: FK ON DELETE RESTRICT (audit-trail tables prevent workspace deletion while calls exist)
--   W2: constraint name aligned with Drizzle: llm_cost_daily_workspace_date_uidx
--   W3: inline comments on non-obvious columns + llm_calls_created_at_idx index added
--   W4: cost_usd NUMERIC(10,8) with CHECK >= 0 — checked
--   N4: no partial-fill concept — N/A

-- ============================================================
-- Table 1: llm_models_registry
-- Registry of available LLM models with pricing config.
-- Seeded with known models; operator can INSERT new rows at runtime.
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_models_registry (
  id                           UUID         NOT NULL DEFAULT gen_random_uuid(),
  -- model_key: canonical model identifier, e.g. "gpt-4o-mini", "gpt-4o", "claude-3-haiku"
  model_key                    TEXT         NOT NULL,
  -- provider: "openai" | "anthropic" | "local"
  provider                     TEXT         NOT NULL,
  display_name                 TEXT         NOT NULL,
  -- input_price_per_1m_tokens: USD cost per 1,000,000 input tokens (estimated)
  input_price_per_1m_tokens    NUMERIC(10,6) NOT NULL DEFAULT 0,
  -- output_price_per_1m_tokens: USD cost per 1,000,000 output tokens (estimated)
  output_price_per_1m_tokens   NUMERIC(10,6) NOT NULL DEFAULT 0,
  max_context_tokens           INTEGER      NOT NULL DEFAULT 128000,
  -- capabilities: JSONB bag, e.g. {"vision": false, "functionCalling": true, "streaming": true}
  capabilities                 JSONB        NOT NULL DEFAULT '{}',
  is_active                    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT llm_models_registry_pkey PRIMARY KEY (id),
  CONSTRAINT llm_models_registry_model_key_unique UNIQUE (model_key),
  CONSTRAINT llm_models_registry_provider_check CHECK (provider IN ('openai', 'anthropic', 'local'))
);

-- ============================================================
-- Table 2: llm_calls
-- Append-only log of every LLM API call routed through llm-gateway.
-- Does NOT store prompt/completion text — only summaries (privacy + cost).
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_calls (
  id                UUID         NOT NULL DEFAULT gen_random_uuid(),
  -- workspace_id: NULL = system-level call (not associated with a specific workspace)
  workspace_id      UUID         NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- model_key: denormalized from registry for query convenience (no JOIN needed for admin queries)
  model_key         TEXT         NOT NULL,
  -- caller_module: e.g. "ai_reviewer", "news_sentiment", "brain", "strategy_ranker"
  caller_module     TEXT         NOT NULL,
  -- task_type: e.g. "review", "summary", "ranking", "reasoning", "sentiment"
  task_type         TEXT         NOT NULL,
  prompt_tokens     INTEGER      NOT NULL DEFAULT 0,
  completion_tokens INTEGER      NOT NULL DEFAULT 0,
  total_tokens      INTEGER      NOT NULL DEFAULT 0,
  -- cost_usd: estimated cost; actual bill may differ due to cached tokens / batch discounts
  cost_usd          NUMERIC(10,8) NOT NULL DEFAULT 0,
  latency_ms        INTEGER      NULL,
  -- status: success | failed | quota_exceeded | budget_exceeded
  status            TEXT         NOT NULL DEFAULT 'success',
  error_code        TEXT         NULL,
  -- input_summary: first 100 chars of prompt (not the full prompt — privacy)
  input_summary     TEXT         NULL,
  -- output_summary: first 100 chars of completion (not the full text — privacy)
  output_summary    TEXT         NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT llm_calls_pkey PRIMARY KEY (id),
  CONSTRAINT llm_calls_cost_usd_check CHECK (cost_usd >= 0),
  CONSTRAINT llm_calls_status_check CHECK (status IN ('success', 'failed', 'quota_exceeded', 'budget_exceeded'))
);

-- Index for admin usage queries: by workspace + date range
CREATE INDEX IF NOT EXISTS llm_calls_workspace_created_idx
  ON llm_calls (workspace_id, created_at DESC);

-- Index for model-level analytics
CREATE INDEX IF NOT EXISTS llm_calls_model_created_idx
  ON llm_calls (model_key, created_at DESC);

-- Index for module-level analytics
CREATE INDEX IF NOT EXISTS llm_calls_caller_created_idx
  ON llm_calls (caller_module, created_at DESC);

-- Index for unfiltered admin "recent calls" query (ORDER BY created_at without workspace filter)
CREATE INDEX IF NOT EXISTS llm_calls_created_at_idx
  ON llm_calls (created_at DESC);

-- ============================================================
-- Table 3: llm_cost_daily
-- Daily rollup of LLM cost per workspace.
-- Provides persistent quota enforcement across Railway deploys
-- (replaces in-memory openai-quota-guard counter for persistent tracking).
-- UNIQUE(workspace_id, date) enforced — UPSERT pattern on every call.
-- ============================================================
CREATE TABLE IF NOT EXISTS llm_cost_daily (
  id             UUID         NOT NULL DEFAULT gen_random_uuid(),
  -- workspace_id: NULL = system-level aggregate
  workspace_id   UUID         NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  date           DATE         NOT NULL,
  total_calls    INTEGER      NOT NULL DEFAULT 0,
  total_tokens   INTEGER      NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  -- by_model: {"gpt-4o-mini": {"calls": 150, "tokens": 120000, "cost": 0.018}, ...}
  by_model       JSONB        NOT NULL DEFAULT '{}',
  -- by_module: {"ai_reviewer": {"calls": 50, "tokens": 40000, "cost": 0.006}, ...}
  by_module      JSONB        NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT llm_cost_daily_pkey PRIMARY KEY (id),
  -- enforce one row per (workspace, date) — enables UPSERT
  -- name aligned with Drizzle uniqueIndex("llm_cost_daily_workspace_date_uidx")
  CONSTRAINT llm_cost_daily_workspace_date_uidx UNIQUE (workspace_id, date),
  CONSTRAINT llm_cost_daily_cost_check CHECK (total_cost_usd >= 0)
);

-- Index for date-range budget queries
CREATE INDEX IF NOT EXISTS llm_cost_daily_date_idx
  ON llm_cost_daily (date DESC, workspace_id);

-- ============================================================
-- Seed: llm_models_registry initial model set
-- Prices as of 2026-05-17; update when OpenAI/Anthropic changes pricing.
-- ============================================================
INSERT INTO llm_models_registry
  (model_key, provider, display_name, input_price_per_1m_tokens, output_price_per_1m_tokens, max_context_tokens, capabilities)
VALUES
  (
    'gpt-4o-mini',
    'openai',
    'GPT-4o Mini (routine tasks)',
    0.150000,
    0.600000,
    128000,
    '{"vision": true, "functionCalling": true, "streaming": true}'
  ),
  (
    'gpt-4o',
    'openai',
    'GPT-4o (high quality decisions)',
    2.500000,
    10.000000,
    128000,
    '{"vision": true, "functionCalling": true, "streaming": true}'
  ),
  (
    'gpt-4.1',
    'openai',
    'GPT-4.1 (factual heavy tasks)',
    2.000000,
    8.000000,
    1047576,
    '{"vision": true, "functionCalling": true, "streaming": true}'
  ),
  (
    'claude-3-haiku-20240307',
    'anthropic',
    'Claude 3 Haiku (budget fallback)',
    0.250000,
    1.250000,
    200000,
    '{"vision": true, "functionCalling": true, "streaming": true}'
  ),
  (
    'gpt-5.4-mini',
    'openai',
    'GPT-5.4 Mini (locked IUF default)',
    0.150000,
    0.600000,
    128000,
    '{"vision": true, "functionCalling": true, "streaming": true}'
  )
ON CONFLICT (model_key) DO NOTHING;
