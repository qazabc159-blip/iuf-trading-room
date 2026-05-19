-- migration: 0043_ai_rec_v3_score_breakdown
-- purpose: add score_breakdown JSONB to ai_recommendations_runs for run-level 7-axis SOP summary
-- scope: additive-only (1 new nullable column). No existing columns modified.
-- down migration: 0043_ai_rec_v3_score_breakdown.down.sql
-- Mike audit checklist:
--   B1: column is nullable (no DEFAULT required) — checked
--   B2: JSONB array typeof check not applicable (this is an object) — nullable omits check
--   W1: additive-only — no data loss on forward
--   W2: idempotent via IF NOT EXISTS guard on column add
--   W3: down migration is clean DROP COLUMN — safe

-- ============================================================
-- Quarantine check: ai_recommendations_runs must exist (0041 must run first)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ai_recommendations_runs'
  ) THEN
    RAISE EXCEPTION 'Quarantine FAIL: ai_recommendations_runs table does not exist. Run migration 0041 first.';
  END IF;
END;
$$;

-- ============================================================
-- Add score_breakdown column (nullable JSONB)
-- Idempotent: only adds if not already present.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_recommendations_runs'
      AND column_name = 'score_breakdown'
  ) THEN
    ALTER TABLE ai_recommendations_runs
      ADD COLUMN score_breakdown JSONB NULL;
  END IF;
END;
$$;

-- score_breakdown shape (stored as JSONB object, NOT array — no typeof check):
-- {
--   "itemCount": <integer>,
--   "incompleteCount": <integer>,
--   "ratingDistribution": {"A+": <int>, "A": <int>, "B": <int>, "C": <int>},
--   "avgTotalScore": <float | null>,
--   "topRating": "A+" | "A" | "B" | "C" | null
-- }
