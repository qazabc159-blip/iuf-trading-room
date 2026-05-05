# Codex FinMind status color semantics - 2026-05-05

## Scope

- Page/component: dashboard FinMind Sponsor 999 readiness panel.
- Files changed: `apps/web/app/page.tsx`, `apps/web/app/globals.css`.
- Endpoint/source used: `/api/v1/data-sources/finmind/status`.

## Behavior

- READY FinMind datasets render green.
- BLOCKED / not surfaced datasets render red with the blocker reason.
- The `待接資料集` status pill is now BLOCKED when blocked datasets exist.
- Copy now states that green FinMind readiness does not unlock strategy, paper, or live gates.
- No token value is shown; only token presence/status semantics from the backend diagnostic route.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.
- `git diff --check` PASS for touched files.

## Stop-line proof

- Frontend-only.
- No token, no Railway secrets, no schema/migration, no destructive DB action.
- No KGI write-side, no live submit.
- No fake data; UI only restyles and clarifies existing diagnostic states.
