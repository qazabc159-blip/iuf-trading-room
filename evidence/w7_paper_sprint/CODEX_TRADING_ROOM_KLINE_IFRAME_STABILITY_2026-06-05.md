# Trading Room K-line iframe stability - 2026-06-05

## Problem

Yang reported that the trading-room K-line could still jump, disappear, or show only a tiny partial candle set after symbol changes and live refreshes.

The backend depth fix on the same branch rejects shallow official Taiwan K-line caches. This follow-up fixes the frontend side of the same product issue: the trading-room frame must keep a stable selected symbol and must not reload the embedded company K-line iframe unless the user actually changes symbols.

## Shipped

- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
  - Seeds the embedded real K-line iframe with `data-symbol="2330"`.
  - Seeds `__IUF_REAL_KLINE_FRAME_SYMBOL__` with `2330`.
  - Adds `sameChartSym()` so URL sync and handoff preservation compare normalized symbols instead of raw strings.
  - Prevents a same-symbol URL refresh from reloading the iframe.

- `apps/web/lib/final-v031-live.ts`
  - Seeds `currentPaperSymbol` from URL handoff, selected live payload, or `2330` before quote refresh starts.
  - Normalizes `sameSym()` with `trim().toUpperCase()` so quote pulses and stale refresh guards do not drift on whitespace/casing.

- `apps/web/lib/final-v031-paper-ticket.test.ts`
  - Adds guard coverage for the seeded iframe symbol, normalized chart symbol comparison, and seeded `currentPaperSymbol`.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - PASS
- `apps\web\node_modules\.bin\vitest.CMD run apps/web/lib/final-v031-paper-ticket.test.ts -t "keeps the trading-room K-line iframe stable|drops stale"` - PASS, 2 targeted guards passed
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts --test-name-pattern TRADING-ROOM` - PASS, 536 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web build` - PASS

## Deployment note

GitHub PR creation is pending because external GitHub/Railway actions are temporarily blocked by the current Codex usage limit. The branch is ready to open as soon as tool access is restored:

- Branch: `fix/trading-room-kline-depth-20260605`
- Backend depth commit: `e44da640`
- Frontend stability changes: included in this commit on `fix/trading-room-kline-depth-20260605`
