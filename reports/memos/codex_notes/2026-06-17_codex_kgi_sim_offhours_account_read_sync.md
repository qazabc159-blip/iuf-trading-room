# Codex Sync - KGI SIM Account Reads After Hours

Date: 2026-06-17

## Latest State

- Main includes PR #1089 KGI SIM quote/fill reconciliation and PR #1090 theme-stale alert fix.
- Gateway EC2 is running.
- Correct watchdog can log in with AWS SSM credentials.
- The old startup login task is stale and disabled.

## Open PRs To Avoid

- #1091: frontend audit batch, currently Playwright red.
- #1092: Jason backend audit batch, currently running.

This task stays scoped to KGI SIM account-read connectivity and does not touch their frontend/audit batch work.

## Blocker / Owner

Owner: Codex for API account-read guard scope.

The account credentials are not the blocker. They exist in AWS SSM and were usable by the watchdog. The blocker is API-side: the scheduled quote guard blocks account reads after hours.

## Chosen Task

Allow KGI SIM account-read endpoints to bypass the quote scheduled-off guard, while preserving the guard for quote/UI fast-fallback paths.

## Acceptance

- Local API typecheck passes.
- Full test suite passes.
- Production deploy succeeds.
- Production KGI SIM positions/balance/orders/funds endpoints return true account-read state after hours.
- S1 orders remain unconfirmed unless KGI trades/deals/events confirm fills.
