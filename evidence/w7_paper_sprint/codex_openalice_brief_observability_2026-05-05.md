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
- Follow-up hardening: the daily brief page now compares the latest `daily_briefs.date` against Taiwan/Taipei today.
- A brief is green only when the data date is today. Older rows are shown as `資料過期` with the last data date and age.
- Stale briefs get an explicit warning that OpenAlice worker / daily brief pipeline must write a new source-traced row.
- Shared freshness helpers now drive `/briefs`, `/plans`, and `/m` so the same stale daily brief cannot look current from another surface.

## Semantics

- `正常`: worker and sweep are both healthy.
- `過期`: either worker or sweep is stale, but the observability endpoint is readable.
- `暫停`: observability is missing/blocked or the endpoint cannot be read.
- `今日資料`: latest formal brief date equals Taipei today.
- `資料過期`: latest formal brief exists but is older than Taipei today.
- `無資料`: no formal brief rows returned.
- `/plans` and `/m` show the same `資料過期` / `今日資料` language when they preview the latest daily brief.

## Tests

- `pnpm.cmd --filter @iuf-trading-room/web typecheck` PASS
- `pnpm.cmd --filter @iuf-trading-room/web build` PASS
- `git diff --check` PASS, only CRLF normalization warning

## OpenAlice stale-data diagnosis

- The frontend is not the source of old copy. It is reading the latest rows currently returned by `GET /api/v1/daily-briefs`.
- If the site still shows 4/22 or 4/25 style content, that means the OpenAlice / daily brief producer chain has not written a newer formal row, or a draft/job is blocking the producer from creating one.
- Safe next owner: Jason/OpenAlice worker lane should expose producer skip reason, latest formal row date, latest draft date, queued/running/stale job counts, and a governed rerun path.
- Codex can continue to expose freshness and source trail in the UI, but will not mutate jobs, drafts, cron, or database state from the frontend lane.

## Stop-line Proof

- No token value displayed.
- No fake brief generated.
- No buy/sell recommendation text added.
- No backend schema / migration / DB changes.
- No KGI write-side or live submit path touched.
