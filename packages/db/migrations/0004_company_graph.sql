CREATE TYPE company_relation_type AS ENUM (
  'supplier',
  'customer',
  'technology',
  'application',
  'co_occurrence',
  'unknown'
);

CREATE TABLE company_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  target_company_id UUID REFERENCES companies(id),
  target_label TEXT NOT NULL,
  relation_type company_relation_type NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX company_relations_company_idx
  ON company_relations (company_id, updated_at);

CREATE INDEX company_relations_target_idx
  ON company_relations (target_company_id);

CREATE UNIQUE INDEX company_relations_unique_edge_idx
  ON company_relations (workspace_id, company_id, target_label, relation_type);

CREATE TABLE company_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  label TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX company_keywords_company_idx
  ON company_keywords (company_id, updated_at);

CREATE UNIQUE INDEX company_keywords_unique_keyword_idx
  ON company_keywords (workspace_id, company_id, label);
