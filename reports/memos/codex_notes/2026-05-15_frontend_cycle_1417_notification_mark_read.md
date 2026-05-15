# Frontend Codex sync - 2026-05-15 14:17 TST

## Latest merged state
- `origin/main` is at `a22274c` with #535 merged after #534.
- Relevant frontend merges now live in main:
  - #534: quant strategy subscribe flows through SIM-only backend lane.
  - #532: company themes radar consumes `/api/v1/themes/index`.
  - #524/#520: HeaderDock notification drawer consumes real notification events through a same-origin proxy.

## Open PRs
- #536 `chore(web): replace hardcoded static prices in paper-trading-room HTML with loading placeholder`
  - Owner: Jim / vendor final HTML lane.
  - Status: CI `validate` still running at cycle start; no collision planned.

## Blockers / owner
- Jason/backend: `/api/v1/notifications/:id/mark-read` exists and returns 204 while writing an audit log, but v1 does not persist read state in a user notification table yet.
- Bruce/Elva: production owner-session QA still needed for HeaderDock bell drawer after deploy.
- Frontend gap: HeaderDock currently displays unread notifications but clicking an item only navigates; it does not call mark-read or optimistically update the unread badge.

## Chosen frontend-safe task this cycle
Add HeaderDock notification mark-read readiness:
- add same-origin web proxy for `POST /api/header-dock/notifications/:id/mark-read`;
- add frontend helper and optimistic local unread/read update when clicking a notification;
- do not touch vendor HTML, broker/risk/contracts, or homepage layout.
