# PR #21 API Gap Audit — radar-api.ts vs apps/api/src/server.ts

**Date**: 2026-04-29
**Author**: Elva (autonomous, post Bruce desk-review F1 triage)
**PR**: #21 (`feat/radar-fullsite-cutover`)
**Trigger**: Bruce flagged `api.killMode()` POST `/api/v1/portfolio/kill-mode` has no backend route → would OFFLINE+throw in prod. Wider audit revealed multiple drifts.

## Audit Method

`grep app\.(get|post|delete|put|patch)\(` over `apps/api/src/server.ts` → cross-referenced every `radar-api.ts` path against the actual route table.

## Path Realignment (this commit)

| RADAR (before) | apps/api (actual) | Resolution in this commit |
|---|---|---|
| `/api/v1/ideas` | `/api/v1/strategy/ideas` | path-swap ✓ |
| `/api/v1/runs` | `/api/v1/strategy/runs` | path-swap ✓ |
| `/api/v1/runs/:id` | `/api/v1/strategy/runs/:id` | path-swap ✓ |
| `/api/v1/quotes` | `/api/v1/market-data/quotes` | path-swap ✓ |
| `/api/v1/portfolio/positions` | `/api/v1/trading/positions` | path-swap ✓ |
| `/api/v1/portfolio/risk` | `/api/v1/risk/limits` | path-swap ✓ |
| `/api/v1/ops/system` | `/api/v1/ops/snapshot` | path-swap ✓ |
| `/api/v1/ops/audit` | `/api/v1/audit-logs` | path-swap ✓ |
| `/api/v1/ops/audit/summary` | `/api/v1/audit-logs/summary` | path-swap ✓ |
| `/api/v1/trading/events/stream` | `/api/v1/trading/stream` | path-swap ✓ |

## Force-MOCK (this commit) — backend routes don't exist or shape mismatch

Routed via new `mockOnly<T>()` helper that bypasses fetch entirely. Prevents OFFLINE state in prod.

| RADAR call | Reason | Backend follow-up |
|---|---|---|
| `api.company(symbol)` | RADAR uses `:symbol`, backend uses `:id` (uuid) | Wire `radar-adapters/symbol-resolver` (already in PR #20) |
| `api.ideasByRun(runId)` | No `/strategy/runs/:id/ideas` endpoint | Add route to `apps/api` (Jason) |
| `api.opsActivity()` | No `/api/v1/ops/activity` endpoint | Add route or remove UI consumer |
| `api.brief()` `api.review()` `api.weeklyPlan()` | Backend has `/api/v1/briefs` + `/api/v1/reviews` but bundle shapes differ | Define shared `BriefBundle`/`ReviewBundle` schemas (Jason+Elva) |
| `api.killMode(mode)` | Backend is `/api/v1/risk/kill-switch` with `killSwitchInputSchema` body, RADAR sends `{ mode }` | Add body adapter; W6 hard line preserves backend state untouched |
| `api.previewOrder(ticket)` | No `/api/v1/paper/orders/preview` route (only POST `/api/v1/paper/orders`) | Add paper preview route (Jason) |

## Verified-OK (this commit, no change)

- `/api/v1/session` ✓
- `/api/v1/themes` ✓
- `/api/v1/companies` ✓
- `/api/v1/signals` ✓
- `/api/v1/risk/strategy-limits` ✓
- `/api/v1/risk/symbol-limits` ✓
- `/api/v1/trading/events?since=...` ✓
- `POST /api/v1/paper/orders` ✓ (W6 paper sprint live route, line 2679)

## W6 Hard Lines Preserved

- Kill-switch backend state ARMED untouched (UI uses force-MOCK; backend `/api/v1/risk/kill-switch` is NOT called by this PR)
- `/order/create` permanent 409 untouched
- No live KGI gateway calls
- Paper-only path for `submitOrder`

## Jason Work Order (post-PR #21 merge)

1. Add `/api/v1/paper/orders/preview` POST — same body schema as `/api/v1/paper/orders`, returns `OrderPreview` (size/price/fees breakdown, no side-effects)
2. Add `/api/v1/strategy/runs/:id/ideas` GET — returns `Idea[]` filtered by run
3. Add `/api/v1/ops/activity` GET — returns `ActivityEvent[]` (recent system activity feed)
4. Reconcile `BriefBundle`/`ReviewBundle`/`WeeklyPlan` schemas between RADAR types and backend `/api/v1/briefs`/`/api/v1/reviews` shapes (or add `/api/v1/plans/{brief,review,weekly}` thin adapter routes)
5. Decide: add `/api/v1/portfolio/kill-mode` thin adapter (calls `setKillSwitchState` with body translation) OR refactor `radar-api.killMode()` to call `/api/v1/risk/kill-switch` with `killSwitchInputSchema`-shaped body

Estimated: ~2-3 hours backend work for items 1-3, ~half-day for items 4-5 schema reconciliation.

---
Generated: 2026-04-29 by Elva
