# 2026-05-17 05:46 Frontend Sync - Quant Subscriptions State

## Latest Merged State
- `origin/main` is at `1a5d81b fix(web): preserve portfolio handoff source (#587)`.
- Recent merged frontend chain tightened AI handoff labels/source params, HeaderDock notification readiness, and quant subscribe modal accessibility/focus behavior.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend market-data perf and any broker/risk/contracts work remain outside this frontend lane.
- Bruce/QA: continue owner-session QA across `/ai-recommendations -> /portfolio`, `/quant-strategies`, HeaderDock, draggable dock, and sidebar IA.
- No Yang decision is needed for this bounded UI state fix.

## Chosen Frontend-Safe Task
- Improve `/quant-strategies?tab=subscriptions` state handling so failed per-strategy subscription fetches are not mistaken for a true empty subscription list.
- Scope is limited to the frontend Quant subscriptions panel, evidence, and this note. No backend, broker, risk, shared-contract, KGI, real-order, or tactical homepage changes.
