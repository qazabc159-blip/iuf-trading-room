-- migration: 0040_brain_decisions
-- purpose: Brain ReAct Phase A -- brain_decisions table for AI reasoning trace storage
-- scope: additive-only (1 new table). No existing tables modified.
-- Yang 5/18 mandate: Brain ReAct loop -- LLM sees market data + calls tools + produces analysis report.
-- Phase A: read-only tools only (no write-ops, no submit_order, no broker side-effects).
-- AGPL compliance: all SQL is IUF-original. ReAct pattern from Google Brain 2022 paper (public).
-- down migration: 0040_brain_decisions.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are required -- checked
--   W1: workspace_id FK ON DELETE RESTRICT (keep audit trail even if workspace deleted)
--   W2: run_id UNIQUE -- prevents duplicate async runs
--   W3: status CHECK enum -- running/complete/failed/budget_exceeded
--   W4: total_cost_usd NUMERIC(10,8) with CHECK >= 0 -- checked
--   W5: react_trace JSONB array of {round, thought, toolName, toolInput, observation}
--   N1: no partial-fill concept -- N/A for AI reasoning table

-- ============================================================
-- Quarantine check: ensure workspaces table exists before FK
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workspaces') THEN
    RAISE EXCEPTION 'Quarantine FAIL: workspaces table does not exist. Run prior migrations first.';
  END IF;
END;
$$;

-- ============================================================
-- Table: brain_decisions
-- Stores one row per Brain ReAct invocation.
-- react_trace: JSONB array of {round, thought, toolName, toolInput, observation, tokensUsed}
-- prompt: JSONB -- the initial prompt + context passed to the loop
-- ============================================================
CREATE TABLE IF NOT EXISTS brain_decisions (
  id               UUID          NOT NULL DEFAULT gen_random_uuid(),
  -- workspace_id: NULL = system-level invocation (Owner-triggered admin analysis)
  workspace_id     UUID          NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- run_id: unique string for idempotency (UUID as text, client-provided or server-generated)
  run_id           TEXT          NOT NULL,
  -- prompt: initial context passed to the loop {intent, contextData, toolWhitelist}
  prompt           JSONB         NOT NULL DEFAULT '{}'
                   CONSTRAINT brain_decisions_prompt_obj_check CHECK (jsonb_typeof(prompt) = 'object'),
  -- react_trace: ordered array of ReAct steps
  --   [{round: 1, thought: "...", toolName: "...", toolInput: {...}, observation: {...}, tokensUsed: N}]
  --   Final step has toolName = null (Final Answer round)
  react_trace      JSONB         NOT NULL DEFAULT '[]'
                   CONSTRAINT brain_decisions_react_trace_array_check CHECK (jsonb_typeof(react_trace) = 'array'),
  -- final_report: markdown report generated after the loop ends
  final_report     TEXT          NULL,
  -- total_tokens: sum of all LLM tokens consumed across all rounds
  total_tokens     INTEGER       NOT NULL DEFAULT 0,
  -- total_cost_usd: sum of all LLM cost USD across all rounds (estimated)
  total_cost_usd   NUMERIC(10,8) NOT NULL DEFAULT 0,
  -- status: running | complete | failed | budget_exceeded
  status           TEXT          NOT NULL DEFAULT 'running',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ   NULL,
  CONSTRAINT brain_decisions_pkey PRIMARY KEY (id),
  CONSTRAINT brain_decisions_run_id_unique UNIQUE (run_id),
  CONSTRAINT brain_decisions_cost_check CHECK (total_cost_usd >= 0),
  CONSTRAINT brain_decisions_total_tokens_check CHECK (total_tokens >= 0),
  CONSTRAINT brain_decisions_status_check CHECK (status IN ('running', 'complete', 'failed', 'budget_exceeded'))
);

-- Index for workspace + time-range queries (admin dashboard)
CREATE INDEX IF NOT EXISTS brain_decisions_workspace_created_idx
  ON brain_decisions (workspace_id, created_at DESC);

-- Index for status-based queries (find running sessions)
CREATE INDEX IF NOT EXISTS brain_decisions_status_idx
  ON brain_decisions (status, created_at DESC);
