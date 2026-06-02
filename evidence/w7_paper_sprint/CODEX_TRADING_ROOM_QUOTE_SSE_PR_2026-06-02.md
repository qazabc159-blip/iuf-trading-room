# Trading Room Quote SSE Evidence - 2026-06-02

## Scope

- Add a same-origin read-only SSE endpoint for paper trading room quote movement.
- Consume the SSE stream from the final-v031 trading room before falling back to the existing 3s polling pulse.
- Keep the real K-line iframe stable; the quote stream must not reload or replace the chart frame.
- No broker writes, no real-order promotion, no KGI live order path changes.

## Files

- `apps/web/app/api/ui-final-v031/quote-stream/route.ts`
- `apps/web/lib/final-v031-live.ts`
- `packages/qa-playwright/tests/portfolio.spec.ts`

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/qa-playwright typecheck` - PASS
- Local SSE route smoke:
  - URL: `http://127.0.0.1:3041/api/ui-final-v031/quote-stream?symbol=2330`
  - Result: emitted `ready` plus recurring `quote` events every 2s.
  - Because local API service was not running, upstream quote data was correctly marked degraded instead of being faked.
- Local browser SSE consumer smoke:
  - URL: `http://127.0.0.1:3041/api/ui-final-v031/paper-trading-room?symbol=2330&rev=sse-formal-verify`
  - Mock SSE payload changed displayed price to `2,468`.
  - `#real-kline-frame` stayed `/final-v031/portfolio/kline-frame?symbol=2330` before and after the quote update.
  - Screenshot: `evidence/w7_paper_sprint/screenshots/trading-room-local-sse-20260602.png`

## Result

- Trading room can now prefer a persistent browser-visible quote stream.
- If the stream is unavailable or stale, the existing 3s read-only polling pulse remains as fallback.
- The 15s full payload refresh is unchanged and still guarded separately.
