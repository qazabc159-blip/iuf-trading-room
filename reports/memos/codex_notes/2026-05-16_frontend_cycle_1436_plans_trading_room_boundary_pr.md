# Frontend Codex Sync - 2026-05-16 14:36 TST

## Latest merged state
- `origin/main` is at `e55f5cf fix(web): align page frame IA labels (#558)`.
- Recent frontend merges: #558 PageFrame IA labels, #557 company dead PaperOrderPanel removal, #556 OrderTicket broker-write copy, #555 run detail handoff, #554 notification empty unread.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains Jason/API ownership. I will not touch it.

## Blocked / owners
- API performance remains Jason-owned.
- Plans read-only wording is frontend-owned. After #557, company pages no longer own paper/order preview, but `/plans` still says preview/submit is on the individual stock page.

## This cycle task
- Update `/plans` read-only boundary copy so it points simulation preview, risk review, and submit back to the trading room.
- Keep the page read-only and avoid any execution path changes.
