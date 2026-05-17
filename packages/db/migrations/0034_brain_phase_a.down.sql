-- down migration: 0034_brain_phase_a
-- Drops the 3 Brain Phase A tables in reverse dependency order.
-- Safe to run multiple times (IF EXISTS).

DROP TABLE IF EXISTS llm_cost_daily;
DROP TABLE IF EXISTS llm_calls;
DROP TABLE IF EXISTS llm_models_registry;
