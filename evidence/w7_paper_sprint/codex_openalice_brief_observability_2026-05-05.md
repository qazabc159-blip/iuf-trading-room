# Codex OpenAlice Brief Observability - 2026-05-05

Status: READY FOR REVIEW

## Scope

- Page: `apps/web/app/briefs`
- Endpoints:
  - `GET /api/v1/daily-briefs`
  - `GET /api/v1/openalice/observability`

## Change

- Added an OpenAlice production-status panel to the daily brief surface.
- The page now shows whether the AI brief pipeline is `正常`, `過期`, or `暫停`.
- The panel exposes worker status, sweep status, last heartbeat age, last sweep age, queued jobs, running jobs, stale running jobs, and active devices.
- Old daily briefs remain old. The UI does not rewrite stale content or pretend the brief is current.

## Semantics

- `正常`: worker and sweep are both healthy.
- `過期`: either worker or sweep is stale, but the observability endpoint is readable.
- `暫停`: observability is missing/blocked or the endpoint cannot be read.

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS, only CRLF normalization warning

## Stop-line Proof

- No token value displayed.
- No fake brief generated.
- No buy/sell recommendation text added.
- No backend schema / migration / DB changes.
- No KGI write-side or live submit path touched.
