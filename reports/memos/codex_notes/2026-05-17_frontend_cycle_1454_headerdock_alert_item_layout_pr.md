# 2026-05-17 14:54 TPE - Frontend sync note

## Latest merged state
- `origin/main` is at `86100c8 fix(web): contain quant lab candidate text` from PR #603.
- Recent frontend chain: #603 quant Lab candidate containment, #602 AI handoff href safety, #601 invalid AI ticker CTA disable, #600 AI prefill symbol gate, #599 AI handoff source label.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked items / owners
- Market-data overview perf remains Jason-owned in #549.
- No frontend blocker for this cycle.

## Chosen frontend-safe task
- Fix HeaderDock notification drawer alert item layout: the drawer's generic anchor CTA selector currently also styles notification card links, overriding their intended grid/card layout.
- Scope stays in `apps/web` HeaderDock UI/CSS with local notification mock smoke. No backend/API endpoint edits and no broker/risk/order path changes.
