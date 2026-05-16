# 2026-05-17 04:41 Frontend Sync - AI Handoff Frame Title

## Latest Merged State
- `origin/main` is at `64fd8dd fix(web): improve header dock mark-read state (#585)`.
- Recent frontend merges covered AI recommendation handoff copy, AI detail data-quality display, feedback accessibility, and HeaderDock notification mark-read readiness.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains open and Jason/API-owned.

## Blocked Items / Owners
- Jason: backend recommendation and market-data endpoint ownership remains backend/API-side.
- Bruce/QA: owner-session QA should continue across `/ai-recommendations -> /portfolio`, `/quant-strategies`, and HeaderDock.
- No Yang decision is needed for this bounded accessibility/QA polish.

## Chosen Frontend-Safe Task
- Improve `/ai-recommendations -> /portfolio` handoff observability by carrying ticker, recommendation id, entry, stop, and target into the outer portfolio frame title/aria label for both `/portfolio` and `/final-v031/portfolio`.
- Scope is limited to `apps/web` route wrappers plus evidence; no backend, broker, risk, shared-contract, KGI, or tactical homepage changes.
