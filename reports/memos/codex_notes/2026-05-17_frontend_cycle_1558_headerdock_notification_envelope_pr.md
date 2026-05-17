# 2026-05-17 15:58 TPE - Frontend sync note

## Latest merged state
- `origin/main` is at `3620d53 fix(web): prefetch header dock unread count` from PR #605.
- Recent frontend chain: #605 HeaderDock unread prefetch/mark-read reliability, #604 alert card layout, #603 quant Lab candidate containment, #602 AI handoff href safety.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked items / owners
- Market-data overview perf remains Jason-owned in #549.
- No frontend blocker for this cycle.

## Chosen frontend-safe task
- Harden HeaderDock notification proxy live-state parsing so it accepts both top-level notification arrays and API envelope payloads under `data`.
- Scope is limited to `apps/web` same-origin notification proxy and browser smoke with a mock envelope response. No backend/API service edits and no broker/risk/order path changes.
