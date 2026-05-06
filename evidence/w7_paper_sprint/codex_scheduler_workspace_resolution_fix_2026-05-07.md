# Codex Scheduler Workspace Resolution Fix — 2026-05-07

Status: READY FOR PR

## Why This Matters

Production showed FinMind token presence and Sponsor quota surfaces, but the official FinMind usage counter could still remain at 0 if the backend schedulers never reached FinMind. The likely failure path was workspace resolution:

- API startup used `DEFAULT_WORKSPACE_SLUG ?? "default"` for `startSchedulers(...)`.
- The DB-backed production workspace may be a real slug such as `primary-desk`, not `default`.
- Daily brief dispatcher already had a DB-workspace fix, but FinMind schedulers still received the startup fallback slug.
- When the slug is wrong, `resolveWorkspaceTickers(...)` returns no tickers and the scheduler exits before making FinMind API calls.

## Change

File changed:

- `apps/api/src/server.ts`

Behavior changed:

- Added `resolveDatabaseWorkspaceSlug(fallbackSlug)`.
- If `DEFAULT_WORKSPACE_SLUG` exists and is present in DB, schedulers use it.
- If configured slug is missing, schedulers fall back to the first DB workspace.
- Risk store hydration and all ETL schedulers now use the resolved DB workspace slug after `seedOwnerIfEmpty()`.
- Startup logs which workspace is used for FinMind/OpenAlice schedulers.

## Trade Capability Score

`+1`

This can turn production FinMind automation from a silent no-op into real scheduled ingestion for OHLCV, monthly revenue, financials, institutional flow, margin/short, shareholding, dividend, market value, valuation, stock news, and OpenAlice pipeline ticks.

## Stop-Line Proof

- No token value read, displayed, logged, or written.
- No Railway secret/env edit.
- No migration 0020.
- No schema change.
- No destructive DB action.
- No KGI SDK or broker write-side.
- No order route or `/order/create`.
- No fake data surfaced as live.
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

## Verification After Deploy

Elva/Bruce should verify:

1. API deploy reaches the new commit.
2. API logs contain `[schedulers] Using workspace "..."`
3. Logs no longer repeat `workspace 'default' not found` or `no tickers found` when the DB has companies.
4. FinMind usage counter begins increasing after a scheduler tick.
5. `GET /api/v1/data-sources/finmind/status` reports Sponsor quota and request counters without token values.

