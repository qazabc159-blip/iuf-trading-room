# Codex FinMind OHLCV Circuit Abort Repair - 2026-05-07

Status: READY FOR PR
Branch: fix-api-finmind-abort-batch-on-circuit-2026-05-07
Trade Capability Score: +1

## Why This Exists

Production has already proved that FinMind token presence and OHLCV ingestion work. The remaining problem after scheduler budgeting was operational truthfulness: once FinMind returned quota/circuit state, the OHLCV batch could still keep iterating through the rest of the local batch and emit many zero-row ticker lines.

That behavior does not create extra upstream requests after the client circuit opens, but it makes logs and diagnostics look like hundreds of tickers were genuinely attempted. For the trading room, that is misleading. The UI and operators need to know when ingestion stopped because upstream quota protection is active.

## Change

File:

- apps/api/src/jobs/ohlcv-finmind-sync.ts

Behavior:

- Before each ticker sync, read the FinMind client circuit stats.
- If the circuit is open, abort the current OHLCV batch immediately.
- Log one explicit abort line with circuit reason and open-until timestamp.
- Return `tickersAttempted` as the actual processed result count, not the original requested batch size.

## Source / Endpoint Impact

Source:

- Existing FinMind OHLCV scheduler path.
- Existing FinMind client circuit state.

Endpoint/schema impact:

- No public endpoint change.
- No DB schema or migration.
- No Railway env edit.
- No token value read or displayed.

## Verification

Commands:

- `pnpm.cmd --filter @iuf-trading-room/api typecheck` - PASS
- `pnpm.cmd --filter @iuf-trading-room/api build` - PASS
- `git diff --check` - PASS with existing CRLF warning only

## Stop-Line Proof

- No token value displayed, logged, or written.
- No order route touched.
- No KGI SDK or broker write-side touched.
- No migration/schema/destructive DB action.
- No fake live data.
- No strategy metric, Sharpe, win rate, equity curve, or buy/sell recommendation.

## Next After Deploy

Monitor production logs for:

- `[ohlcv-finmind-sync] aborting batch because FinMind circuit is open until ...`
- Scheduler skip lines for other FinMind datasets while the circuit is open.
- After the quota window cools down, verify the next budgeted batch ingests real OHLCV rows instead of re-triggering a full-universe burst.
