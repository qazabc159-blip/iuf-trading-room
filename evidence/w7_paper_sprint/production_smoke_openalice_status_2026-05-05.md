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

## Frontend Follow-Up Patch

Codex added a `/briefs` OpenAlice recent-jobs panel using the already-existing read-only `GET /api/v1/openalice/jobs` endpoint.

It displays:

- latest task type
- job status
- created / updated time
- attempt count
- error text if present

This is not a publishing action and does not review, approve, reject, or mutate OpenAlice jobs. It only makes the stale daily-brief chain inspectable from the UI while the formal daily brief row remains old.

## Production Follow-Up After PR #190

Checked: 2026-05-05 19:56 Taipei

PR #190 deployed successfully to the web service. Authenticated production smoke on `/briefs` confirmed:

- `每日簡報`
- `OpenAlice 最近任務`
- `只讀佇列`
- `資料過期`
- old formal brief date `2026-04-25`

No FinMind JWT, password, Railway secret, or token-like value appeared in the probed HTML. The page still keeps the old formal row marked expired; a recent OpenAlice job is not treated as a current published brief.

## Draft Gate Follow-Up

Checked locally before PR: 2026-05-05 20:06 Taipei

Codex added a second `/briefs` read-only surface: `每日簡報草稿閘門`, powered by the existing `GET /api/v1/content-drafts?status=awaiting_review&limit=100` endpoint. The frontend filters `targetTable === "daily_briefs"` locally because the production endpoint currently does not reliably narrow by `targetTable`.

The new surface separates three states:

- formal brief freshness: still based only on `/api/v1/briefs`
- OpenAlice job health: based on `/api/v1/openalice/jobs`
- daily brief draft review gate: based on `/api/v1/content-drafts`

This makes the actual stale-data chain visible: OpenAlice can produce draft-ready work while the formal daily brief remains old until a review/publish path writes a new official row. The patch is read-only and does not approve, reject, publish, or mutate drafts.
