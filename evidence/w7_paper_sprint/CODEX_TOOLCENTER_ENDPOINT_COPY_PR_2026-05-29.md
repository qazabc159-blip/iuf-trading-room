# Codex ToolCenter Endpoint Copy PR — 2026-05-29

## Scope

- Frontend-only ToolCenter product truth fix.
- Route: `/admin/tools` and `/tool-center` redirect target.
- Does not touch KGI SIM, S1/F-AUTO, backend broker/risk/contracts, migrations, or `IUF_QUANT_LAB`.

## Problem

Production ToolCenter was readable and did not fake success, but each row still did not make the actual read/audit endpoints obvious enough. This left the page closer to a registry browser than a user-verifiable tool surface.

## Change

- Adds a `真實 endpoint` column to the ToolCenter registry table.
- Shows each tool's owner-only detail endpoint:
  - `GET /api/v1/tools/registry/:toolKey`
- Shows the audit query used for execution evidence:
  - `/api/v1/tools/calls?limit=50&toolKey=:toolKey`
- Keeps execution wording explicit:
  - `backend callTool wrapper`
  - no manual execute button on this page.
- Adds a static regression test so endpoint/callTool truth copy does not disappear again.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web test -- tools-page`

## Browser Evidence

Current production before this PR:

- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_i18n_20260529\packages\qa-playwright\evidence\w7_paper_sprint\admin_tools-prod-toolcenter-qa-20260529.png`
- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_portfolio_i18n_20260529\packages\qa-playwright\evidence\w7_paper_sprint\toolcenter-prod-qa-20260529.json`

Local route could not use production owner cookies because middleware correctly redirects localhost without `iuf_session` to `/login`. Production browser verification should be repeated after merge/deploy with the owner storage state.
