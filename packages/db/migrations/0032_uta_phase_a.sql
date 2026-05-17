-- migration: 0032_uta_phase_a
-- purpose: UTA (Unified Trading Account) Phase A — BrokerAdapter abstraction layer
-- scope: additive-only (3 new tables). No existing tables modified.
-- Mike audit v2: B1 quantity_unit / W1 idempotency_key / W3 comment / W4 allocation_ratio / N4 partial_fill
-- AGPL compliance: design-only inspiration from OpenAlice public README/docs; all SQL is IUF-original.
-- down migration: 0032_uta_phase_a.down.sql

-- Table 1: broker_adapters
CREATE TABLE IF NOT EXISTS broker_adapters (
  adapter_key          TEXT         NOT NULL,
  display_name         TEXT         NOT NULL,
  cap_odd_lot          BOOLEAN      NOT NULL DEFAULT FALSE,
  cap_margin_trading   BOOLEAN      NOT NULL DEFAULT FALSE,
  cap_short_selling    BOOLEAN      NOT NULL DEFAULT FALSE,
  cap_after_hours_fix  BOOLEAN      NOT NULL DEFAULT FALSE,
  cap_sim_mode         BOOLEAN      NOT NULL DEFAULT FALSE,
  cap_max_subscriptions INTEGER     NOT NULL DEFAULT 0,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT broker_adapters_pkey PRIMARY KEY (adapter_key)
);

INSERT INTO broker_adapters (
  adapter_key, display_name,
  cap_odd_lot, cap_margin_trading, cap_short_selling, cap_after_hours_fix, cap_sim_mode, cap_max_subscriptions,
  is_active
) VALUES
  ('kgi',   '凱基證券 (KGI)',   TRUE,  TRUE,  TRUE,  FALSE, TRUE,  40),
  ('paper', 'Paper Trading',    TRUE,  TRUE,  TRUE,  FALSE, TRUE,  9999)
ON CONFLICT (adapter_key) DO NOTHING;

-- Table 2: broker_accounts
-- allocation_ratio: fraction of portfolio allocated to this account (0.0–1.0, not a percentage).
-- Named ratio (not pct) to avoid confusion with percentage denomination.
CREATE TABLE IF NOT EXISTS broker_accounts (
  id              UUID         NOT NULL DEFAULT gen_random_uuid(),
  workspace_id    UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  adapter_key     TEXT         NOT NULL REFERENCES broker_adapters(adapter_key) ON DELETE RESTRICT,
  account_ref     TEXT         NOT NULL,
  account_label   TEXT         NOT NULL DEFAULT '',
  allocation_ratio NUMERIC(5,4) NOT NULL DEFAULT 1.0
                   CHECK (allocation_ratio >= 0 AND allocation_ratio <= 1),
  is_primary      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT broker_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT broker_accounts_workspace_adapter_ref_uidx UNIQUE (workspace_id, adapter_key, account_ref)
);

CREATE INDEX IF NOT EXISTS broker_accounts_workspace_idx ON broker_accounts (workspace_id);
CREATE INDEX IF NOT EXISTS broker_accounts_adapter_idx ON broker_accounts (adapter_key);

-- Table 3: unified_orders
-- broker_account_id: nullable — orders may be created before account assignment (async broker routing).
--   ON DELETE SET NULL: orphan risk acceptable in Phase A (account deactivation does not invalidate audit).
-- quantity_unit: 'LOT' = board lot (1000 shares in TW market); 'SHARE' = odd-lot (1–999 shares).
--   Matches paper_orders / kgi_orders convention (migration 0020).
-- status: 'partial_fill' = partially filled, order still open (distinct from 'filled').
-- idempotency_key: caller-supplied dedup key for network-retry safety. UNIQUE enforced.
CREATE TABLE IF NOT EXISTS unified_orders (
  id                  UUID         NOT NULL DEFAULT gen_random_uuid(),
  workspace_id        UUID         NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  broker_account_id   UUID         REFERENCES broker_accounts(id) ON DELETE SET NULL,
  adapter_key         TEXT         NOT NULL,
  symbol              TEXT         NOT NULL,
  action              TEXT         NOT NULL CHECK (action IN ('Buy', 'Sell')),
  qty                 INTEGER      NOT NULL CHECK (qty > 0),
  quantity_unit       TEXT         NOT NULL DEFAULT 'LOT'
                                   CHECK (quantity_unit IN ('SHARE', 'LOT')),
  price_type          TEXT         NOT NULL CHECK (price_type IN ('Market', 'Limit', 'LimitUp', 'LimitDown')),
  limit_price         NUMERIC(14,4),
  order_cond          TEXT         CHECK (order_cond IN ('Cash', 'Margin', 'ShortSelling', 'LendSelling')),
  odd_lot             BOOLEAN      NOT NULL DEFAULT FALSE,
  status              TEXT         NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'submitted', 'partial_fill', 'filled', 'cancelled', 'rejected')),
  idempotency_key     TEXT         UNIQUE,
  external_order_id   TEXT,
  filled_qty          INTEGER      NOT NULL DEFAULT 0,
  filled_price        NUMERIC(14,4),
  submitted_at        TIMESTAMPTZ,
  filled_at           TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  actor_id            UUID,
  adapter_response    JSONB,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT unified_orders_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS unified_orders_workspace_created_idx ON unified_orders (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS unified_orders_workspace_status_idx ON unified_orders (workspace_id, status);
CREATE INDEX IF NOT EXISTS unified_orders_broker_account_idx ON unified_orders (broker_account_id);
