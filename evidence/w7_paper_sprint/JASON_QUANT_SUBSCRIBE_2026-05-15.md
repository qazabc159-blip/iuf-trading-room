# JASON — Quant Strategy Subscribe — 2026-05-15 16:30 TST

## Delivery

- Branch: `feat/api-quant-strategy-subscribe-2026-05-15`
- PR title: `feat(api): quant-strategies subscribe real logic (replace stub) + my subscriptions list`

## New Capability

**POST /api/v1/quant-strategies/:id/subscribe**
- Owner-only
- sim_only forced true server-side (ignores client body)
- capital_twd: 50_000–1_000_000 NTD (hard-checked)
- strategyId: must be in `VALID_QUANT_STRATEGY_IDS` (cont_liq_v36, strategy_002, strategy_003)
- executionMode must be "paper" → else 403 PAPER_MODE_REQUIRED
- On success: returns `{ subscription_id: UUID, status: "active" }` (201)
- Persists to audit_logs (action="quant_strategy.subscribe", entityType="quant_strategy") — no new DB table

**GET /api/v1/quant-strategies/:id/subscriptions/my**
- Owner-only
- Queries audit_logs WHERE action='quant_strategy.subscribe' AND actorId=session.user.id AND workspaceId=session.workspace.id
- Filters result by strategyId in application layer
- Returns `{ subscriptions: SubscriptionRecord[] }`

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/quant-strategy-subscribe.ts` | NEW — core module: subscribeQuantStrategy, listMyQuantSubscriptions, exported constants |
| `apps/api/src/server.ts` | Added 2 routes before serve() block (POST subscribe + GET subscriptions/my) |
| `tests/ci.test.ts` | Added import + 6 tests QS-SUB-1..5 + QS-SUB-bonus |

## Test Results

Before: 268 pass / 1 fail (pre-existing KGI network test)
After:  274 pass / 1 fail (same pre-existing failure, +6 new QS-SUB tests all green)

QS-SUB-1: valid subscribe → 201 + UUID subscription_id ✔
QS-SUB-2: capital < 50k → 400 CAPITAL_BELOW_MIN ✔
QS-SUB-3: capital > 1M → 400 CAPITAL_EXCEEDED_CAP ✔
QS-SUB-4: unknown strategy → 404 STRATEGY_NOT_FOUND ✔
QS-SUB-5: listMyQuantSubscriptions → [] in non-DB mode ✔
QS-SUB-bonus: VALID_QUANT_STRATEGY_IDS set membership check ✔

## Build

- `npx tsc -p apps/api/tsconfig.json --noEmit` → clean (0 errors)

## Stop-Lines Verified

- sim_only NOT promoted to PAPER_LIVE ✔
- No KGI broker write ✔
- No DB schema migration (audit_logs reuse) ✔
- No token leak ✔
- Lane boundary: only touched strategy lane files ✔

## Assumptions

- MAIN is not a direct strategy ID in ALLOWED_STRATEGY_IDS; used cont_liq_v36/strategy_002/strategy_003 from lab-strategy-snapshot-fetcher.ts
- executionMode check pulls from getExecutionFlagSnapshot() in server.ts handler
- No DB-level read test for listMyQuantSubscriptions (isDatabaseMode()=false in CI, returns [])
