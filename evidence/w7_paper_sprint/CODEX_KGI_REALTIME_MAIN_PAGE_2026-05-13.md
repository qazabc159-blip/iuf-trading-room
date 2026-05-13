# Codex KGI Realtime Main Page Wire — 2026-05-13

## Scope

- Frontend-only wire for homepage market overview and heatmap source routing.
- No backend schema changes.
- No broker write path, order CTA, token, secret, workflow, or migration touched.

## Changed Files

- `apps/web/lib/api.ts`
- `apps/web/app/page.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/app/main-market-wire.css`

## Data Source Order

### 大盤指數

1. Primary: `GET /api/v1/market/overview/kgi`
2. Fallback: `GET /api/v1/market/overview/twse`
3. Legacy fallback: existing `getMarketDataOverview({ includeStale: true })`

UI labels:

- KGI-live path displays `即時`.
- TWSE/EOD path displays `今日收盤` or `昨日收盤` based on the Taipei date of the returned timestamp.
- Failure fallback displays `即時連線維護中，目前顯示昨日收盤`.

No UI string exposes backend enum names or endpoint names.

### 熱力圖

1. Default tab: `核心熱力圖`
   - Primary: `GET /api/v1/market/heatmap/kgi-core`
   - Fallback: existing FinMind/market heatmap.
2. Secondary tab: `全市場熱力圖`
   - Source: `GET /api/v1/market/heatmap/twse`
   - UI label: `全市場 · 今日收盤` / `全市場 · 昨日收盤`.

Current TWSE backend payload is industry-aggregated, so the all-market tab renders industry cells with:

- area = stock count
- color = average change percentage
- tooltip = up / flat / down counts

## Fallback Behavior

- KGI endpoint unavailable or not yet landed: homepage continues rendering with TWSE/EOD and existing market-data fallback.
- TWSE unavailable: homepage falls back to existing FinMind/market data and shows maintenance wording.
- Timeout is treated as blocked/degraded, never fake-green.

## Safety Boundary

- Paper/live order paths untouched.
- No KGI write-side or `/order/create`.
- No fake bars or TradingView scraping.
- New code only consumes read-only backend endpoints.

## Test Results

- `pnpm --filter web typecheck` — PASS
- `pnpm --filter web lint` — PASS
- `pnpm --filter web test` — PASS
- `pnpm --filter web build` — PASS

Note: the first lint run was started in parallel with `next build` and hit a transient `.next/types` missing-file race. A clean rerun after build completed passed.
