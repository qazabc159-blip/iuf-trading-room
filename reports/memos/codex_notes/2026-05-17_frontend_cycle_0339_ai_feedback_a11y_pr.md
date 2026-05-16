# Frontend cycle 2026-05-17 03:39 - AI feedback accessibility

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `e18df17 fix(web): clarify ai detail data quality (#583)`.
- Recent frontend merges tightened AI recommendation handoff wording, detail data-quality display, portfolio SIM preview framing, HeaderDock accessibility, and quant strategy modal keyboard behavior.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owner:
- Production owner-session QA still needs an authenticated owner session/env from Elva/Yang.
- Backend recommendation feedback persistence and broker/risk/contract work remain Jason-owned.
- No frontend blocker for a local feedback control accessibility polish using the existing frontend proxy endpoint.

Chosen frontend-safe task:
- Polish `RecommendationFeedbackActions` so feedback buttons expose selected state with `aria-pressed`, pending state with `aria-busy`, and a clear live status message.
- Scope is limited to `apps/web/app/ai-recommendations/RecommendationFeedbackActions.tsx` plus evidence. No changes to `apps/api`, Lab source, shared contracts, broker/risk paths, or the tactical homepage layout.
