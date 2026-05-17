# Frontend Sync - 2026-05-17 10:07 TST

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is `a3f8e60 fix(web): harden ai feedback proxy (#594)`.
- Recent merged frontend QA/productization chain: AI feedback proxy hardening (#594), AI handoff CTA direction (#593), AI handoff side preservation (#592), sidebar active route (#591), HeaderDock drawer scroll containment (#590).

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owners:
- Backend/API performance and endpoint ownership remains with Jason via #549.
- No frontend blocker found for this cycle.

Chosen frontend-safe task:
- Ensure AI recommendation handoff `acted` telemetry fires for all intentional handoff activations: normal click, Ctrl/Cmd/Shift/Alt click, and middle-click/new-tab activation.
- Scope is frontend-only (`apps/web` AI handoff link). No backend broker/risk/contracts changes, no order path promotion, no homepage layout rewrite.
