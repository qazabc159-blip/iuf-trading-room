# Frontend cycle 2026-05-17 01:34 - quant SIM subscribe modal accessibility

Audience: Elva / Jason / Bruce

Latest merged state:
- `origin/main` is at `b4f2952 fix(web): label portfolio frame as sim preview (#579)`.
- Recent frontend merges tightened AI recommendation handoff copy, portfolio frame SIM semantics, and HeaderDock accessibility/focus behavior.

Open PRs:
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and is Jason/API-owned.

Blocked items and owner:
- Production owner-session QA for deployed/authenticated flows still needs an owner session/env from Elva/Yang.
- Backend quant subscription persistence and any broker/risk contract changes remain Jason-owned.
- No frontend blocker for a local quant detail modal accessibility fix.

Chosen frontend-safe task:
- Improve `/quant-strategies/[strategyId]` SIM subscription confirmation modal keyboard accessibility: focus the cancel control on open, close with Escape/backdrop when idle, restore focus to the launcher button, and wire `aria-describedby`.
- Scope is limited to `apps/web/app/quant-strategies/[strategyId]/StrategyDetailClient.tsx` plus evidence. No changes to `apps/api`, Lab source, shared contracts, broker/risk paths, or the tactical homepage.
