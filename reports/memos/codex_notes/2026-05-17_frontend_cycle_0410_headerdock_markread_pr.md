# 2026-05-17 04:10 Frontend Sync - HeaderDock Mark-Read Readiness

## Latest Merged State
- `origin/main` is at `c062fdf fix(web): improve ai feedback accessibility (#584)`.
- Recent merged frontend chain: #582 AI portfolio handoff copy, #583 AI detail data quality clarity, #584 AI feedback accessibility.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend notification mark-read semantics remain API-owned; frontend will keep using the existing same-origin proxy only.
- Bruce/QA: continue owner-session browser follow-up for HeaderDock/Notification Center after this polish.
- No Yang decision is needed for this bounded frontend hardening cycle.

## Chosen Frontend-Safe Task
- Improve HeaderDock Notification Center mark-read readiness by exposing per-notification read/pending state and an aria live status while preserving the existing vendor tactical layout and using only existing `apps/web` proxy/client APIs.
