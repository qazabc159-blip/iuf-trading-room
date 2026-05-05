# Task B — Persist Idempotency Key Store
# Jason — 2026-05-05

## Status: COMPLETE (static audit, pending Bruce typecheck + test run)

## Problem Statement
Idempotency check used in-memory `Set` in `order-intent.ts`. On server restart, the Set
is cleared — same idempotency key can be accepted again, potentially causing duplicate fills.

## Root Cause (GAP-1 from lane_b_contract4_smoke_learnings.md)
- `_registerIdempotencyKey()` in `order-intent.ts` uses module-level `Set<string>`
- Comment at line 172 says "production delegates to DB UNIQUE constraint" but the routes
  called `_registerIdempotencyKey()` (in-memory), NOT a DB check
- After restart: in-memory Set is empty, duplicate submission accepted

## Fix Chosen: DB-backed lookup via paper-ledger-db.ts

Chose Drizzle (not Redis) because:
- Redis client exists in market-agent lane but not wired to paper routes
- `paper_orders.idempotency_key` has UNIQUE constraint + index (migration 0015)
- Consistent with Task A adapter pattern — no additional dependency
- In memory mode: MapAdapter's `idempotencyIndex` Map provides same guarantee within process

## Changes Made (in Task A diff, included here for clarity)

### `apps/api/src/domain/trading/paper-ledger-db.ts`
- Added `findByIdempotencyKey(key: string): Promise<OrderState | undefined>` to
  `LedgerAdapter` interface
- DrizzleAdapter: SELECT paper_orders WHERE idempotency_key = key
- MapAdapter: lookup via `idempotencyIndex: Map<string, string>` → orderId → OrderState
- Public export: `findByIdempotencyKey(key, adapter?)`

### `apps/api/src/server.ts` — 3 submit routes updated

#### Before (all 3 routes):
```typescript
if (_registerIdempotencyKey(payload.idempotencyKey) === false) {
  return c.json({ error: "DUPLICATE_IDEMPOTENCY_KEY", ... }, 409);
}
```

#### After (all 3 routes):
```typescript
const existing = await findOrderByIdempotencyKey(idempotencyKey);
if (existing) {
  return c.json({ error: "DUPLICATE_IDEMPOTENCY_KEY", ... }, 409);
}
```

Routes affected:
1. `POST /api/v1/paper/orders` (line ~2908) — used `payload.idempotencyKey`
2. `POST /api/v1/strategy/ideas/:ideaId/promote-to-paper-submit` (line ~1840) — used computed key
3. `POST /api/v1/paper/submit` (line ~4470) — used `payload.idempotencyKey`

### `apps/api/src/domain/trading/order-intent.ts`
- NOT modified — `_registerIdempotencyKey` and `_clearIdempotencyKeys` still exported
  for backward compatibility (used in tests; harmless to keep)

## Idempotency Guarantee After Fix

### Memory mode:
- MapAdapter `idempotencyIndex` tracks all keys within the process lifetime
- Same guarantee as old in-memory Set but tied to the order store (consistent state)
- Restart still loses keys — acceptable: memory mode is for CI/local only

### DB mode (PERSISTENCE_MODE=database):
- `findByIdempotencyKey()` queries `paper_orders` table before creating new intent
- If key exists → 409 immediately (no intent created, no executor run)
- If key absent → proceed; `paper-ledger-db.ts` `saveOrder` has `onConflictDoUpdate`
  as final safety net against races (DB UNIQUE constraint enforces at storage layer)
- Survives server restarts: key is in DB, not process memory

## Behavior Matrix
| Scenario | Before | After |
|----------|--------|-------|
| First submit, same process | 201 FILLED | 201 FILLED |
| Duplicate in same process | 409 | 409 |
| Duplicate after restart (memory mode) | 201 (BUG) | 201 (acceptable: memory mode) |
| Duplicate after restart (DB mode) | 201 (BUG) | 409 (FIXED) |

## Files Changed
- `apps/api/src/domain/trading/paper-ledger-db.ts` (interface + DrizzleAdapter + MapAdapter)
- `apps/api/src/server.ts` (3 submit routes: replace _registerIdempotencyKey → findByIdempotencyKey)

## NOT Changed
- `apps/api/src/domain/trading/order-intent.ts` — kept for backward compat
- Migration SQL — `paper_orders.idempotency_key` UNIQUE already exists (migration 0015)
- `apps/web/**` — Codex lane
- `apps/api/src/risk-engine.ts` — risk lane
- `apps/api/src/broker/**` — broker lane

## Next: Bruce Action Required
Same as Task A — single typecheck + test run covers both tasks.
```
pnpm --filter @iuf-trading-room/api typecheck
pnpm --filter @iuf-trading-room/api test
```
