# Heatmap Cold-Start Product Gate — 2026-05-30

## Scope

Root out the transient degraded homepage heatmap state where a cold API/web fetch could briefly render partial core pools such as 23/5/2 tiles before the full representative feed warmed.

## Fix

- Added `hasProductHeatmapCoverage()` with a hard product threshold of 70 unique symbols with verified movement data.
- The homepage no longer renders core/KGI heatmap tiles unless the representative market feed passes that coverage gate.
- If the representative feed is still cold, the homepage force-shows the full-market industry heatmap and displays an explicit warm-up banner instead of partial representative pools.
- The ticker/hero heatmap source also uses the same gate, so no other homepage panel consumes partial core tiles during cold start.

## Browser Evidence

- Cold-start local patched app, production API: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_coldstart_20260530\evidence\w7_paper_sprint\heatmap-coldstart-gated-20260530.png`
- Warm local patched app, production API: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_coldstart_20260530\evidence\w7_paper_sprint\heatmap-warm-core-20260530.png`
- Cold-start JSON: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_coldstart_20260530\evidence\w7_paper_sprint\heatmap-coldstart-gated-20260530.json`
- Warm JSON: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_coldstart_20260530\evidence\w7_paper_sprint\heatmap-warm-core-20260530.json`

Cold-start observed state:
- `activeTab`: `全市場熱力圖`
- `legend`: `TWSE 全市場 · 代表股資料暖機中`
- `coreTiles`: `0`
- `marketWideCells`: `18`
- `requestFailures`: `[]`

Warm observed state:
- `activeTab`: `核心熱力圖`
- `coreTiles`: `39`
- `noDataTiles`: `0`
- `staleTiles`: `0`
- sector counts include `半導體業 13`, `電子零組件 15`, `通信網路 15`, `金融保險 14`, `航運業 13`
- `requestFailures`: `[]`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- heatmap-product-coverage industry-heatmap-representatives`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Browser smoke against `http://localhost:3002` with `NEXT_PUBLIC_API_BASE_URL=https://api.eycvector.com`

## Notes

Console warnings in local browser smoke were existing homepage fetch timing diagnostics. The heatmap gate itself produced no page errors and no failed network requests.
