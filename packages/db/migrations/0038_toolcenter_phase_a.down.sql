-- down migration: 0038_toolcenter_phase_a
-- Reverses the toolcenter phase A migration.
-- Safe to run: DROP TABLE IF EXISTS is idempotent.

DROP TABLE IF EXISTS _quarantine_tool_calls_0038;
DROP TABLE IF EXISTS _quarantine_tools_0038;
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS tools;
