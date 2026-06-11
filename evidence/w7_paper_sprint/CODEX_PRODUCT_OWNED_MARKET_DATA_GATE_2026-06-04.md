# Codex Product-Owned Market Data Gate — 2026-06-04

## Scope

Bounded product rescue for the homepage/trading-room market data quality issues Yang flagged:

- Full-market heatmap must not stay blank when the TWSE industry feed is cold.
- Trading-room/company K-line quality must be owned by our database, not discovered as shallow 3-bar charts in the browser.
- Homepage TAIEX mini-chart must not disappear when MIS live index overlay replaces the stale daily index object.

## Shipped

1. Added `/api/v1/diagnostics/kline-depth`.
   - DB-only diagnostic for owned `companies_ohlcv` daily bar depth.
   - Requires 720 real 1d bars per symbol before declaring READY.
   - Reports `READY`, `SHALLOW`, `STALE`, `EMPTY`, or `MISSING_COMPANY`.

2. Added an OHLCV deep-backfill lane to the existing scheduler.
   - Finds underfilled or stale 1d K-line symbols from our DB.
   - Runs small FinMind deep backfill batches with `FINMIND_OHLCV_DEEP_BACKFILL_BATCH_SIZE`.
   - Uses a 10-year lookback (`3650` days) so product charts become owned DB data after warmup.

3. Fixed full-market heatmap blank state.
   - If TWSE industry rows are unavailable, the homepage derives all-market industry rows from verified representative heatmap tiles.
   - Uses only real tiles with finite `pct`, no fake placeholders.
   - Labels the source as owned representative aggregation.

4. Restored a real TAIEX mini-chart path.
   - MIS index cron now accumulates same-day 1-minute OHLC bars from official TWSE MIS index ticks.
   - `/api/v1/market-data/overview` merges existing daily index history with the same-day intraday index history.
   - Volume is included only when the upstream row exposes a usable numeric volume field; no fake volume.

## Verification

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` — PASS
- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS
- `apps/web`: `.\node_modules\.bin\vitest.CMD run lib\final-v031-paper-ticket.test.ts` — 38/38 PASS
- `node --import ./tests/setup-test-env.mjs --import tsx --test ./apps/api/src/market-data-overview.test.ts` — 2/2 PASS
- `git diff --check` — PASS, only CRLF warnings

## Note

`pnpm.cmd test -- market-data-overview.test.ts` in this repo still executes the whole root CI bundle and surfaced an unrelated existing `MIS-UNIVERSE-1` source guard failure. The targeted market-data test above passes.

## Still Pending

- Prod/browser verification after PR deploy.
- Longer-term: persist index OHLCV to DB instead of process-memory only. This requires a schema lane and should be coordinated with Mike/Jason, not slipped into this no-migration rescue.
