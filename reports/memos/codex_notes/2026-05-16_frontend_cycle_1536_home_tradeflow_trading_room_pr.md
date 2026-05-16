# Frontend Codex Sync - 2026-05-16 15:36 TST

## Latest merged state
- `origin/main` is at `ac7530e fix(web): route reviews order boundary to trading room (#560)`.
- Recent frontend merges: #560 reviews order boundary, #559 plans order boundary, #558 PageFrame IA labels, #557 company dead PaperOrderPanel removal, #556 OrderTicket broker-write copy.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains Jason/API ownership. I will not touch it.

## Blocked / owners
- API performance remains Jason-owned.
- Homepage trade-flow copy/hrefs are frontend-owned. After #557, homepage still links paper preview to `/companies/2330#paper-order` and strategy candidate rows to company `#paper-order` anchors.

## This cycle task
- Update homepage trade-flow links/copy so paper preview and execution go to the trading room instead of the removed company-page order anchor.
- Keep the tactical homepage layout and visual structure unchanged; only copy and hrefs are touched.
