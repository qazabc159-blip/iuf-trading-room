# Frontend Sync - 2026-05-17 09:03 TST

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is `a6aec4b fix(web): preserve ai handoff side (#592)`.
- Recent merged frontend QA/productization chain: AI handoff side preservation (#592), sidebar active route (#591), HeaderDock drawer scroll containment (#590), quant detail mobile layout (#589), quant subscription state guard (#588).

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owners:
- Backend/API performance and endpoint ownership remains with Jason via #549.
- No frontend blocker found for this cycle.

Chosen frontend-safe task:
- Polish AI recommendation handoff CTA copy/accessible label so the user sees whether the SIM preview will carry `買進` or `賣出` direction before clicking through to `/portfolio`.
- Scope is frontend-only (`apps/web` AI recommendation surfaces). No broker/risk/contracts/backend changes, no real-order promotion, no homepage layout rewrite.
