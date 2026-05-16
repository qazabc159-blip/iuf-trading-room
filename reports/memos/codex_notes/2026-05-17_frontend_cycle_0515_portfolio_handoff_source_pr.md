# 2026-05-17 05:15 Frontend Sync - Portfolio Handoff Source Params

## Latest Merged State
- `origin/main` is at `11f875c fix(web): clarify ai handoff frame title (#586)`.
- Recent frontend merges tightened AI recommendation handoff labels, detail data-quality display, feedback accessibility, HeaderDock mark-read readiness, and portfolio frame title observability.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend market-data/recommendation endpoints and broker/risk/contract work remain API-owned.
- Bruce/QA: continue owner-session QA across portfolio handoffs, quant strategies, HeaderDock, draggable dock, and sidebar IA.
- No Yang decision is needed for this bounded frontend handoff-source polish.

## Chosen Frontend-Safe Task
- Preserve existing frontend portfolio handoff source params (`from_strategy`, `from_home`, `from_run`) through the portfolio iframe wrapper and surface them in the SIM preview source metadata.
- Scope is limited to `apps/web` portfolio wrappers, final-v031 frontend hydration, evidence, and this note. No backend, broker, risk, shared-contract, KGI, real-order, or tactical homepage changes.
