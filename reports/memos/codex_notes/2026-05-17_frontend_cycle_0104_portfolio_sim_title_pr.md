# Frontend cycle 2026-05-17 01:04 - portfolio SIM frame title

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `d8ea0b3 fix(web): label ai handoff sim preview (#578)`.
- Recent frontend merges tightened AI handoff SIM wording and HeaderDock bell/drawer accessibility.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owner:
- Production owner-session QA for deployed/authenticated flows still needs an owner session/env from Elva/Yang.
- Backend freshness/persistence and any broker/risk contract changes stay Jason-owned.
- No frontend code blocker for this cycle.

Chosen frontend-safe task:
- Update `/portfolio` outer frame accessibility title to say SIM preview, and make the AI recommendation handoff case explicit when prefill params are present.
- Scope is limited to the `/portfolio` wrappers in `apps/web/app/portfolio/page.tsx` and `apps/web/app/final-v031/portfolio/page.tsx` plus evidence. No changes to `apps/api`, Lab, shared contracts, broker/risk paths, or the tactical homepage.
