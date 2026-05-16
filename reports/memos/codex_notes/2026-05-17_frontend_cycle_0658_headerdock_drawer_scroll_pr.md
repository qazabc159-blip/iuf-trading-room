# 2026-05-17 06:58 Frontend Sync - HeaderDock Drawer Scroll QA

## Latest Merged State
- `origin/main` is at `ebd6801 fix(web): harden quant detail mobile layout (#589)`.
- Recent merged frontend chain tightened quant detail mobile layout, quant subscription states, AI to portfolio handoff labels, and HeaderDock mark-read readiness.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend market-data performance and any notification backend contract changes remain outside this frontend lane.
- Bruce/QA: continue owner-session QA across HeaderDock, sidebar IA, `/ai-recommendations -> /portfolio`, and `/quant-strategies`.
- No Yang decision is needed for this bounded drawer layout hardening.

## Chosen Frontend-Safe Task
- Fix HeaderDock notification/system drawer scroll containment so long notification lists remain reachable on mobile and short-height desktop viewports.
- Scope is limited to `apps/web` HeaderDock CSS, evidence, and this note. No backend, broker, risk, shared-contract, KGI, real-order, or tactical homepage changes.
