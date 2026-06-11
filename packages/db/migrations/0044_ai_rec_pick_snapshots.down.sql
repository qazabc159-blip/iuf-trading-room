-- down migration: 0044_ai_rec_pick_snapshots
-- Reverts the ai_rec_pick_snapshots table and all associated indexes.
--
-- WARNING: all pick snapshot data (pick history + forward returns) will be permanently deleted.
-- If audit trail matters, export before running:
--   SELECT * FROM ai_rec_pick_snapshots ORDER BY pick_date DESC;

-- Indexes are automatically dropped with the table; explicit DROP INDEX not required.
-- CASCADE handles FK references if any future migration adds one.

DROP TABLE IF EXISTS ai_rec_pick_snapshots;
