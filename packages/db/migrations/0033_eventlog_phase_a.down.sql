-- down migration: 0033_eventlog_phase_a
-- Reverses all changes from 0033_eventlog_phase_a.sql
-- Order: drop dependents before parents (el_events → el_event_streams; el_event_snapshots → el_event_streams)

DROP TABLE IF EXISTS _quarantine_el_eventlog_phase_a;
DROP TABLE IF EXISTS el_event_snapshots;
DROP TABLE IF EXISTS el_events;
DROP TABLE IF EXISTS el_event_streams;
