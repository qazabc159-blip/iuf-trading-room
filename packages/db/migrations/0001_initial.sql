CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE market_state AS ENUM ('Attack', 'Selective Attack', 'Balanced', 'Defense', 'Preservation');
CREATE TYPE theme_lifecycle AS ENUM ('Discovery', 'Validation', 'Expansion', 'Crowded', 'Distribution');
CREATE TYPE beneficiary_tier AS ENUM ('Core', 'Direct', 'Indirect', 'Observation');
CREATE TYPE signal_category AS ENUM ('macro', 'industry', 'company', 'price', 'portfolio');
CREATE TYPE signal_direction AS ENUM ('bullish', 'bearish', 'neutral');
CREATE TYPE trade_plan_status AS ENUM ('draft', 'ready', 'active', 'reduced', 'closed', 'canceled');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  market_state market_state NOT NULL DEFAULT 'Balanced',
  lifecycle theme_lifecycle NOT NULL DEFAULT 'Discovery',
  priority INTEGER NOT NULL DEFAULT 3,
  thesis TEXT NOT NULL DEFAULT '',
  why_now TEXT NOT NULL DEFAULT '',
  bottleneck TEXT NOT NULL DEFAULT '',
  core_pool_count INTEGER NOT NULL DEFAULT 0,
  observation_pool_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  market TEXT NOT NULL,
  country TEXT NOT NULL,
  chain_position TEXT NOT NULL,
  beneficiary_tier beneficiary_tier NOT NULL DEFAULT 'Observation',
  exposure JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE company_theme_links (
  company_id UUID NOT NULL REFERENCES companies(id),
  theme_id UUID NOT NULL REFERENCES themes(id),
  PRIMARY KEY (company_id, theme_id)
);

CREATE TABLE signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  category signal_category NOT NULL,
  direction signal_direction NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trade_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  status trade_plan_status NOT NULL DEFAULT 'draft',
  entry_plan TEXT NOT NULL DEFAULT '',
  invalidation_plan TEXT NOT NULL DEFAULT '',
  target_plan TEXT NOT NULL DEFAULT '',
  risk_reward TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  trade_plan_id UUID NOT NULL REFERENCES trade_plans(id),
  outcome TEXT NOT NULL DEFAULT '',
  attribution TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
