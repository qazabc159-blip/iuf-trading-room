# Trading Room K-line depth cache fix — 2026-06-05

## Problem

Yang reported that the trading room could still render only a few candles, e.g. three monthly bars for 2330, even though this is not acceptable for a customer-facing product.

Production diagnostic before the code change showed the owned K-line database was already deep enough:

- 2330: 2,438 real daily bars, first date 2016-06-04, latest date 2026-06-05
- 6202: 2,436 real daily bars
- 1514: 2,437 real daily bars
- 1259: 2,437 real daily bars
- diagnostic state: READY

That means the product-visible short chart was not a database coverage problem. The remaining risk was stale/shallow cache or shallow derived weekly/monthly rows being accepted before the chart could read deep daily history.

## Shipped

- `apps/api/src/companies-ohlcv.ts`
  - Added `isOfficialTaiwanOhlcvRequest`.
  - Added `needsOwnedDepthBackfill`.
  - Shallow cached official Taiwan K-line responses now bypass cache even when FinMind token state changes.
  - Weekly/monthly official Taiwan K-lines now use owned daily depth derivation whenever stored weekly/monthly rows are too shallow.
  - Shallow official daily rows no longer pass as a product chart merely because the FinMind token is unavailable.

- `apps/web/lib/final-v031-paper-ticket.test.ts`
  - Updated the trading-room K-line guard from token-centric `cachedNeedsFinMindBackfill` to product-depth-centric `cachedNeedsOwnedBackfill`.
  - Added a regression guard so shallow cached weekly/monthly K-lines cannot be accepted as the formal trading-room chart.

- `apps/web/public/ui-final-v031/paper_trading_room/index.html`
  - Seeded the real K-line iframe with `data-symbol="2330"` and `__IUF_REAL_KLINE_FRAME_SYMBOL__="2330"` so the first client hydration does not start from an unknown chart symbol.
  - Added `sameChartSym()` and used normalized symbol comparison for handoff preservation and URL sync. This prevents a same-symbol URL refresh from being treated as a different chart and reloading the iframe.

- `apps/web/lib/final-v031-live.ts`
  - Seeds `currentPaperSymbol` from URL handoff, selected live payload, or `2330` before quote refresh starts.
  - Normalizes symbol comparison with `trim().toUpperCase()` so stale refresh payloads and quote pulses cannot drift because of whitespace/casing.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `pnpm.cmd exec node --import ./tests/setup-test-env.mjs --import tsx --test ./tests/ci.test.ts --test-name-pattern TRADING-ROOM` — PASS, 536 tests passed
- `pnpm.cmd --filter @iuf-trading-room/web build` — PASS

Known unrelated local Vitest drift when trying `pnpm.cmd --filter @iuf-trading-room/web test -- final-v031-paper-ticket`:

- `companies` registry test still expects no full fallback after PR #1006 intentionally added a real full-company fallback.
- `subscription-entitlements` tests expect old labels `價格待設定` / `已包含` while current product copy returns `價格待定` / `完整開放`.

These are not caused by this K-line change.

## Pending

- After merge and deploy, run production browser verification on `/api/ui-final-v031/paper-trading-room?symbol=2330` and at least one non-core stock such as `1514`.
- Next product step: continue improving trading-room live price pulse and visual layout after K-line depth is no longer blocked by stale shallow cache.
