# 2026-05-16 21:23 Frontend Sync - Login SIM Broker-Closed Copy

Owners: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `202bd42 fix(web): clarify sim event status copy (#571)`.
- Recent merged frontend safety chain: #568 lab order status SIM-only, #569 lab owner mode SIM-only, #570 order flow SIM records, #571 sim event status copy.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open under Jason/API ownership.

Blocked items and owner:
- Owner-session production QA still requires authenticated owner context and real deployment checks.
- Backend endpoint or broker/risk/contract changes remain Jason/Bruce-owned. Frontend will only consume existing contracts.
- No frontend blocker for this cycle.

Chosen frontend-safe task for this cycle:
- Harden `/login` visible copy so the unauthenticated entry point says SIM-only / broker write closed, and no longer implies formal broker write unlocks automatically after SDK completion.
- Scope is limited to `apps/web/app/login/page.tsx` plus evidence and this sync note. No `apps/api`, broker, risk, or shared contract edits.
