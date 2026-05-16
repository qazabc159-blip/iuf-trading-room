# 2026-05-17 06:22 Frontend Sync - Quant Detail Mobile QA

## Latest Merged State
- `origin/main` is at `709c0b2 fix(web): guard quant subscription states (#588)`.
- Recent merged frontend chain tightened quant subscription empty/error handling, portfolio handoff source labels, AI handoff observability, and HeaderDock notification readiness.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend market-data perf and any broker/risk/contracts work remain outside this frontend lane.
- Bruce/QA: continue owner-session QA across `/ai-recommendations -> /portfolio`, `/quant-strategies`, HeaderDock, draggable dock, and sidebar IA.
- No Yang decision is needed for this bounded mobile UI hardening.

## Chosen Frontend-Safe Task
- Improve `/quant-strategies/[strategyId]` mobile resilience so the detail charts, holdings table, and SIM subscription launcher remain readable at owner-session mobile widths without horizontal page overflow or text crushing.
- Scope is limited to `apps/web` quant detail UI/CSS, evidence, and this note. No backend, broker, risk, shared-contract, KGI, real-order, or tactical homepage changes.
