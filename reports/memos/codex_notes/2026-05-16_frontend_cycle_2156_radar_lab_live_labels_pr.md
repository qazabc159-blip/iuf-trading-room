# 2026-05-16 21:56 Frontend Sync - Radar Lab Live-Like Labels

Owners: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `6e04d56 fix(web): clarify login broker copy as SIM-only (#572)`.
- Recent merged frontend safety chain: #568 lab order status SIM-only, #569 lab owner mode SIM-only, #570 order flow SIM records, #571 sim event status copy, #572 login broker copy SIM-only.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open under Jason/API ownership.

Blocked items and owner:
- Owner-session production QA still requires authenticated owner context and real deployment checks.
- Backend endpoint or broker/risk/contract changes remain Jason/Bruce-owned. Frontend will only consume existing contracts.
- Lab upstream enum names such as `PAPER_LIVE`, `LIVE_CANDIDATE`, and `IN_LIVE` are backend/Lab contract vocabulary. This cycle will not rename those keys.

Chosen frontend-safe task for this cycle:
- Harden the UI display wording in `apps/web/lib/radar-lab.ts` so upstream live-like Lab statuses render as SIM / broker-write-closed boundaries in Trading Room.
- Scope is limited to display labels, evidence, and this sync note. No `apps/api`, broker, risk, or shared contract edits.
