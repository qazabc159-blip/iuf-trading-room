# Frontend cycle 2026-05-17 02:05 - quant SIM modal focus trap

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `fdd7c35 fix(web): improve quant subscribe modal accessibility (#580)`.
- Recent frontend merges tightened HeaderDock focus behavior, AI recommendation portfolio handoff labels, portfolio SIM preview wording, and the quant strategy SIM subscription dialog open/close behavior.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owner:
- Production owner-session QA still needs an authenticated owner session/env from Elva/Yang.
- Backend quant subscription persistence and any broker/risk/contract changes remain Jason-owned.
- No frontend blocker for a local modal keyboard loop improvement.

Chosen frontend-safe task:
- Complete the `/quant-strategies/[strategyId]` SIM subscription confirmation modal keyboard behavior by trapping Tab/Shift+Tab inside the dialog while it is open.
- Scope is limited to `apps/web/app/quant-strategies/[strategyId]/StrategyDetailClient.tsx` plus evidence. No changes to `apps/api`, Lab source, shared contracts, broker/risk paths, or the tactical homepage.
