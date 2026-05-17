-- migration: 0038_toolcenter_phase_a
-- purpose: OpenAlice ToolCenter Phase A -- central manifest registry for tools
-- scope: additive-only (2 new tables + 2 quarantine + seed 7 tools). No existing tables modified.
-- Slot: 0037=Trading-as-Git (separate BG), 0038=ToolCenter (this task), 0039+=KGI orders/fills reserved.
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are required -- checked
--   W1: tool_calls FK ON DELETE RESTRICT (workspace must not be deleted while calls exist)
--   W2: constraint names aligned with Drizzle index names
--   W3: jsonb CHECK ensures input_schema + output_schema are always objects (not arrays)
--   W4: status CHECK ensures only valid terminal/pending states
--   N1: tool_type CHECK enforces known tool categories
--   N2: no monetary columns in this migration
--   quarantine tables: _quarantine_tools_0038 + _quarantine_tool_calls_0038 per Mike standard

-- ============================================================
-- Table 1: tools
-- Central manifest registry -- one row per registered tool.
-- Seeded with Phase A tools; new tools can be INSERT-ed at runtime.
-- ============================================================
CREATE TABLE IF NOT EXISTS tools (
  id                UUID        NOT NULL DEFAULT gen_random_uuid(),
  -- tool_key: stable snake_case identifier, e.g. "ai_reviewer", "finmind_sync"
  tool_key          TEXT        NOT NULL,
  -- tool_type: category used for grouping + audit queries
  tool_type         TEXT        NOT NULL,
  -- display_name: human-readable label for admin UI
  display_name      TEXT,
  -- description: plain-text purpose summary
  description       TEXT,
  -- input_schema: JSON Schema-compatible object describing inputs
  input_schema      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- output_schema: JSON Schema-compatible object describing outputs
  output_schema     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- is_active: false = tool deprecated/disabled, excluded from registry list
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  -- capabilities: free-form bag, e.g. {"canRetry": true, "costCents": 0.03}
  capabilities      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tools_pkey           PRIMARY KEY (id),
  CONSTRAINT tools_key_unique     UNIQUE (tool_key),
  CONSTRAINT tools_type_check     CHECK (tool_type IN ('llm', 'data_sync', 'review', 'admin_action', 'cron')),
  CONSTRAINT tools_schema_obj_in  CHECK (jsonb_typeof(input_schema)  = 'object'),
  CONSTRAINT tools_schema_obj_out CHECK (jsonb_typeof(output_schema) = 'object')
);

-- Indexes for tools
CREATE INDEX IF NOT EXISTS tools_type_idx   ON tools (tool_type);
CREATE INDEX IF NOT EXISTS tools_active_idx ON tools (is_active);

-- ============================================================
-- Table 2: tool_calls
-- Append-only audit log of every callTool() invocation.
-- Does NOT store raw input/output -- only summaries (privacy).
-- ============================================================
CREATE TABLE IF NOT EXISTS tool_calls (
  id             UUID        NOT NULL DEFAULT gen_random_uuid(),
  -- tool_key: denormalized for query convenience (no JOIN needed for admin queries)
  tool_key       TEXT        NOT NULL,
  -- caller_type: who triggered the call: "cron", "admin_action", "llm", "api"
  caller_type    TEXT        NOT NULL,
  -- workspace_id: NULL = system-level call (not scoped to a workspace)
  workspace_id   UUID        NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- input_summary: short description of inputs -- NOT full payload (privacy)
  input_summary  TEXT,
  -- output_summary: short description of outcome -- NOT full output
  output_summary TEXT,
  -- status: terminal state of the call
  status         TEXT        NOT NULL,
  -- latency_ms: wall-clock time in milliseconds for the tool fn execution
  latency_ms     INTEGER,
  -- error_message: only set when status='failure' or 'timeout'
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tool_calls_pkey       PRIMARY KEY (id),
  CONSTRAINT tool_calls_status_chk CHECK (status IN ('pending', 'success', 'failure', 'timeout'))
);

