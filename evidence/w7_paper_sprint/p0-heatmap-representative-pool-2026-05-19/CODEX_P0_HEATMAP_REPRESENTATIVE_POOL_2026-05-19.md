# P0 Heatmap Representative Pool Gate

Date: 2026-05-19
Owner: Codex frontend

## Shipped In This PR

- Home core heatmap now uses a fixed Taiwan representative-stock pool instead of silently shrinking to the few backend tiles that happen to have quotes.
- Visible groups now have fixed representative counts:
  - 核心觀察池: 40
  - 半導體業: 12
  - 電子零組件: 13
  - 電腦及週邊設備: 13
  - 通信網路: 12
  - 金融保險: 12
  - 鋼鐵工業: 12
  - 航運業: 12
- Added Chinese company-name fallback for representative tickers so the UI no longer renders `2330 / 2330`.
- Missing quote data remains honest: representative stocks without a backend quote render as gray `暫無資料` tiles with `sourceState="no_data"` and do not fabricate price or percent move.

## Browser Verification

Verified URL:

`http://127.0.0.1:3133/?codexHeatmap=p0-representative-pool-20260519`

Screenshots:

- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_p0_20260519\evidence\w7_paper_sprint\p0-heatmap-representative-pool-2026-05-19\local-core-representative-pool.png`
- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_p0_20260519\evidence\w7_paper_sprint\p0-heatmap-representative-pool-2026-05-19\local-semiconductor-representative-pool.png`
- `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_p0_20260519\evidence\w7_paper_sprint\p0-heatmap-representative-pool-2026-05-19\local-communication-representative-pool.png`

Browser gate summary:

- `coreCount=40`
- `semiconductorCount=12`
- `communicationCount=12`
- `duplicateTickerNames=[]`
- `noDataTiles=34`
- `badResponses=[]`
- `requestFailures=[]`
- Console: no page crash; one generic local `404 Not Found` resource message observed, plus existing homepage fetch timing warnings.

Raw browser result:

`C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_heatmap_p0_20260519\evidence\w7_paper_sprint\p0-heatmap-representative-pool-2026-05-19\local-browser-verify.json`

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web test -- app/components/industry-heatmap-representatives.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`

## Still Broken / Next P0

The user screenshot also shows the market-intel official news panel with a large empty region. This PR does not touch that panel. Next P0 should shrink the empty state and surface AI selected news/source state instead of leaving a blank product area.
