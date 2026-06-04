# Trading Room K-Line Full-History Backfill — 2026-06-04

## Scope

Follow-up to PR #952. The product requirement is not to render a 3-bar chart or merely fall back to a visible sparse state. The trading room and company page must request enough real OHLCV history for a professional K-line surface.

## Root Cause

PR #952 fixed the embedded chart route, but two trading-room live-hydration paths still requested `/ohlcv?interval=1d` without a `from` date. The backend also had short default FinMind backfill windows when callers omitted `from`.

That left a possible split-brain state:

- embedded K-line frame asks for 10 years;
- outer trading-room refresh asks for default short data;
- backend default could still backfill only short history;
- company page still asked for 3 years.

## Shipped

- Backend OHLCV default FinMind backfill now uses 3650 days.
- Trading-room server payload now requests 10 years of daily OHLCV.
- Trading-room client refresh now requests 10 years of daily OHLCV.
- Company page K-line now requests 10 years of daily OHLCV.
- Regression test now guards all four paths.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/contracts build`
- `.\node_modules\.bin\vitest.CMD run lib\final-v031-paper-ticket.test.ts` from `apps/web`
- `pnpm.cmd --filter @iuf-trading-room/web typecheck`
- `pnpm.cmd --filter @iuf-trading-room/api typecheck`
- `pnpm.cmd --filter @iuf-trading-room/web build`
- `pnpm.cmd --filter @iuf-trading-room/api build`

## Notes

No mock K-line rows were added. No KGI live broker write path was touched. This change is specifically about requesting and backfilling full historical real OHLCV depth instead of accepting tiny partial caches.
