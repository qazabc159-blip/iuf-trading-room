# 2026-05-17 07:28 Frontend Sync - Sidebar Active Current QA

## Latest Merged State
- `origin/main` is at `2576086 fix(web): contain header dock drawer scroll (#590)`.
- Recent merged frontend chain tightened HeaderDock drawer scrolling, quant detail mobile layout, quant subscription states, AI to portfolio handoff labels, and HeaderDock mark-read readiness.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend market-data performance and any broker/risk/contracts work remain outside this frontend lane.
- Bruce/QA: continue owner-session QA across sidebar IA, HeaderDock, `/ai-recommendations -> /portfolio`, and `/quant-strategies`.
- No Yang decision is needed for this bounded sidebar accessibility hardening.

## Chosen Frontend-Safe Task
- Add `aria-current="page"` to the active tactical sidebar link and keep the active item visible inside the mobile horizontal nav, so sidebar IA exposes the current page semantically and visually on desktop/mobile.
- Scope is limited to `apps/web` sidebar UI, evidence, and this note. No backend, broker, risk, shared-contract, KGI, real-order, or tactical homepage layout changes.
