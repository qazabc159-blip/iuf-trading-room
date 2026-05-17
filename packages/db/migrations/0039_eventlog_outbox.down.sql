-- migration: 0039_eventlog_outbox (DOWN)
-- Reverses 0039_eventlog_outbox.sql

DROP TABLE IF EXISTS _quarantine_el_outbox;
DROP TABLE IF EXISTS el_outbox;
