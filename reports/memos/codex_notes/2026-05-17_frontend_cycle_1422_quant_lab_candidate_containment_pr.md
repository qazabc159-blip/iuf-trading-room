# 2026-05-17 14:22 TPE - Frontend sync note

## Latest merged state
- `origin/main` is at `95fec95 fix(web): sanitize ai handoff href params` from PR #602.
- Recent frontend QA/evidence chain: #602 AI handoff href safety, #601 invalid AI ticker CTA disable, #600 AI prefill symbol gate, #599 AI handoff source label, #598 quant subscriptions mobile scroll containment.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` is still open and owned by Jason/API.

## Blocked items / owners
- Backend/API market-data overview perf remains Jason-owned in #549.
- No frontend blocker for this cycle.

## Chosen frontend-safe task
- Tighten `/quant-strategies` Lab sanctioned snapshot candidate cards so long Lab strategy names/status copy cannot overflow on mobile or dense desktop widths.
- Scope is limited to `apps/web` UI containment/readability and evidence. No Lab/API endpoint changes, no fake scores, no broker/risk/order path changes.
