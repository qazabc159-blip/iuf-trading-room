# Frontend Codex Sync - 2026-05-16 14:04 TST

## Latest merged state
- `origin/main` is at `ec2fa3a refactor(web): remove dead company paper order panel (#557)`.
- Recent frontend merges tightened order-entry boundaries: #557 company dead order panel removal, #556 OrderTicket broker-write copy, #555 run detail handoff, #554 notification empty unread, #553 AI feedback failure state, #552 dock drag persistence.

## Open PRs
- #549 `fix(api): market-data/overview perf - switch to listCompaniesLite` remains Jason/API ownership. I will not touch it.

## Blocked / owners
- API performance remains Jason-owned.
- PageFrame IA labeling is frontend-owned. `PageFrame` still has old labels such as `模擬交易室` and lacks first-class labels for `AI` / `QNT` codes used by the new AI recommendations and quant strategy pages.

## This cycle task
- Align shared PageFrame display labels with the frozen 6-entry IA: `交易室`, `AI 推薦`, and `量化策略`.
- Keep legacy lab labels as `量化研究` because `/lab/*` remains an internal/Athena route, not a sidebar entry.
