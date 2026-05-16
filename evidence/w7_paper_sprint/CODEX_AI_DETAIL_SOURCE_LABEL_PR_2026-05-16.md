# CODEX AI Detail Source Label PR - 2026-05-16

Cycle: 2026-05-16 22:26 Asia/Taipei

## Scope

- Frontend-only follow-up for `/ai-recommendations/[id]`.
- Changed the detail page source label from `live` / `mock fallback` to the same neutral source vocabulary used by the list page:
  - `ORCHESTRATOR` for backend/orchestrator data.
  - `FALLBACK FEED` for mock fallback data.
- No portfolio handoff behavior changes.
- No API, broker, risk, shared-contract, or Lab edits.

## Why

The detail page rendered backend data as `live`, which can read like a live trading or live broker signal. The page is an AI recommendation detail view and should describe data provenance without implying live execution readiness.

## Verification

- `pnpm.cmd install --frozen-lockfile --prefer-offline` passed.
- `pnpm.cmd --filter @iuf-trading-room/contracts build` passed.
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` passed.
- Browser smoke passed on `http://127.0.0.1:3046/ai-recommendations/rec_2330_20260516` with local mock Recommendation Orchestrator on `127.0.0.1:3101`.

Browser assertions:

- HTTP status `200`.
- Detail shell contained `AI` and `Recommendation Orchestrator`.
- Source line contained ` / ORCHESTRATOR`.
- Ticker `2330` rendered.
- Portfolio handoff link existed and stayed prefilled:
  - `/portfolio?ticker=2330&prefill=true&from_rec=rec_2330_20260516&entry=910-925&stop=885&tp=950`
- No ` / live`, `mock fallback`, `PAPER_LIVE`, real-order, or broker-submit wording appeared in the detail body.
- No browser console errors.
- No page errors.
- No failed browser requests.

Screenshot:

- `evidence/w7_paper_sprint/ai-detail-source-label-1366x900.png`

Note: `gstack browse` was attempted first, but it repeatedly returned only server startup lines and no page text/status in this Windows session. The browser smoke was completed with Python Playwright instead.

## Safety

- This PR is label-only.
- It does not add or promote live execution paths.
- It does not default any execution mode to live.
- It does not touch KGI broker code, API broker/risk/contracts, Lab code, or shared contracts.
