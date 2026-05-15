# Frontend Codex Sync — 2026-05-15 14:47 TST

## Latest State
- `origin/main` is at `7a24fef` (`#539` Pete round 5 API yellows).
- Recent frontend merges verified on main:
  - `#537` HeaderDock notification mark-read proxy + optimistic unread decrement.
  - `#536` static final HTML price placeholders.
  - `#534` quant strategy subscribe routed through SIM-only backend lane.
- Open PRs:
  - `#540` Jim vendor HTML off-hours wording; clean/green, avoid `ui-final-v031/paper_trading_room`.
  - `#541` Jason API/theme seed retry endpoints; dirty and includes `ThemesRadarTab.tsx` from stacked history, avoid company theme files.

## Blocked / Owners
- Company theme backend seed/retry remains Jason-owned in `#541`; frontend should not touch company theme files this cycle.
- Vendor paper trading room wording remains Jim-owned in `#540`; frontend should not touch vendor HTML this cycle.

## Chosen Frontend-Safe Task
- Advance AI recommendations Day 2-3 productization by adding a shareable `/ai-recommendations/[id]` recommendation detail route backed by existing `GET /api/v1/recommendations/:id`, plus a card-level detail link from `/ai-recommendations`.
- Scope stays inside `apps/web` and uses existing Recommendation Orchestrator backend. No broker/risk/live-order code paths touched.
