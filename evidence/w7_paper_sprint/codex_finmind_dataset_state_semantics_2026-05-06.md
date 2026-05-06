# Codex FinMind Dataset State Semantics (2026-05-06)

Trade Capability Score: +1

## Problem

The dashboard FinMind panel counted only `READY` as usable, but the production API now returns DB-backed states such as `LIVE`, `STALE`, `EMPTY`, `FALLBACK`, `DEGRADED`, `BLOCKED`, `ERROR`, `MOCK`, and `CLOSED`.

That mismatch can make Sponsor 999 datasets look like `0` usable even when FinMind-backed K-line, fundamentals, and trading-flow datasets are connected.

## Scope

- `apps/web/lib/api.ts`
- `apps/web/app/page.tsx`

## Behavior

- `LIVE` / legacy `READY` count as normal connected datasets.
- `STALE`, `EMPTY`, `FALLBACK`, `DEGRADED` count as pending/degraded, not false red failure.
- `BLOCKED`, `ERROR`, `MOCK`, `CLOSED` remain blocked.
- The dashboard now renders a FinMind dataset ribbon with label, state, optional row count, and optional latest date.
- Token presence remains boolean-only; no token value is displayed.

## Endpoint / Source

- `GET /api/v1/data-sources/finmind/status`
- `GET /api/v1/diagnostics/finmind`

## Stop-Line Proof

- No token display/logging.
- No KGI/broker write-side.
- No order path.
- No fake live state: each dataset badge reflects API-provided state.
- No directional trade recommendation.
- No strategy metrics.

## Verification

- contracts build: PASS
- web typecheck: PASS
- web build: PASS
- diff stop-line grep: PASS
