-- Phase 1 step 1 — persist the structured execution block on trade plans.
-- Nullable + no default: old plans remain prose-only, strategy/broker/risk
-- engines treat NULL as "not executable yet".
ALTER TABLE trade_plans ADD COLUMN execution JSONB;
