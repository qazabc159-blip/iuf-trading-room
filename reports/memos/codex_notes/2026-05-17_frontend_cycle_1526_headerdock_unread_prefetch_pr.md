# 2026-05-17 15:26 TPE - Frontend sync note

## Latest merged state
- `origin/main` is at `7df5829 fix(web): preserve header dock alert card layout` from PR #604.
- Recent frontend chain: #604 HeaderDock alert card layout, #603 quant Lab candidate containment, #602 AI handoff href safety, #601 invalid AI ticker CTA disable, #600 AI prefill symbol gate.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked items / owners
- Market-data overview perf remains Jason-owned in #549.
- No frontend blocker for this cycle.

## Chosen frontend-safe task
- Improve HeaderDock bell unread readiness: synchronize notification unread count once on mount so the bell badge is accurate before the user opens the drawer.
- Scope stays in `apps/web` HeaderDock UI/client behavior with local notification mock smoke. No backend/API endpoint edits and no broker/risk/order path changes.
