-- migration: 0037_portfolio_snapshots.down
-- purpose: Roll back Trading-as-Git Phase A portfolio snapshot tables.

DROP TABLE IF EXISTS _quarantine_portfolio_snapshots_phase_a;
DROP TABLE IF EXISTS portfolio_diffs;
DROP TABLE IF EXISTS portfolio_snapshots;
