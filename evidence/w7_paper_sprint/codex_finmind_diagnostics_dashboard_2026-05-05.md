# Codex — FinMind Diagnostics Dashboard Wire

Date: 2026-05-05
Branch: codex/finmind-diagnostics-dashboard-20260505
Scope: apps/web dashboard source-health panel

## Done

- Added frontend client for `GET /api/v1/diagnostics/finmind`.
- Dashboard now reads both:
  - `/api/v1/data-sources/finmind/status` for dataset readiness.
  - `/api/v1/diagnostics/finmind` for token presence, quota tier, Redis cache, OHLCV source, fetch counters, and error rate.
- `READY` datasets render green.
- `BLOCKED` / freeze / not-surfaced datasets render red.
- `OHLCV_SOURCE !== finmind` renders blocked instead of fake green.

## State Semantics

- LIVE: token present and source diagnostics configured.
- EMPTY: true zero / no in-process fetch record after restart.
- BLOCKED: token missing, diagnostics unavailable, Redis missing, OHLCV source not FinMind, or dataset intentionally frozen.
- HIDDEN: not used in this slice.

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` — PASS.
- `pnpm.cmd --filter @iuf-trading-room/web build` — PASS.
- `git diff --check` — PASS with only existing CRLF warnings.

## Stop-Line Proof

- No token value rendered; only `tokenPresent` boolean and `tokenSource`.
- No Railway secret touched.
- No backend schema, DB migration, KGI, broker write-side, or live submit touched.
- No FinMind data used to claim paper/live/strategy readiness.
- No buy/sell recommendation language added.

## Blocker / Follow-Up

- Authenticated browser smoke still needs a valid session path; Bruce recorded unauth GREEN and auth blocked by owner-only invite.
- Next frontend slice: company page financial/data dock pagination and compact source-state polish so long FinMind tables do not stretch the whole page.
