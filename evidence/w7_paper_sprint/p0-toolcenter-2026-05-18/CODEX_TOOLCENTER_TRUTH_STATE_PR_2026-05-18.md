# P0 ToolCenter Truth State - 2026-05-18

## Scope

P0-12 ToolCenter frontend productization. This change only updates `apps/web/app/admin/tools/page.tsx` and adds evidence/memo files. It does not modify backend schema, migrations, broker/risk code, KGI paths, live-order behavior, or the tactical homepage layout.

## Problem

Production `/tool-center` redirects to `/admin/tools`, but the page did not clearly show:

- which real endpoints power the page;
- whether tools are executable, only registered, disabled, or still awaiting execution proof;
- Owner-only permission requirements;
- latest execution evidence from `tool_calls`;
- what to do when owner-session reads are blocked.

The before-smoke also showed the page could render as “同步中” with no endpoint details when the owner-only ToolCenter endpoints were not readable.

## Shipped

- Added ToolCenter endpoint truth cards for:
  - `/api/v1/tools/registry`
  - `/api/v1/tools/calls?limit=50`
  - `/api/v1/tools/stats?window=24h`
- Added explicit `Owner-only`, owner, and next-action copy.
- Added readiness labels:
  - `可執行，有成功紀錄`
  - `可執行但需檢查`
  - `可執行，需觀察`
  - `已登錄，待執行證據`
  - `未啟用`
- Added per-tool last-run evidence from recent calls and 24h stats.
- Added formal blocked/empty states so the page does not show a blank table or pretend success.
- Added mobile-safe horizontal table wrappers.
- Added top-level copy: “此頁沒有手動執行按鈕”.

## Verification

- `pnpm.cmd install --offline --frozen-lockfile`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `git diff --check`
- Local browser smoke:
  - desktop `1366x900`
  - mobile `390x844`
  - `/tool-center` redirects to `/admin/tools`
  - endpoint strings visible
  - Owner-only copy visible
  - manual-execute disabled copy visible
  - readiness/blocked state visible
  - no page errors

## Evidence

- Before production smoke: `prod-toolcenter-before-smoke.json`
- Before production screenshot: `prod-toolcenter-before.png`
- Local after smoke: `local-toolcenter-after-smoke-v2.json`
- Local desktop screenshot: `local-toolcenter-desktop-after-v2.png`
- Local mobile screenshot: `local-toolcenter-mobile-after-v2.png`

## Remaining owner work

With dummy cookies the local page correctly shows blocked owner-session state. Bruce still needs to run owner-session production verification so ToolCenter can show live registry/calls/stats rather than blocked state. If owner-session still fails, Jason owns backend auth/route behavior for the three ToolCenter endpoints.
