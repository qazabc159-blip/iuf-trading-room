# Production Smoke - OpenAlice / FinMind freshness, 2026-05-05

Status: PASS WITH BACKEND FRESHNESS BLOCKER  
Owner: Codex frontend product owner lane  
Checked: 2026-05-05 19:23 Taipei  
Environment: production (`app.eycvector.com`, `api.eycvector.com`)

## Summary

Production is serving the current frontend routes, and FinMind diagnostics endpoints are reachable. OpenAlice infrastructure is alive, but the formal daily brief table is stale: `/api/v1/briefs` still returns only 2 rows and the latest formal brief date is `2026-04-25`.

This means the stale daily-brief content is not a frontend cache illusion. The frontend correctly surfaces the old row as expired; a fresh brief requires the OpenAlice / daily-brief backend pipeline to publish a new source-traced row or expose a skip reason.

## API Probe

Authenticated read-only probe:

- Login: PASS
- `/api/v1/briefs`: PASS, 2 rows
- Latest formal brief date: `2026-04-25`
- `/api/v1/openalice/observability`: PASS
- OpenAlice worker status: `healthy`
- OpenAlice sweep status: `healthy`
- Last sweep: `2026-05-05T11:23:52.838Z`
- `/api/v1/openalice/jobs`: PASS, 529 visible jobs
- Latest visible job status: `draft_ready`
- `/api/v1/data-sources/finmind/status`: PASS
- `/api/v1/diagnostics/finmind`: PASS

## Route Smoke

Authenticated HTML smoke:

- `/`: 200, Traditional Chinese present, FinMind panel present
- `/briefs`: 200, `資料過期` present, OpenAlice panel present
- `/companies/2330`: 200, Traditional Chinese present, FinMind present
- `/market-intel`: 200
- `/signals`: 200
- `/themes`: 200
- `/ideas`: 200
- `/runs`: 200
- `/lab`: 200

## Proofs

- No token value displayed in the probed route HTML.
- No Railway secret or FinMind JWT was printed or stored.
- No live submit / broker write-side / KGI SDK path was touched.
- No migration 0020 or destructive DB action was touched.
- Frontend source state remains truthful: old daily brief rows stay visible as stale/expired rather than being relabeled as current.

## Follow-Up

Backend/OpenAlice owner should expose a small read-only daily-brief status contract, e.g.:

- `lastFormalDate`
- `lastDraftStatus`
- `lastJobStatus`
- `lastSkipReason`
- `workerStatus`
- `sweepStatus`
- `nextEligibleRunAt`

Frontend can then show exactly why the brief is stale instead of only saying that the formal row is old.
