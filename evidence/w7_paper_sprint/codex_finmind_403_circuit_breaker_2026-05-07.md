# Codex FinMind 4xx Circuit Breaker — 2026-05-07

Status: READY FOR PR

## Production Observation

After #247 deployed successfully, API logs confirmed schedulers now use the real DB workspace:

- `[schedulers] Using workspace "primary-desk" for FinMind/OpenAlice schedulers.`
- `[ohlcv-scheduler] Starting sync for 3469 tickers (workspace=primary-desk)`

That proved the previous blocker was fixed. The next blocker surfaced immediately: FinMind returned many `HTTP 403` responses for official datasets. Token values stayed redacted in logs.

## Root Risk

Once schedulers started reaching FinMind, a bad entitlement/token state or accidental oversized boot sweep could keep issuing thousands of 4xx requests. FinMind can temporarily block clients after repeated 4xx. Continuing to hammer the upstream would make data recovery worse.

## Change

Files changed:

- `apps/api/src/data-sources/finmind-client.ts`
- `apps/api/src/server.ts`

Behavior changed:

- Added process-local FinMind 4xx circuit breaker.
- Opens circuit on 4xx responses, including:
  - `403` upstream forbidden / possible temporary block.
  - `402` quota/limit style failures.
  - `429` rate-limit exhaustion after retries.
- While circuit is open, `_fetch(...)` returns empty without making more upstream HTTP calls.
- Circuit metadata is exposed in `GET /api/v1/data-sources/finmind/status` health block:
  - `circuitOpen`
  - `circuitOpenUntil`
  - `circuitReason`
  - `circuitDataset`
  - `circuitOpenedAt`
  - `circuitSkipCount`
  - `forbiddenCount`
- OHLCV scheduler now respects `FINMIND_KILL_SWITCH=true`.

## Trade Capability Score

`+1`

This directly protects FinMind ingestion and gives the operator a truthful diagnostic state instead of letting production flood upstream with rejected requests.

## Stop-Line Proof

- No token value displayed, logged, committed, or written.
- No Railway secret/env edit.
- No migration/schema change.
- No destructive DB action.
- No KGI SDK or broker write-side.
- No order route or `/order/create`.
- No fake live data.
- No buy/sell recommendation or strategy promotion.

## Checks

- `pnpm.cmd --filter @iuf-trading-room/contracts build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/db build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/domain build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/integrations build` PASS.
- `pnpm.cmd --filter @iuf-trading-room/api typecheck` PASS.
- `pnpm.cmd --filter @iuf-trading-room/api build` PASS.
- `git diff --check` PASS with CRLF warning only.
- Code-only stop-line grep PASS.

## Next Verification

After deploy:

1. Confirm API logs no longer stream repeated FinMind 403 lines after the first circuit open.
2. Confirm `/api/v1/data-sources/finmind/status` reports `state=DEGRADED` and `health.circuitOpen=true` while circuit is active.
3. Confirm token value remains absent from logs/DOM/evidence.
4. Determine whether 403 is from token validity, Sponsor entitlement mismatch, temporary IP block, or dataset-specific restrictions.

