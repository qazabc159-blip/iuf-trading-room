# Frontend Codex Sync - 2026-05-16 13:31 TST

## Latest merged state
- `origin/main` is at `e5ccbdb fix(web): clarify order ticket broker write remains closed (#556)`.
- Recent frontend merges: #556 OrderTicket broker-write copy, #555 run detail handoff, #554 notification empty unread, #553 AI feedback failure state, #552 dock drag persistence, #550 company coverage proxy.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` is Jason/API ownership. I will not touch it.

## Blocked / owners
- API perf remains Jason-owned.
- Company order-entry boundary is frontend-owned. `apps/web/app/companies/[symbol]/PaperOrderPanel.tsx` still exists on main but `rg PaperOrderPanel apps/web` shows it is not imported or mounted anywhere.

## This cycle task
- Remove the dead company-page `PaperOrderPanel` file so the company page cannot drift back toward order entry. This matches Yang's product direction: company pages preserve research/coverage information; trading room owns order entry.
