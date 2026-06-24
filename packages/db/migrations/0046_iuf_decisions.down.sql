-- down migration: 0046_iuf_decisions
-- Drops the iuf_decisions table introduced in 0046_iuf_decisions.sql.
-- Indexes are dropped automatically via CASCADE when the table is dropped.
DROP TABLE IF EXISTS iuf_decisions;
