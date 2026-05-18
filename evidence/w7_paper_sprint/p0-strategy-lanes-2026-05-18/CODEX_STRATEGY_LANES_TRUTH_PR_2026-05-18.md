# Codex P0 Evidence — Strategy Lanes Truth State

## Scope

- Route: `/admin/strategies`
- P0 item: Quant Lab Strategy Lanes readability and red-error overexposure
- Owner lane: frontend Codex
- Scope guard: no IUF_QUANT_LAB edits, no backend/API/schema, no broker/risk/KGI paths

## Production Before

- `prod-admin-strategies-before-v2.png`
- `prod-admin-strategies-before-smoke-v2.json`

Before state:

- Route opened with Owner auth mock for visual verification.
- Page contained alarm terms: `FAIL`, `PHANTOM`, and `Permissions = false`.
- Normal blocked/research states looked like a system-wide red failure.
- Lane cards did not clearly show owner, next action, or recommendation impact.

## Shipped

- Reclassified lanes into clear states:
  - `OWNER REVIEW`
  - `RISK BLOCKED`
  - `RESEARCH PAUSED`
- Added per-lane:
  - owner
  - status reason
  - next action
  - recommendation impact
- Reworded disabled trading permissions as deliberate safety state instead of red failure.
- Reworded retracted claims as `RETRACTED` instead of treating the whole page as broken.
- Removed visible `FAIL`, `PHANTOM`, and `permissions=false` style language from the user surface.

## Local After

- `local-admin-strategies-after-smoke.json`
- `local-admin-strategies-after-desktop.png`
- `local-admin-strategies-after-mobile.png`

Smoke checks:

- route returned 200
- Strategy Lanes title visible
- owner names visible
- next action visible
- recommendation impact visible
- categorized states visible
- no alarm terms on the page surface
- no page errors

## Tests

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Playwright local smoke, desktop 1366x900
- Playwright local smoke, mobile 390x844

## Pending

- Live production smoke after merge/deploy still requires Owner route access; verification uses auth-route interception only to view the Owner-only page, not to fake strategy data.
