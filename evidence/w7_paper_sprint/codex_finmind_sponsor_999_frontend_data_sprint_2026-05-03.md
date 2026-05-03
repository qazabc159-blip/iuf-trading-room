# Codex FinMind Sponsor 999 Frontend/Data Sprint

Date: 2026-05-03
Owner: Codex frontend real-data lane
Status: ACTIVE

## Executive Decision

FinMind Sponsor 999 is useful enough to change the IUF Trading Room roadmap immediately.

It should be treated as a production-grade research/product data source for Taiwan stock pages, dashboard context, daily brief input, and Quant Lab intake. It does not solve KGI broker submit, does not approve any live order, and does not prove strategy profitability.

## Source References Reviewed

- FinMind GitHub: `https://github.com/FinMind/FinMind`
- FinMind Taiwan market dataset list: `https://finmind.github.io/tutor/TaiwanMarket/DataList/`
- FinMind API usage count: `https://finmind.github.io/api_usage_count/`
- FinMind analysis dashboard example: `https://finmindtrade.com/analysis/#/dashboards/taiwan-stock-analysis`
- Internal Sponsor brief: `C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\evidence\w7_paper_sprint\TO_ELVA_CODEX_finmind_sponsor_999_integration_brief_2026-05-03.md`

The official dataset list covers technical, chip, fundamental, derivative, realtime, convertible-bond, and other Taiwan-market datasets, including daily price, adjusted price, tick, PER/PBR, 5-second order/trade statistics, KBar, week/month price, margin/short, institutional buy/sell, shareholding, financial statements, balance sheet, cash flow, dividends, monthly revenue, market value, realtime snapshots, and Taiwan stock news.

## Useful To Us

### High immediate value

- Company page can become a real analysis page instead of a thin master-data shell:
  - Daily adjusted OHLCV
  - KBar / intraday intake once API model is added
  - Monthly revenue
  - Institutional buy/sell
  - Margin/short
  - Dividends
  - Financial statement summary
  - Market value / PER / PBR
  - Official source state and freshness
- Dashboard can become a Taiwan-market command deck:
  - Real market data status
  - Data freshness and degraded-state rail
  - Candidate lists powered by source availability
  - No fake market tape or fake news
- Daily brief can become an AI-ready data packet:
  - Market summary
  - Top signals
  - Important disclosures/news candidates
  - Missing-data warnings
  - Later OpenAlice generation on top of real inputs
- Quant Lab can move from placeholder to source-intake status:
  - MAIN daily lane: price, revenue, institutional, margin, dividend
  - FAST intraday lane: KBar intake and missing-minute audits
  - MID lane: 15m/30m/60m aggregation from accepted KBar

### Medium-term value

- Strategy bundle evidence can include source coverage, missing-row diagnostics, and replayable input manifests.
- Company pages can use FinMind-like breadth while keeping IUF design sharper and more readable than the reference dashboard.
- News/major-message surfaces can eventually use `TaiwanStockNews` and/or official TWSE disclosures, but current freeze says no deferred RSS/commercial news feature yet.

## Hard Product Rules

1. Source truth remains mandatory: every visible dataset is `LIVE`, `EMPTY`, `BLOCKED`, `STALE`, or `HIDDEN`.
2. FinMind data must never be presented as broker execution readiness.
3. No mock fallback may visually look like live market data.
4. API quota must be read from FinMind `user_info` / `api_request_limit` when surfaced; do not hardcode plan limits into production UI.
5. Token must never appear in browser, logs, evidence, GitHub, or screenshots.
6. Order ticket must preserve Taiwan unit semantics:
   - `零股` means shares.
   - `整張` means lots.
   - 1 張 = 1,000 股.
   - A 1-share odd-lot order must never be converted into 1 board lot.

## Immediate Engineering Plan

### P0: Stabilize current web deploy

- Keep finishing UI density/Traditional Chinese/source-truth repair.
- Fix Railway deploy only through safe build/runtime diagnosis; do not touch Railway secrets.
- Continue production smoke after each merge.

### P1: API source diagnostics

Add an authenticated read-only endpoint:

`GET /api/v1/data-sources/finmind/status`

Expected shape:

```json
{
  "source": "FINMIND",
  "tokenPresent": true,
  "quota": {
    "used": null,
    "limit": null,
    "source": "user_info"
  },
  "datasets": [
    { "key": "TaiwanStockPriceAdj", "state": "LIVE", "implemented": true },
    { "key": "TaiwanStockKBar", "state": "BLOCKED", "implemented": false }
  ],
  "updatedAt": "2026-05-03T14:38:00.000Z"
}
```

Rules:

- Authenticated only.
- Read-only.
- No token echo.
- Fail closed into `BLOCKED`, not fake success.

### P2: KBar API model

- Add `TaiwanStockKBar` typed adapter in `apps/api/src/data-sources/finmind-client.ts`.
- Do not wire it into live trading.
- Start with response-only/cache-only path.
- Add tests for token missing, zero rows, 402/429-style limit, 403 banned/blocked, and malformed row.

### P3: Company page data panels

Prioritize:

1. K-line and quote source/freshness.
2. Monthly revenue.
3. Institutional buy/sell.
4. Margin/short.
5. Dividend.
6. Financial statement summary.
7. News/disclosures only after freeze allows a non-RSS official/news route.

### P4: Dashboard as real-data homepage

Replace vague visual panels with:

- Market source health.
- FinMind/TWSE/API freshness.
- Candidate availability.
- Blocking reasons.
- Today data packet status.

### P5: Daily brief data framework

Create the brief input structure now:

- Market summary inputs.
- Company/news/disclosure candidates.
- Signal count and source coverage.
- Missing-data warnings.
- AI generation remains future backend/OpenAlice work and must be labeled as not generated when absent.

### P6: Quant Lab source status only

Until backend emits accepted strategy bundles, show:

- Data lanes.
- Intake freshness.
- Dataset coverage.
- Missing/blocked reasons.

Do not show invented Sharpe, equity curve, win rate, or drawdown.

## Current Codex Patch In Flight

First cycle was scoped to company-page usability and landed through PR #130:

- K-line now shows latest close, change, visible-range high/low, volume, row count, and date context.
- Company hero quote timestamp now includes date and time, not time-only.
- Company-side simulated ticket is tightened and labeled as `委託票（模擬）`.
- The order ticket keeps explicit Taiwan unit semantics and no live broker submit.

Validation:

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS.

Second cycle is scoped to read-only API readiness:

- `FinMindClient.getStockKBar(stockId, date)` maps official `TaiwanStockKBar` rows.
- `GET /api/v1/data-sources/finmind/status` exposes authenticated source diagnostics without returning token material.
- Dataset status includes implemented vs blocked FinMind surfaces for web source-truth UI.

Validation:

- `node --import tsx --test apps/api/src/data-sources/finmind-client.test.ts` PASS, 11/11.
- `pnpm.cmd run build:api` PASS.

## Blockers

- KGI `libCGCrypt.so` remains the live-submit blocker only.
- KBar is verified in Sponsor smoke but not yet integrated into Trading Room API model.
- `/api/v1/lab/bundles` still needs backend implementation before Quant Lab can show real performance bundles.
- News expansion must wait until freeze permits the non-RSS/non-commercial-data path.
