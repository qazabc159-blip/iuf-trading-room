# Codex Evidence - Trading Room K-line Viewport Tools

Date: 2026-06-03
Branch: fix/trading-room-kline-interactions-20260603

## Scope

Frontend-only follow-up for the Trading Room K-line workbench. This PR adds visible, deterministic viewport controls so the user can intentionally zoom, widen, jump back to latest bars, or fit the full data range instead of relying only on hidden mouse-wheel gestures.

## Shipped

- Added `K 線視窗控制` with `放大`, `縮小`, `回最新`, and `全覽`.
- The controls call the real Lightweight Charts logical range API, not a decorative UI state.
- The visible bar count is shown as `顯示 n / total 根`.
- The trading-room iframe keeps the new controls compact and inside the chart region without reintroducing horizontal overflow.
- The existing indicator strip remains data-driven: MA/EMA/VWAP/support-resistance/RSI/MACD are still computed from OHLCV/K-bar inputs.

## Files Changed

- `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`
- `apps/web/app/final-v031/portfolio/kline-frame/page.tsx`
- `apps/web/lib/final-v031-paper-ticket.test.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`
  - 28 files passed
  - 248 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
  - passed
- `pnpm.cmd --filter @iuf-trading-room/web build`
  - passed
  - Existing Sentry/OpenTelemetry dynamic import warning remains unrelated to this change.
- `git diff --check`
  - no whitespace errors; only Windows CRLF conversion warnings.

## Browser Note

Local unauthenticated browser verification cannot assert the live chart controls because the trading-room K-line iframe correctly refuses to fabricate chart bars when owner-protected company/K-line endpoints return 401. The controls render when `chartBars.length > 0`; this is intentional because the product must not show fake K-line data just to satisfy a screenshot.

Owner-session production verification should be rerun after merge/deploy against `/portfolio` or `/api/ui-final-v031/paper-trading-room?symbol=2330`.

## Hardline Check

- No backend endpoints touched.
- No broker/risk/contracts touched.
- No fake live data introduced.
- No KGI live broker write path touched.
- No tactical homepage redesign.
