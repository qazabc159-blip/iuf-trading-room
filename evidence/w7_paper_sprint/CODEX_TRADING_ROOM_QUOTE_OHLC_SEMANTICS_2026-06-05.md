# Codex Evidence - Trading Room Quote OHLC Semantics

Date: 2026-06-05
Branch: fix/trading-room-kline-interactions-20260605

## Scope

Root-cause fix for trading-room quote/OHLC instability:

- The trading-room initial payload and client-side symbol refresh previously reused `quote.lastPrice` as `selected.open`.
- That made the top quote strip misleading after symbol changes, because "open" could become the latest trade price.
- `/api/v1/companies/:id/quote/realtime` parsed TWSE MIS OHLC/prevClose internally but did not return those fields to the web app.

## Changes

- `apps/api/src/server.ts`
  - TWSE MIS quote fallback now returns `open`, `high`, `low`, `prevClose`, and `changePct`.
  - TWSE OpenAPI EOD fallback now returns `open`, `high`, `low`, `prevClose`, and `changePct` from official `STOCK_DAY_ALL`.
- `apps/web/lib/api.ts`
  - `CompanyRealtimeQuote` now exposes optional OHLC/prevClose/change fields.
- `apps/web/lib/final-v031-live.ts`
  - Added one canonical server-side resolver: `resolveTradingRoomQuoteSnapshot`.
  - Added one matching client-side resolver: `resolvePaperQuoteSnapshot`.
  - Server-render and client refresh now use the same priority order:
    - last price: quote lastPrice -> latest OHLCV close -> selected position cost
    - open/high/low: quote OHLC -> latest OHLCV OHLC -> last price fallback
    - previous close: quote prevClose aliases -> previous OHLCV close
    - change/changePct: computed from lastPrice and previous close, then quote fallback
- `apps/web/lib/final-v031-paper-ticket.test.ts`
  - Added guard preventing `open = quote.lastPrice` regression.
  - Updated stale company-registry guard so Lite remains primary while full-list is allowed only as fallback.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `apps\web\node_modules\.bin\vitest.CMD run apps/web/lib/final-v031-paper-ticket.test.ts` - PASS, 43/43
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS

## Not Changed

- No KGI live broker writes.
- No real-order path promotion.
- No fake K-line data.
- No F-AUTO/S1 strategy logic.

