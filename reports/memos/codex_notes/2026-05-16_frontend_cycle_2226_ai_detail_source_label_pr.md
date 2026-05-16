# 2026-05-16 22:26 Frontend Sync - AI Detail Source Label

Owners: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `b6e394f fix(web): clarify radar lab live labels as closed (#573)`.
- Recent merged frontend safety chain: #570 order flow SIM records, #571 sim event status copy, #572 login broker copy SIM-only, #573 radar Lab live-like labels closed.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open under Jason/API ownership.

Blocked items and owner:
- Owner-session production QA still requires authenticated owner context and real deployment checks.
- Backend endpoint or broker/risk/contract changes remain Jason/Bruce-owned. Frontend will only consume existing contracts.
- No frontend blocker for this cycle.

Chosen frontend-safe task for this cycle:
- Harden `/ai-recommendations/[id]` source label so AI recommendation detail no longer renders backend data as `live`.
- Scope is limited to a visible label in `apps/web/app/ai-recommendations/[id]/page.tsx`, evidence, and this sync note. No portfolio handoff behavior, API routes, broker/risk, or shared contract edits.
