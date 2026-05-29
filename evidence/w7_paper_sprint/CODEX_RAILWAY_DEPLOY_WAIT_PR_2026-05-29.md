# Codex Railway Deploy Wait PR — 2026-05-29

## Root Cause

GitHub deploy run `26644196362` reported `Deploy to Railway` failure for `web`, but production already served the new portfolio indicator-control HTML. The workflow failed because `railway up` timed out during upload, then the fallback observer waited only 5 minutes while Railway still reported the matched deployment as `BUILDING`.

Observed log pattern:

- `railway up` timed out after upload attempts.
- Fallback found the matching Railway deployment message.
- Status remained `INITIALIZING` / `BUILDING` until the 5-minute observer deadline.
- Workflow exited failure even though production later served the deployed asset.

## Change

- Extend the fallback Railway deployment success observer from 5 minutes to 12 minutes.
- Keep behavior narrow: only affects the path where Railway CLI exits non-zero and the workflow is already checking the matching Railway deployment status.

## Verification

- YAML-only change reviewed against the failed run log.
- Production proof for the motivating deploy:
  - `https://app.eycvector.com/api/ui-final-v031/paper-trading-room?symbol=2330&rev=indicator-prod-check-20260529`
  - Returned new `button.tool[data-layer="ma"]` controls and no old decorative span.

## Scope Guard

- Does not touch product code, backend, migrations, KGI SIM, F-AUTO/S1, contracts, or Lab.
