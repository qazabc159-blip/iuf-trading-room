# JASON_PAPER_CASH_UNIFY_2026-05-13

## Task
Unify paper-broker capital three-layer inconsistency.
楊董 ack: all layers must show NT$10,000,000; Railway env PAPER_BROKER_INITIAL_CASH=10000000 set by 楊董.

## Root Cause
Two endpoints in `server.ts` had hardcoded fallback `20_000` instead of `10_000_000`:

1. `/api/v1/portfolio/preview` (line 9036-9039)
   - Was: `: 20_000`
   - Fix: `: 10_000_000`

2. `/api/v1/paper/portfolio` (line 9702-9705)
   - Was: `: 20_000` with stale comment "default 20,000 TWD per product spec"
   - Fix: `: 10_000_000` + updated comment to reflect 楊董 ack 2026-05-13

`paper-broker.ts` already correct: `DEFAULT_INITIAL_CASH = 10_000_000` + reads `PAPER_BROKER_INITIAL_CASH` env.

## Files Changed
- `apps/api/src/server.ts` — 2 fallback values + 1 comment updated (3 lines)

## Verification

### Build
```
pnpm --filter @iuf-trading-room/api build → clean (tsc exit 0)
```

### Tests
```
node --import tsx/esm --test src/__tests__/*.test.ts
302 total / 288 pass / 13 fail
```
13 failures are pre-existing (paper-e2e-order-unit, finmind-full-ingest, content-drafts T05 idempotency, strategy-ideas S1) — all unrelated to capital change. No new test regression introduced.

### Secret Scan
git diff grep for password/secret/token/key on changed lines → 0 matches. PASS.

## Commit / Branch
- Branch: `fix/api-paper-broker-cash-unify-10m-2026-05-13`
- Commit: `6c97c0f`

## PR
- Title: `fix(api): unify paper-broker initial cash via PAPER_BROKER_INITIAL_CASH env (10M default)`

## Lane Boundary
- broker.* NOT touched
- contracts NOT touched
- risk-engine NOT touched
- KGI gateway NOT touched
- No new endpoint opened
- Only `server.ts` (strategy-adjacent, preview/portfolio handlers)

## State after
When `PAPER_BROKER_INITIAL_CASH` env is NOT set: both endpoints return `10_000_000`.
When `PAPER_BROKER_INITIAL_CASH=10000000` is set by 楊董 on Railway: same value confirmed from env.
paper-broker.ts bootstrap: already `DEFAULT_INITIAL_CASH = 10_000_000` — no change needed.

All three capital layers now unified at NT$10,000,000.
