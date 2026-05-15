# Frontend Codex Sync — 2026-05-15 15:17 TST

## Latest State
- `origin/main` is at `8bfcab2` (`#543` AI recommendation detail route).
- Recent merged frontend chain:
  - `#543` `/ai-recommendations/[id]` detail route + same-origin detail proxy.
  - `#537` HeaderDock notification mark-read.
  - `#534` quant strategy subscribe through SIM-only lane.
- Open PR:
  - `#544` Jim/Bruce paper trading room off-hours wording call site; touches `apps/web/public/ui-final-v031/paper_trading_room/index.html`. Avoid portfolio/final HTML this cycle.

## Blocked / Owners
- `#544` remains Jim/Bruce-owned until CI/merge; do not touch trading-room vendor HTML.
- Existing AI feedback real-ID backend verification remains Jason/Bruce follow-up; no frontend change needed for that blocker this cycle.

## Chosen Frontend-Safe Task
- Production QA follow-up on the newly merged AI recommendation detail page: fix the detail page header code label.
- Issue: `/ai-recommendations/[id]` used `PageFrame code="12-D"`, which `PageFrame` maps to the AI daily brief detail label. The page should identify as AI recommendations, not daily briefs.
- Scope: one visual/routing-label fix in `apps/web/app/ai-recommendations/[id]/page.tsx`, plus evidence and browser smoke. No broker/risk/live-order paths touched.
