-- migration: 0037_portfolio_snapshots
-- purpose: OpenAlice Trading-as-Git Phase A — portfolio snapshot version control
-- scope: additive-only (3 new tables). No existing tables modified.
-- Yang 5/18 mandate: trading system must be fully operational.
-- AGPL compliance: design-only inspiration from OpenAlice public README/docs. All SQL is IUF-original.
-- down migration: 0037_portfolio_snapshots.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are required -- checked
--   W1: FK ON DELETE RESTRICT (preserve audit trail, prevent workspace/snapshot deletion)
--   W2: constraint names aligned with Drizzle schema
--   W3: inline comments on non-obvious columns
--   W4: jsonb CHECK constraints enforce shape contracts
--   N4: no monetary/decimal without precision -- N/A (no monetary columns)

-- ============================================================
-- Table 1: portfolio_snapshots
-- Each row is a "git commit" of the full portfolio state.
-- parent_id forms a linked list (nullable = root snapshot).
-- trigger: what caused this snapshot to be created.
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id               UUID         NOT NULL DEFAULT gen_random_uuid(),
  -- workspace_id: which workspace this snapshot belongs to
  workspace_id     UUID         NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  -- parent_id: previous snapshot in the chain (NULL = root / initial state)
  parent_id        UUID         REFERENCES portfolio_snapshots(id) ON DELETE RESTRICT,
  -- positions: full portfolio positions at this snapshot (object keyed by ticker)
  -- shape: { [ticker: string]: { shares: number, avgCost: number, sector?: string, lastPrice?: number } }
  positions        JSONB        NOT NULL DEFAULT '{}',
  -- trigger: what caused this snapshot
  trigger          TEXT         NOT NULL,
  -- trigger_ref_id: FK-style reference to the triggering entity (e.g. strategy run id, order id)
  trigger_ref_id   TEXT,
  -- metadata: arbitrary key-value bag for caller annotations
  metadata         JSONB        NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT portfolio_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_snapshots_trigger_chk
    CHECK (trigger IN ('manual', 'strategy_run', 'eod_auto', 'rollback')),
  CONSTRAINT portfolio_snapshots_positions_obj_chk
    CHECK (jsonb_typeof(positions) = 'object')
);

-- ============================================================
-- Indexes for portfolio_snapshots
-- ============================================================
-- Workspace timeline: list most-recent snapshots per workspace
CREATE INDEX portfolio_snapshots_workspace_created_idx
  ON portfolio_snapshots (workspace_id, created_at DESC);

-- Parent traversal: walk ancestry chain
CREATE INDEX portfolio_snapshots_parent_idx
  ON portfolio_snapshots (parent_id)
  WHERE parent_id IS NOT NULL;

-- ============================================================
-- Table 2: portfolio_diffs
-- Records the computed diff between two snapshots.
-- Created automatically by createSnapshot() when parent exists.
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_diffs (
  id                UUID         NOT NULL DEFAULT gen_random_uuid(),
  -- from_snapshot_id: older snapshot (may be NULL for root diffs)
  from_snapshot_id  UUID         REFERENCES portfolio_snapshots(id) ON DELETE RESTRICT,
  -- to_snapshot_id: newer snapshot (the one that was just created)
  to_snapshot_id    UUID         NOT NULL REFERENCES portfolio_snapshots(id) ON DELETE RESTRICT,
  -- added_positions: tickers that appear in to but not from
  -- shape: { [ticker]: { shares, avgCost, sector?, lastPrice? } }
  added_positions   JSONB        NOT NULL DEFAULT '{}',
  -- removed_positions: tickers that appear in from but not to
  removed_positions JSONB        NOT NULL DEFAULT '{}',
  -- changed_positions: tickers in both but with different values
  -- shape: { [ticker]: { from: {...}, to: {...} } }
  changed_positions JSONB        NOT NULL DEFAULT '{}',
  -- summary: human-readable one-line description of the diff
  summary           TEXT         NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT portfolio_diffs_pkey PRIMARY KEY (id),
  CONSTRAINT portfolio_diffs_added_obj_chk
    CHECK (jsonb_typeof(added_positions) = 'object'),
  CONSTRAINT portfolio_diffs_removed_obj_chk
    CHECK (jsonb_typeof(removed_positions) = 'object'),
  CONSTRAINT portfolio_diffs_changed_obj_chk
    CHECK (jsonb_typeof(changed_positions) = 'object')
);

-- ============================================================
-- Indexes for portfolio_diffs
-- ============================================================
CREATE INDEX portfolio_diffs_from_snapshot_idx
  ON portfolio_diffs (from_snapshot_id)
  WHERE from_snapshot_id IS NOT NULL;

CREATE INDEX portfolio_diffs_to_snapshot_idx
  ON portfolio_diffs (to_snapshot_id);

-- ============================================================
-- Quarantine (Mike standard -- 0037 scope marker)
-- ============================================================
CREATE TABLE IF NOT EXISTS _quarantine_portfolio_snapshots_phase_a (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note        TEXT        NOT NULL DEFAULT 'Trading-as-Git Phase A migration 0037'
);
