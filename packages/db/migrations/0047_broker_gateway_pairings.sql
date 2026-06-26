-- migration: 0047_broker_gateway_pairings
-- purpose: broker gateway pairing (UTA Phase 2 後續 — Option A customer-side gateway).
--   A customer runs a gateway agent on their own machine holding their broker
--   certificate/credentials (NEVER uploaded). This table records the PAIRING
--   between an IUF broker_account and that customer-side gateway: an issued
--   pairing token (hash only), pairing lifecycle, and liveness heartbeat. It
--   stores NO broker credentials — only token hashes + reachability metadata.
-- scope: additive-only (1 new table). No existing tables modified.
-- down migration: 0047_broker_gateway_pairings.down.sql
-- Mike audit checklist:
--   B1: all NOT NULL columns have DEFAULT or are set at insert time — checked
--       (id gen_random_uuid; broker_account_id/workspace_id/pairing_token_hash/
--        expires_at set at insert; status/gateway_label/created_at/updated_at default)
--   B2: no JSONB columns in this table
--   W1: additive-only new table — no data loss on forward
--   W2: idempotent via IF NOT EXISTS on TABLE and every INDEX
--   W3: down migration is a clean DROP TABLE — safe (no other table references it)
--   W4: partial UNIQUE index guarantees at most ONE active (pending|paired) pairing
--       per broker_account — re-pairing requires revoking/expiring the old one first
--   W5: CHECK constraint on status enum
--   FK: broker_account_id → broker_accounts(id) ON DELETE CASCADE
--       workspace_id      → workspaces(id)      ON DELETE CASCADE
--       (both parents deleted ⇒ pairing is meaningless ⇒ cascade is correct)
--   SECURITY: pairing_token_hash / gateway_token_hash store SHA-256 hashes only;
--       plaintext tokens are returned to the Owner once at issuance and never persisted.
--       NO broker password / certificate / account credential is stored here (Option A).

-- ============================================================
-- Table: broker_gateway_pairings
-- One row per pairing attempt between a broker_account and a customer gateway.
-- lifecycle: pending (token issued) → paired (gateway registered) → revoked|expired.
-- ============================================================
CREATE TABLE IF NOT EXISTS broker_gateway_pairings (
  id                  UUID         NOT NULL DEFAULT gen_random_uuid(),

  broker_account_id   UUID         NOT NULL,
  workspace_id        UUID         NOT NULL,

  -- pairing token: SHA-256 hash only. Plaintext returned once at issuance.
  pairing_token_hash  TEXT         NOT NULL,

  -- lifecycle
  status              TEXT         NOT NULL DEFAULT 'pending',
  gateway_label       TEXT         NOT NULL DEFAULT '',

  -- long-lived gateway session token (SHA-256 hash) — set when the gateway
  -- registers (slice 2). NULL until paired. NEVER a broker credential.
  gateway_token_hash  TEXT         NULL,

  paired_at           TIMESTAMPTZ  NULL,
  last_heartbeat_at   TIMESTAMPTZ  NULL,
  expires_at          TIMESTAMPTZ  NOT NULL,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT broker_gateway_pairings_pkey PRIMARY KEY (id),

  CONSTRAINT broker_gateway_pairings_account_fk
    FOREIGN KEY (broker_account_id) REFERENCES broker_accounts (id) ON DELETE CASCADE,
  CONSTRAINT broker_gateway_pairings_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,

  CONSTRAINT broker_gateway_pairings_status_check CHECK (
    status IN ('pending', 'paired', 'revoked', 'expired')
  )
);

-- At most ONE active (pending|paired) pairing per broker_account.
CREATE UNIQUE INDEX IF NOT EXISTS broker_gateway_pairings_active_account_uidx
  ON broker_gateway_pairings (broker_account_id)
  WHERE status IN ('pending', 'paired');

-- Lookup on register: find the pending pairing by token hash.
CREATE UNIQUE INDEX IF NOT EXISTS broker_gateway_pairings_pairing_token_uidx
  ON broker_gateway_pairings (pairing_token_hash);

-- Lookup on heartbeat: find the paired gateway by its session token hash.
CREATE UNIQUE INDEX IF NOT EXISTS broker_gateway_pairings_gateway_token_uidx
  ON broker_gateway_pairings (gateway_token_hash)
  WHERE gateway_token_hash IS NOT NULL;

-- Workspace-scoped listing.
CREATE INDEX IF NOT EXISTS broker_gateway_pairings_workspace_idx
  ON broker_gateway_pairings (workspace_id);
