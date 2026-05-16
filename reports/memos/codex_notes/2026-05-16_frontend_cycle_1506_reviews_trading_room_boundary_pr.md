# Frontend Codex Sync - 2026-05-16 15:06 TST

## Latest merged state
- `origin/main` is at `4ae0f4a fix(web): route plans order boundary to trading room (#559)`.
- Recent frontend merges: #559 plans order boundary to trading room, #558 PageFrame IA labels, #557 company dead PaperOrderPanel removal, #556 OrderTicket broker-write copy, #555 run detail handoff.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains Jason/API ownership. I will not touch it.

## Blocked / owners
- API performance remains Jason-owned.
- Reviews read-only wording is frontend-owned. After #557, company pages no longer own paper/order preview, but `/reviews` still says preview/submit is on the individual stock page.

## This cycle task
- Update `/reviews` read-only boundary copy so simulation preview, risk review, and submit point back to the trading room.
- Keep the page read-only and avoid any execution path changes.
