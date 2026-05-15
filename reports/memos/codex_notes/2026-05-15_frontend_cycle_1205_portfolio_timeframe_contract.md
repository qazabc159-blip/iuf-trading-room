# Frontend Codex Sync - Portfolio Timeframe Contract

Date: 2026-05-15
Cycle: 12:05 TST
Owner lane: apps/web

## Latest main / PR state

- `origin/main` has advanced through #510, #515, #513, #514, and #516.
- #516 is now merged, so the coverage wikilinks backend key is available for company-page follow-up QA.
- #514 is also merged, but review found a product regression: the trading-room timeframe buttons send `interval=5m` and `interval=15m` to `/api/v1/companies/:id/ohlcv`, while the current API schema only accepts `1d`, `1w`, and `1m`.
- #513 duplicated the company-page order-panel removal already shipped in #515. No further frontend action needed unless Elva wants cleanup of duplicate evidence wording.

## Current frontend-safe action

Patch the merged #514 timeframe implementation:

- Use API-supported intervals only: `1m`, `1d`, `1w`.
- For 5m and 15m buttons, fetch 1m data and aggregate client-side into 5/15 minute OHLCV bars.
- Remove the large `/api/v1/companies` fallback from the click path. If `_companyId` is missing, call OHLCV by ticker because the backend resolver supports UUID or ticker.
- Add a same-origin final-v031 backend proxy and expose it on `window.__IUF_FINAL_V031_API_PROXY__`, so vendor-frame click handlers and client refresh do not hit the web origin or trip browser CORS.
- Add an embedded marker so the iframe does not draw the static 2330 chart before live hydration is installed.

## Coordination

- Elva: this is a follow-up hotfix against merged #514, not a new design pass.
- Jason: no API change requested. If true native 5m/15m endpoints are added later, the frontend map can be widened.
- Bruce: please re-smoke `/portfolio` timeframe buttons after merge, especially 5m/15m and mobile viewport.

## Safety

- No broker, risk, contract, or KGI live write path changes.
- The proxy has an explicit method/path allowlist. SIM order remains `/api/v1/kgi/sim/order` only; no live broker route is allowed.
- No homepage/vendor layout rewrite.
- Paper/SIM wording and no-real-order audit remain in scope for CI.
