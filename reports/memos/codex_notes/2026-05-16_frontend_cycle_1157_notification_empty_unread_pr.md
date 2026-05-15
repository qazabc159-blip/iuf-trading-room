# 2026-05-16 11:57 TST frontend cycle - notification empty unread PR

## Latest merged state
- `origin/main` is at `927c9e5 fix(web): clarify AI feedback failure states (#553)`.
- Recent frontend chain: #548 quant subscribe readiness warning, #550 company coverage proxies, #552 HeaderDock drag persistence, #553 AI feedback failure copy.

## Open PRs
- #549 `fix(api): market-data/overview perf` remains open and Jason-owned API work. Frontend Codex will not touch it.

## Blocked / owners
- No frontend blocker for this cycle.
- Notification backend event production and mark-read persistence remain Jason-owned; this cycle only fixes the HeaderDock drawer's empty/unread display for existing response shapes.

## Chosen frontend-safe task
- Promote the prepared HeaderDock notification empty/unread copy patch onto latest `origin/main`.
- Scope: `apps/web/components/header-dock.tsx` plus evidence.
- Safety: no broker/risk/contracts changes, no KGI write path, no real-order or `PAPER_LIVE` promotion.
