-- migration: 0046_iuf_decisions
-- purpose: iuf_decisions table — OpenAlice M1 decision layer.
-- OpenAlice consumes iuf_events + signals → LLM reasoning → writes decision rows.
-- M1 only produces decisions (status='proposed'). M2 will execute them.
-- scope: additive-only (1 new table). No existing tables modified.
-- down migration: 0046_iuf_decisions.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are set at insert time — checked
--       (id gen_random_uuid, trigger_type/trigger_id/trigger_ref set at insert,
--        reasoning/action_type/action_payload set at insert, confidence/priority/status/cost_usd have defaults)
--   B2: JSONB columns: trigger_ref, action_payload, outcome
--       trigger_ref: CHECK jsonb_typeof = 'object' (required at insert, always object)
--       action_payload: CHECK jsonb_typeof = 'object'
--       outcome: nullable, CHECK IS NULL OR jsonb_typeof = 'object'
--   W1: additive-only new table — no data loss on forward
--   W2: idempotent via IF NOT EXISTS on TABLE and INDEX
--   W3: down migration is a clean DROP TABLE — safe
--   W4: UNIQUE (trigger_type, trigger_id) dedup — same event/signal never produces two decisions
--   W5: CHECK constraints on action_type, status, confidence, priority, cost_usd
--   W6: no FK to iuf_events (that table has no PK constraint name exposed; trigger_id stores UUID as TEXT)
--       FK-like integrity is enforced at application layer (orchestrator validates trigger existence)

-- ============================================================
-- Table: iuf_decisions
-- One row per decision produced by the OpenAlice orchestrator.
-- trigger_ref: snapshot of the event/signal that triggered this decision.
-- action_payload: structured data for M2 execution (varies by action_type).
-- outcome: nullable — filled in by M4 performance tracking cron.
-- ============================================================
CREATE TABLE IF NOT EXISTS iuf_decisions (
  id               UUID          NOT NULL DEFAULT gen_random_uuid(),

  -- trigger provenance
  trigger_type     TEXT          NOT NULL,
  trigger_id       TEXT          NOT NULL,
  trigger_ref      JSONB         NOT NULL DEFAULT '{}',

  -- LLM reasoning output
  reasoning        TEXT          NOT NULL DEFAULT '',
  action_type      TEXT          NOT NULL,
  action_payload   JSONB         NOT NULL DEFAULT '{}',
  confidence       REAL          NOT NULL DEFAULT 0,
  priority         INTEGER       NOT NULL DEFAULT 3,

  -- lifecycle
  status           TEXT          NOT NULL DEFAULT 'proposed',

  -- M4 outcome (filled post-hoc)
  outcome          JSONB         NULL,

  -- cost tracking
  model_key        TEXT          NULL,
  cost_usd         NUMERIC(10,8) NOT NULL DEFAULT 0,

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT iuf_decisions_pkey PRIMARY KEY (id),

  -- Dedup: same trigger_id can only produce one decision
  CONSTRAINT iuf_decisions_trigger_uidx UNIQUE (trigger_type, trigger_id),

  -- Enum guards
  CONSTRAINT iuf_decisions_action_type_check CHECK (
    action_type IN ('deep_analyze', 'rec_reweight', 'rebalance_suggest', 'priority_alert')
  ),
  CONSTRAINT iuf_decisions_status_check CHECK (
    status IN ('proposed', 'executing', 'done', 'skipped')
  ),

  -- Range guards
  CONSTRAINT iuf_decisions_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT iuf_decisions_priority_check CHECK (priority >= 1 AND priority <= 5),
  CONSTRAINT iuf_decisions_cost_usd_check CHECK (cost_usd >= 0),

  -- JSONB type guards (idempotent DO $$ block used so IF NOT EXISTS pattern works)
  CONSTRAINT iuf_decisions_trigger_ref_check CHECK (jsonb_typeof(trigger_ref) = 'object'),
  CONSTRAINT iuf_decisions_action_payload_check CHECK (jsonb_typeof(action_payload) = 'object'),
  CONSTRAINT iuf_decisions_outcome_check CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object')
);

-- Index: M2 reads proposed decisions ordered by priority then time
CREATE INDEX IF NOT EXISTS iuf_decisions_status_created_idx
  ON iuf_decisions (status, created_at DESC);

-- Index: filter by action type (UI display / M2 routing)
CREATE INDEX IF NOT EXISTS iuf_decisions_action_type_created_idx
  ON iuf_decisions (action_type, created_at DESC);

-- Index: general time-range queries
CREATE INDEX IF NOT EXISTS iuf_decisions_created_at_idx
  ON iuf_decisions (created_at DESC);

-- Note: the UNIQUE constraint on (trigger_type, trigger_id) already creates a B-tree index.
-- No duplicate standalone index needed for that column pair.
