# 2026-05-16 12:30 TST frontend cycle - run detail trading-room handoff PR

## Latest merged state
- `origin/main` is at `bef904d fix(web): clarify empty notification unread state (#554)`.
- Recent frontend chain: #552 HeaderDock drag persistence, #553 AI recommendation feedback status, #554 notification empty/unread copy.

## Open PRs
- #549 `fix(api): market-data/overview perf` remains open and Jason-owned API work. Frontend Codex will not touch it.

## Blocked / owners
- No frontend blocker for this cycle.
- Backend strategy-run data shape remains Jason-owned; this cycle only adjusts run-detail copy and handoff target.

## Chosen frontend-safe task
- Promote the prepared `/runs/[id]` run-detail handoff patch onto latest `origin/main`.
- Scope: `apps/web/app/runs/[id]/page.tsx` plus evidence.
- Product intent: company pages stay research/info only; simulated preview, risk checks, and execution handoff go to `交易室` (`/portfolio`).
- Safety: no `apps/api` broker/risk/contracts edits, no KGI write path, no real-order or `PAPER_LIVE` promotion.
