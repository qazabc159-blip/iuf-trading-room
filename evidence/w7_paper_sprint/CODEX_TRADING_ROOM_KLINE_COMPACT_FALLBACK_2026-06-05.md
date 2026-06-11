# Trading Room compact K-line sparse interval fallback - 2026-06-05

## Problem

Yang reported that the trading-room K-line could still show only three monthly candles after selecting `月K`. Even when the backend has thousands of official daily bars, the product must not leave the user staring at a sparse aggregate view.

## Shipped

- `apps/web/app/companies/[symbol]/OhlcvCandlestickChart.tsx`
  - In trading-room compact mode, if a non-daily interval has fewer than the minimum trend bars while daily bars are available, the chart automatically returns to `1d` + `all`.
  - This keeps the trading-room chart usable instead of displaying a sparse 3-candle monthly/weekly view.

- `apps/web/lib/final-v031-paper-ticket.test.ts`
  - Extends the trading-room K-line guard so this sparse non-daily fallback cannot be removed accidentally.

## Verification

- `apps\web\node_modules\.bin\vitest.CMD run apps/web/lib/final-v031-paper-ticket.test.ts -t "does not replace the trading-room chart"` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS
