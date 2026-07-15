-- 0059 — paper_realized_pnl: widen to accept the unified order-flow pipeline
--
-- Problem: migration 0058 FK'd buy_order_id/sell_order_id to paper_orders(id),
-- which only ever holds rows written by the LEGACY paper flow (order-driver.ts
-- + domain/trading/paper-ledger-db.ts, fed by POST /api/v1/paper/submit). The
-- unified order-flow pipeline (trading-service.ts -> broker/paper-broker.ts,
-- fed by POST /api/v1/trading/orders, the path the /desk-exact trading-desk
-- UI actually uses) keeps its own Order/Fill records in a completely separate
-- id space (in-memory per-account state, snapshotted to paper_broker_state —
-- never written to paper_orders). 2026-07-15 Bruce E2E verify
-- (reports/sprint_2026_07_15/PAPER_REALIZED_PNL_E2E_2026_07_15.md) confirmed a
-- real unified order never appeared in the 0058 ledger at all — this migration
-- is the schema half of closing that gap (see order-driver.ts /
-- broker/paper-broker.ts for the write-path code, both now calling the exact
-- same recordRealizedPnlForSell()/computeFifoRealizedPnl() functions).
--
-- Changes:
--   1. Drop the two FKs to paper_orders(id) — a single FK cannot span two
--      disjoint id spaces. The UNIQUE(sell_order_id, buy_order_id) idempotency
--      guarantee (0058 blocker #2) is untouched; that constraint doesn't
--      depend on the FK.
--   2. Add `source` (legacy_paper | unified_paper) so each row still cites
--      which pipeline/id-space its order ids resolve against — preserves the
--      spirit of 0058 blocker #1 ("must cite an exact source, not a soft
--      link") even though a single cross-table FK is no longer possible.
--      Existing/legacy rows default to 'legacy_paper' (correct — no unified
--      rows existed before this migration).
--   3. Add `account_id` (nullable) — the unified pipeline has a real,
--      user-chosen account concept (input.order.accountId, e.g.
--      "primary-desk"); the legacy pipeline never had one. Recorded so a
--      future audit can verify FIFO matches never crossed accounts (the
--      actual boundary is enforced by the caller only ever passing
--      same-account fills into the FIFO matcher — this column makes that
--      externally verifiable via SQL instead of only by code review).
--
-- No historical unified-pipeline orders are backfilled by this migration
-- (see PR body — out of scope, ledger starts honest from deploy time).

ALTER TABLE paper_realized_pnl DROP CONSTRAINT IF EXISTS paper_realized_pnl_buy_order_id_fkey;
ALTER TABLE paper_realized_pnl DROP CONSTRAINT IF EXISTS paper_realized_pnl_sell_order_id_fkey;

ALTER TABLE paper_realized_pnl
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy_paper';

ALTER TABLE paper_realized_pnl
  ADD CONSTRAINT paper_realized_pnl_source_check
  CHECK (source IN ('legacy_paper', 'unified_paper'));

ALTER TABLE paper_realized_pnl
  ADD COLUMN IF NOT EXISTS account_id TEXT;

CREATE INDEX IF NOT EXISTS paper_realized_pnl_account_idx
  ON paper_realized_pnl (account_id)
  WHERE account_id IS NOT NULL;
