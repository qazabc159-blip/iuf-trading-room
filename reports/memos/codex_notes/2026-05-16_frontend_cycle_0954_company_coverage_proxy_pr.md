# 2026-05-16 09:54 Frontend Codex sync

## Latest merged state
- `origin/main` is now `6728473 fix(web): surface quant subscribe readiness warnings (#548)`.
- #548 is merged after rerun; frontend PR train is unblocked.

## Open PRs
- #549 `fix(api): market-data/overview perf` is the only open PR and remains Jason-owned API lane.

## Blocked / owners
- No frontend CI blocker is active after #548 merge.
- API perf remains Jason-owned. Frontend Codex will not touch apps/api broker/risk/contracts.

## This cycle task
- Promote the local company coverage proxy patch from the queue onto fresh `origin/main`.
- Scope: `apps/web/app/api/v1/companies/[ticker]/coverage/route.ts` and `apps/web/app/api/v1/themes/[token]/companies/route.ts`, plus evidence/notes.
- Intent: make Company page and theme wikilink radar consume Jason's My-TW-Coverage endpoints through same-origin frontend proxy, reducing browser CORS/session issues and addressing the Company page coverage integration gap.
