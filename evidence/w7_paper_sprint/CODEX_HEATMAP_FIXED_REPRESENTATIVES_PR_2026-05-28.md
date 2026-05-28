# CODEX_HEATMAP_FIXED_REPRESENTATIVES_PR_2026-05-28

## Scope

- Page: homepage Taiwan heatmap (`/`, core Taiwan heatmap).
- Files changed:
  - `apps/web/app/page.tsx`
  - `apps/web/app/components/industry-heatmap.tsx`
  - `apps/web/app/components/industry-heatmap-representatives.test.ts`
  - `apps/web/app/globals.css`
- Did not touch Market Intel, company coverage, KGI SIM, `apps/api/src/server.ts`, `tests/ci.test.ts`, contracts, migrations, PR #757, or `IUF_QUANT_LAB`.

## Root Cause

The homepage chose `coreHeatmap` whenever the 40 KGI core feed existed. That feed is intentionally small and does not contain the full fixed 10-15 representative ticker pool for each industry. The industry heatmap then injected synthetic `sourceState="no_data"` rows for missing representatives, so users saw too few real stocks plus gray empty blocks.

## Fix

- Keep the fixed representative pools intact.
- Build the real market representative feed from `/api/v1/market-data/overview`.
- Merge KGI core quotes with that representative feed:
  - KGI live quote values can update price / pct.
  - market overview rows preserve Chinese company names, sectors, and representative coverage.
- Do not render synthetic `no_data` rows as gray treemap tiles.
- If an individual representative has no verifiable quote in either feed, show the count in the footer instead of drawing fake data.
- Tighten label density so small tiles do not overlap.

## Browser Evidence

Patched local web (`http://127.0.0.1:3000`) using production API:

- Core pool screenshot:
  - `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_daily_smoke_fix_20260528\evidence\w7_paper_sprint\heatmap-fixed-representatives-local-all-20260528.png`
  - visible tiles: 37 / fixed pool: 40 / gray no-data tiles: 0 / duplicate ticker-name tiles: 0
- Semiconductor screenshot:
  - `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_daily_smoke_fix_20260528\evidence\w7_paper_sprint\heatmap-fixed-representatives-local-semiconductor-20260528.png`
  - visible tiles: 10 / fixed pool: 12 / gray no-data tiles: 0 / duplicate ticker-name tiles: 0
- Communication screenshot:
  - `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_daily_smoke_fix_20260528\evidence\w7_paper_sprint\heatmap-fixed-representatives-local-communication-20260528.png`
  - visible tiles: 12 / fixed pool: 12 / gray no-data tiles: 0 / duplicate ticker-name tiles: 0
- Finance screenshot:
  - `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_daily_smoke_fix_20260528\evidence\w7_paper_sprint\heatmap-fixed-representatives-local-finance-20260528.png`
  - visible tiles: 11 / fixed pool: 12 / gray no-data tiles: 0 / duplicate ticker-name tiles: 0

Browser console/network:

- console errors: 0
- failed requests: 0

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web test -- industry-heatmap` - 186/186 pass
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - pass
