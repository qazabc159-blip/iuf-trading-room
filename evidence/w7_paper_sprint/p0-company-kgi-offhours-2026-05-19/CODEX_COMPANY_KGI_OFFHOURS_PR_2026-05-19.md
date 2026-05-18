# Codex P0 Company KGI Off-hours Gate - 2026-05-19

## Scope
- Page: `/companies/2330`
- Task: stop company-page KGI five-level quote and tick panels from calling known unavailable KGI quote endpoints outside the documented TST trading window.
- No backend edits, no broker write paths, no mock quote/tick data.

## Endpoints
- Still live during KGI trading hours:
  - `GET /api/v1/kgi/quote/bidask?symbol=...`
  - `GET /api/v1/kgi/quote/ticks?symbol=...&limit=20`
- Outside the window, frontend does not call those endpoints and renders a formal `BLOCKED` state with:
  - source endpoint
  - owner `Jason/Bruce`
  - next open time
  - explicit no-fake-data wording

## Verification
- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `pnpm.cmd --filter @iuf-trading-room/web test -- apps/web/lib/kgi-trading-hours.test.ts`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- Local browser smoke on `http://127.0.0.1:3024/companies/2330?codexLocal=offhours2`

## Browser Evidence
- Screenshot: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_company_p0_20260519\evidence\w7_paper_sprint\p0-company-kgi-offhours-2026-05-19\local-company-kgi-offhours.png`
- JSON: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP_company_p0_20260519\evidence\w7_paper_sprint\p0-company-kgi-offhours-2026-05-19\local-browser-verify.json`
- Result:
  - route status `200`
  - `hasCompany2330=true`
  - `hasBlockedPanels=true`
  - `hasOffhoursCopy=true`
  - `kgiQuoteRequestCount=0`
  - `badKgiResponses=[]`
  - `consoleKgiErrors=[]`

## Note
The local browser smoke points the local web app at production API, so unrelated CORS warnings may appear for other client-side company panels. This PR's gate is verified at request level: the company page did not call the KGI bidask/ticks endpoints outside trading hours.
