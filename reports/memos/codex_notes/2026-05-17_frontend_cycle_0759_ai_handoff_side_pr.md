# Frontend Sync - 2026-05-17 07:59 TST

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is `c43444a fix(web): expose sidebar active route (#591)`.
- Recent merged frontend QA/productization chain: sidebar active route (#591), HeaderDock drawer scroll containment (#590), quant detail mobile layout (#589), quant subscription state guard (#588), portfolio handoff source preservation (#587).

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owners:
- Backend/API performance and endpoint ownership remains with Jason via #549.
- No frontend blocker found for this cycle.

Chosen frontend-safe task:
- Preserve AI recommendation direction in `/ai-recommendations -> /portfolio` handoff by carrying a safe `side=buy|sell` query value and making the embedded paper SIM ticket select the matching vendor side when present.
- Scope is frontend-only (`apps/web` UI/proxy hydration). No broker/risk/contracts/API backend changes, no real-order promotion, no homepage layout rewrite.