-- Indexes for tool_calls
CREATE INDEX IF NOT EXISTS tool_calls_key_created_idx ON tool_calls (tool_key, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_calls_workspace_idx   ON tool_calls (workspace_id);
CREATE INDEX IF NOT EXISTS tool_calls_status_idx      ON tool_calls (status);
CREATE INDEX IF NOT EXISTS tool_calls_created_at_idx  ON tool_calls (created_at DESC);

-- ============================================================
-- Seed: 7 Phase A tools manifest
-- Phase A: registry only -- no logic changes to the underlying tools.
-- ============================================================
INSERT INTO tools (tool_key, tool_type, display_name, description, input_schema, output_schema, is_active, capabilities)
VALUES
  (
    'ai_reviewer',
    'review',
    'AI Content Reviewer',
    'Automated quality and safety reviewer for content_drafts. Uses LLM to evaluate compliance, hallucination, and content quality.',
    '{"type":"object","properties":{"draftId":{"type":"string","format":"uuid"}},"required":["draftId"]}'::jsonb,
    '{"type":"object","properties":{"verdict":{"type":"string","enum":["approve","reject","manual_review"]},"confidence":{"type":"number"}}}'::jsonb,
    TRUE,
    '{"canRetry":true,"callerModule":"ai_reviewer","taskType":"review","estimatedCostUsd":0.0003}'::jsonb
  ),
  (
    'adversarial_reviewer',
    'review',
    'Adversarial Content Reviewer',
    'Second-pass adversarial reviewer that stress-tests content for manipulation patterns, market bias, and hidden directives.',
    '{"type":"object","properties":{"draftId":{"type":"string","format":"uuid"}},"required":["draftId"]}'::jsonb,
    '{"type":"object","properties":{"severityScore":{"type":"number","minimum":0,"maximum":10},"adversarialFlags":{"type":"array"}}}'::jsonb,
    TRUE,
    '{"canRetry":true,"callerModule":"adversarial_reviewer","taskType":"review","estimatedCostUsd":0.0005}'::jsonb
  ),
  (
    'factual_reviewer',
    'review',
    'Factual Accuracy Reviewer',
    'Verifies factual claims in content against known source data. Flags hallucinated numbers, companies, or events.',
    '{"type":"object","properties":{"draftId":{"type":"string","format":"uuid"}},"required":["draftId"]}'::jsonb,
    '{"type":"object","properties":{"hallucinated":{"type":"boolean"},"flags":{"type":"array"}}}'::jsonb,
    TRUE,
    '{"canRetry":true,"callerModule":"factual_reviewer","taskType":"review","estimatedCostUsd":0.0004}'::jsonb
  ),
  (
    'hallu_rag',
    'review',
    'Hallucination RAG Checker',
    'Retrieval-augmented generation check for hallucinated source citations. Queries source pack to verify claim provenance.',
    '{"type":"object","properties":{"draftId":{"type":"string","format":"uuid"},"sourcePackId":{"type":"string"}},"required":["draftId"]}'::jsonb,
    '{"type":"object","properties":{"verdict":{"type":"string","enum":["pass","fail","inconclusive"]}}}'::jsonb,
    TRUE,
    '{"canRetry":false,"callerModule":"hallucination_rag","taskType":"verification","estimatedCostUsd":0.0006}'::jsonb
  ),
  (
    'finmind_sync',
    'data_sync',
    'FinMind Data Sync',
    'Syncs Taiwan stock market data from FinMind API into local DB. Covers OHLCV, institutional investors, short-sell balances.',
    '{"type":"object","properties":{"dataType":{"type":"string"},"fromDate":{"type":"string","format":"date"},"toDate":{"type":"string","format":"date"}}}'::jsonb,
    '{"type":"object","properties":{"rowsInserted":{"type":"integer"},"rowsSkipped":{"type":"integer"}}}'::jsonb,
    TRUE,
    '{"canRetry":true,"callerModule":"finmind_sync","taskType":"data_sync","estimatedCostUsd":0}'::jsonb
  ),
  (
    'themes_links_rebuild',
    'admin_action',
    'Themes-Links Rebuild',
    'Rebuilds company-theme link graph from scratch. Clears stale links and re-seeds from current company universe.',
    '{"type":"object","properties":{"workspaceId":{"type":"string","format":"uuid"}},"required":["workspaceId"]}'::jsonb,
    '{"type":"object","properties":{"linksCreated":{"type":"integer"},"linksDeleted":{"type":"integer"}}}'::jsonb,
    TRUE,
    '{"canRetry":true,"callerModule":"themes_links_rebuild","taskType":"admin_action","estimatedCostUsd":0}'::jsonb
  ),
  (
    'content_drafts_retry',
    'admin_action',
    'Content Drafts Retry Review',
    'Re-runs AI reviewer pipeline for content drafts stuck in awaiting_review status. Batch-processes up to 50 drafts.',
    '{"type":"object","properties":{"workspaceId":{"type":"string","format":"uuid"},"from":{"type":"string","format":"date"},"to":{"type":"string","format":"date"},"limit":{"type":"integer","maximum":50},"dryRun":{"type":"boolean"}}}'::jsonb,
    '{"type":"object","properties":{"processed":{"type":"integer"},"approved":{"type":"integer"},"rejected":{"type":"integer"},"errors":{"type":"integer"}}}'::jsonb,
    TRUE,
    '{"canRetry":false,"callerModule":"content_drafts_retry","taskType":"admin_action","estimatedCostUsd":0}'::jsonb
  )
ON CONFLICT (tool_key) DO NOTHING;

-- ============================================================
-- Quarantine (Mike standard -- 0038 scope marker)
-- ============================================================
CREATE TABLE IF NOT EXISTS _quarantine_tools_0038 (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT
);

CREATE TABLE IF NOT EXISTS _quarantine_tool_calls_0038 (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note         TEXT
);
