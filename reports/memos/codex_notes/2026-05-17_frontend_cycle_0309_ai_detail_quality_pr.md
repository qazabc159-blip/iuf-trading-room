# Frontend cycle 2026-05-17 03:09 - AI detail data quality display

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `4f13a11 fix(web): polish ai handoff prefill copy (#582)`.
- Recent frontend merges tightened AI recommendation portfolio handoff wording, portfolio SIM preview framing, HeaderDock accessibility, and quant strategy modal keyboard behavior.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owner:
- Production owner-session QA still needs an authenticated owner session/env from Elva/Yang.
- Backend recommendation feedback persistence and broker/risk/contract work remain Jason-owned.
- No frontend blocker for a local AI recommendation detail data-quality polish using existing `rec.dataQuality`.

Chosen frontend-safe task:
- Align `/ai-recommendations/[id]` data-quality display with the list page: Traditional Chinese labels, explicit data-quality summary, and existing status/penalty values only.
- Scope is limited to `apps/web/app/ai-recommendations/[id]/page.tsx` plus evidence. No changes to `apps/api`, Lab source, shared contracts, broker/risk paths, or the tactical homepage layout.
