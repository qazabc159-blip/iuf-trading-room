# CODEX Portfolio Timeframe Contract Fix - 2026-05-15

Owner: Frontend Codex
Branch: `fix/web-portfolio-timeframe-contract-2026-05-15`
Scope: `apps/web/public/ui-final-v031/paper_trading_room/index.html`

## Why

PR #514 merged a trading-room timeframe re-fetch, but it sent `interval=5m` and `interval=15m` to `/api/v1/companies/:id/ohlcv`. The current backend schema only accepts `1m`, `1d`, and `1w`, so the 5m/15m buttons would fail at runtime despite green CI.

## Change

- Keep the vendor trading-room UI and layout intact.
- Map 5m and 15m buttons to the supported `1m` API interval.
- Aggregate returned 1m bars client-side into 5m or 15m OHLCV bars before redrawing the chart.
- Remove the heavyweight `/api/v1/companies` fallback from the timeframe click path.
- Use `_companyId` when present; otherwise call OHLCV by ticker, which the backend resolver supports.
- Add a same-origin final-v031 backend proxy with an explicit method/path allowlist.
- Expose `window.__IUF_FINAL_V031_API_PROXY__` so static vendor HTML and final-v031 client refresh fetch through the web server instead of hitting the wrong web origin or cross-origin API directly.
- Add an embedded marker so the paper room iframe waits for live hydration before drawing the first chart, avoiding the stale static 2330 chart path.

## Safety

- No broker/risk/contracts changes.
- No KGI live write path.
- The proxy allowlist includes KGI SIM order only. It does not allow real broker or risk/contract mutation paths.
- No PAPER_LIVE promotion.
- No default live execution mode.
- No OpenAlice import/fork.

## Verification

- PASS: `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- PASS: `git diff --check`
- PASS: static scan found no `PAPER_LIVE`, real broker URL, or `interval=5m` / `interval=15m` fetch path.
- PASS: rendered final-v031 iframe scripts parse with `node:vm` (`scriptCount=3`, `bad=[]`).
- PASS: proxy direct smoke `/api/ui-final-v031/backend?path=/api/v1/companies/6801/ohlcv?interval=1m` returned 200 with 200 bars.
- PASS: Playwright `/portfolio` smoke confirmed final iframe live hydration is active:
  - `window.__IUF_FINAL_V031_LIVE__ === true`
  - `window.__IUF_FINAL_V031_API_PROXY__ === "/api/ui-final-v031/backend?path="`
  - DOM symbol hydrated to `PWRX`
  - 5m and 15m clicks both requested same-origin proxy OHLCV with `interval=1m`
  - both click-triggered OHLCV requests returned 200
  - no direct `localhost:3001` browser fetch and no `interval=5m` / `interval=15m`

Screenshot: `evidence/w7_paper_sprint/CODEX_PORTFOLIO_TIMEFRAME_CONTRACT_2026-05-15.png`

## Residuals

- The KGI read-only positions endpoint returned 500 in local browser smoke, and KGI bid/ask/ticks returned 422 for `PWRX`. These are existing backend/data-contract issues outside this frontend fix and are still handled through soft fallback in the UI.
- Next dev logs a sidebar active-link hydration mismatch on `/portfolio`. It does not block this fix, but Bruce should track it as a separate app-layout QA item.
