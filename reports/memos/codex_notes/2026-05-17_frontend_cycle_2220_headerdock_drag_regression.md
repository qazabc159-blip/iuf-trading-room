# 2026-05-17 Frontend cycle 2220 - HeaderDock drag regression

Owner: Codex frontend (`apps/web`)
Scope: HeaderDock draggable dock regression after latest merged frontend/global CSS changes

## Latest merged state

- `origin/main` is at `911a88c`:
  - `#625` Quant owner E2E QA evidence.
  - `#624` API UTA Phase A BrokerAdapter abstraction.
  - `#623` Web company page layout/global CSS cleanup after PaperOrderPanel removal.
  - `#617/#616/#615` OpenAlice design memos.
- Current clean worktree:
  - `IUF_TRADING_ROOM_APP_headerdock_drag_regression_worktree`
  - branch `qa/web-headerdock-drag-regression-2026-05-17`

## Open PRs

- None observed before starting this cycle.

## Recent related evidence reviewed

- `CODEX_HEADERDOCK_OWNER_SESSION_QA_2026-05-17.md`
- `CODEX_HEADERDOCK_TEXT_ALIASES_PR_2026-05-17.md`
- `CODEX_HEADERDOCK_SEVERITY_ALIASES_PR_2026-05-17.md`
- `CODEX_HEADERDOCK_SNAKECASE_NOTIFICATIONS_PR_2026-05-17.md`
- `CODEX_HEADERDOCK_204_EMPTY_PR_2026-05-17.md`
- `CODEX_HEADERDOCK_UNREAD_QUERY_PR_2026-05-17.md`
- `CODEX_HEADERDOCK_NOTIFICATION_ENVELOPE_PR_2026-05-17.md`
- `CODEX_HEADERDOCK_UNREAD_PREFETCH_PR_2026-05-17.md`
- `2026-05-16_frontend_cycle_1055_headerdock_drag_persist_pr.md`

## Blocked items and owners

- True production Owner-session HeaderDock QA is still blocked when this Codex browser has no usable production Owner login state.
  - Owner: Yang / Elva if a real production authenticated browser session is required.
- Backend notification source and persistence are Jason-owned.
  - Codex action this cycle: local mock API only; no backend broker/risk/contracts changes.

## Chosen frontend-safe task

Run one bounded HeaderDock draggable dock regression pass:

- Verify desktop drag handle moves the dock and stores `iuf-header-dock-position`.
- Verify reload restores the saved dock position.
- Verify account menu reset clears the stored position and returns the dock to default.
- Verify notification drawer still opens after drag/reset.
- Verify mobile viewport ignores desktop drag placement and has no horizontal overflow.
- If a frontend-owned regression is found, patch only `apps/web` and re-run targeted QA.
- If no regression is found, ship evidence-only QA PR.
