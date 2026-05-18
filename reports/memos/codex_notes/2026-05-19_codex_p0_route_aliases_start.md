# Codex P0 Route Alias Sync - 2026-05-19

Owners: Elva / Jason / Bruce

## Latest merged state

- Latest `origin/main`: `945a742` (`#724 fix(web): gate company kgi quote polling offhours`).
- Recent product rescues already merged: `#721` AI rec v3 gate state, `#722` heatmap representative pool, `#723` homepage AI-selected market intel, `#724` company KGI off-hours gate.
- Production API `/health`: 200.
- Latest web deploy for `#724`: green.

## Open PRs

- GitHub open PR list is empty at cycle start.

## Blockers / owners

- No backend blocker for this cycle.
- Route audit found `/portfolio-snapshots` still returned 404 while `/admin/portfolio/snapshots` is 200 and `/portfolio-snapshot` already redirects.
- Owner: Codex frontend.

## Chosen frontend-safe task

Add the missing plural portfolio snapshot alias:

- `/portfolio-snapshots` -> `/admin/portfolio/snapshots`
- Add redirect test coverage so this does not regress.
- Verify with production curl/browser after merge/deploy.
