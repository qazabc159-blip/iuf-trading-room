-- Migration: 0027_brief_search_index
-- Status: DRAFT — awaiting Mike (migration-auditor) audit before promotion
-- Owner: Jason (backend-strategy)
-- Purpose: GIN index on daily_briefs.sections for full-text search
--          Enables /api/v1/briefs/search endpoint (FTS via to_tsvector + plainto_tsquery).
--
-- This migration is skipped by migrate.ts (DRAFT suffix filter).
-- Do NOT promote until Mike audit sign-off.
--
-- Performance assumption:
--   7 current briefs; expected growth ~1/day.
--   GIN index on to_tsvector('simple', ...) amortises search cost to O(log N)
--   vs O(N) for sections::text ILIKE.
--   The endpoint falls back to ILIKE automatically if this index is absent.
--
-- Note: sections is JSONB; index expression extracts all heading+body text
--       using jsonb_array_elements subquery in a GENERATED expression emulation.
--       Postgres GIN functional index syntax used here (no persisted column needed).

CREATE INDEX IF NOT EXISTS daily_briefs_sections_fts_idx
  ON daily_briefs
  USING GIN (
    to_tsvector(
      'simple',
      COALESCE(
        (SELECT string_agg(
           COALESCE(s->>'heading', '') || ' ' || COALESCE(s->>'body', ''),
           ' '
         ) FROM jsonb_array_elements(sections) AS s),
        ''
      )
    )
  );
