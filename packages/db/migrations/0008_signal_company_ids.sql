-- Round 13 — add company_ids JSONB to signals table.
-- Signals were created without a junction table; companyIds were silently
-- dropped by the postgres repo. This column stores the linked company UUID
-- array directly on the signal row, avoiding a separate junction table while
-- preserving the same shape as the in-memory repo and the contract schema.
-- Default is '[]' so all existing signals gracefully return empty companyIds.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS company_ids JSONB NOT NULL DEFAULT '[]';
