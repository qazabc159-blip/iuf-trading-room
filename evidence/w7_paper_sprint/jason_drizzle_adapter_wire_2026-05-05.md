# Task A — Wire DrizzleAdapter to Order-Driver (Paper Ledger Persistence)
# Jason — 2026-05-05

## Status: COMPLETE (static audit, pending Bruce typecheck + test run)

## Problem Statement
Paper E2E flow writes ledger to in-memory Map (paper-ledger.ts). Server restart loses all
orders. `paper-ledger-db.ts` with DrizzleAdapter was built in W6 D4 but never wired.

## Root Cause (GAP-2 from lane_b_contract4_smoke_learnings.md)
- `order-driver.ts` imported from `paper-ledger.js` (sync, in-memory)
- `paper-ledger-db.ts` existed with full DrizzleAdapter but was unreferenced by order-driver
- Server.ts read routes (getOrder/listOrders) also pointed to `paper-ledger.js`

## Changes Made

### 1. `apps/api/src/domain/trading/paper-ledger-db.ts`
- Added `findByIdempotencyKey(key)` to `LedgerAdapter` interface
- Added `findByIdempotencyKey` implementation in DrizzleAdapter (SELECT by idempotency_key)
- Added `mapAdapter()` — in-memory LedgerAdapter for memory mode (CI/local without DB)
  - Uses Map<orderId, OrderState> + Map<idempotencyKey, orderId> index
  - Same semantics as old paper-ledger.ts but async + unified under LedgerAdapter
- Changed `getDefaultAdapter()` to: isDatabaseMode() → DrizzleAdapter, else → MapAdapter
  - Previously always called drizzleAdapter() which throws if DB not available
- Added `_setDefaultAdapterForTest()` for test injection
- Added public `findByIdempotencyKey()` export
- Added `isDatabaseMode` to DB package import

### 2. `apps/api/src/domain/trading/order-driver.ts`
- Changed import from `paper-ledger.js` → `paper-ledger-db.js`
- Added `await` to all `upsertOrder()` and `recordFill()` calls (now async)
- Made `cancelOrder()` async (returns `Promise<CancelOrderResult>`)

### 3. `apps/api/src/server.ts`
- Removed import of `_registerIdempotencyKey` from `order-intent.js`
- Removed import of `getOrder`/`listOrders` from `paper-ledger.js`
- Added import of `getOrder`, `listOrders`, `findByIdempotencyKey as findOrderByIdempotencyKey`
  from `paper-ledger-db.js`
- Converted paper routes from sync to async + added `await`:
  - `GET /api/v1/paper/orders/:id` → async, `await getOrder()`
  - `GET /api/v1/paper/orders` → async, `await listOrders()`
  - `POST /api/v1/paper/orders/:id/cancel` → `await getOrder()`, `await cancelPaperOrder()`
  - `GET /api/v1/paper/fills` → async, `await listOrders()`
  - `GET /api/v1/paper/portfolio` → async, `await listOrders()`
- Replaced `_registerIdempotencyKey()` with `await findOrderByIdempotencyKey()` in
  all 3 submit routes (see Task B evidence)

### 4. `apps/api/src/domain/trading/paper-ledger-db.test.ts`
- Added `findByIdempotencyKey()` to `makeMapAdapter()` test double to satisfy
  updated LedgerAdapter interface

## Files Changed
- `apps/api/src/domain/trading/paper-ledger-db.ts` (MapAdapter + findByIdempotencyKey)
- `apps/api/src/domain/trading/order-driver.ts` (import swap + await + async cancelOrder)
- `apps/api/src/server.ts` (import swap + route async/await)
- `apps/api/src/domain/trading/paper-ledger-db.test.ts` (interface compliance)

## Behavior After Fix

### Memory mode (PERSISTENCE_MODE unset / "memory", default):
- MapAdapter used — same in-process Map store, cleared on restart
- Functionally identical to old paper-ledger.ts but async
- No DB dependency — CI tests unaffected

### DB mode (PERSISTENCE_MODE=database + DATABASE_URL set):
- DrizzleAdapter used — writes to `paper_orders` + `paper_fills` tables (migration 0015)
- Orders survive server restart
- `paper_orders.idempotency_key` UNIQUE constraint enforces at DB level

## NOT Changed
- `apps/web/**` — Codex lane untouched
- `apps/api/src/risk-engine.ts` — risk lane untouched
- `apps/api/src/broker/**` — broker lane untouched
- Migration SQL — Mike lane; `paper_orders` and `paper_fills` tables already exist (migration 0015)
- `packages/contracts/src/**` — no contract changes needed

## Lane Boundary Check
All 4 changed files are within Jason's allowed file scope:
- `apps/api/src/domain/trading/paper-ledger-db.ts` ✓
- `apps/api/src/domain/trading/order-driver.ts` ✓
- `apps/api/src/server.ts` (strategy/paper route block only) ✓
- `apps/api/src/domain/trading/paper-ledger-db.test.ts` ✓

## Next: Bruce Action Required
```
pnpm --filter @iuf-trading-room/api typecheck
pnpm --filter @iuf-trading-room/api test
```
Expected: typecheck green, T1-T7 green, ci.test.ts paper sections green.

## Risk
- MapAdapter singleton is module-scoped — shared across all requests in memory mode.
  This is identical to old paper-ledger.ts Map behavior, no regression.
- `_defaultAdapter` lazy-initialized on first call. Thread safety: Node.js is single-threaded,
  no race condition.
