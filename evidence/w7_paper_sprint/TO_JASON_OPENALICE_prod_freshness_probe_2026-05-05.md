# TO JASON — OpenAlice Production Freshness Probe

Status: READY FOR BACKEND / OPENALICE OWNER
Created: 2026-05-05 18:52 Taipei
Owner requested context: site and OpenAlice data still look old.

## Production Probe Result

API health:
- `https://api.eycvector.com/health` returned 200.
- API service started at `2026-05-05T10:32:16.143Z` (2026-05-05 18:32 Taipei).

Authenticated OpenAlice checks:
- `/api/v1/openalice/observability` returned healthy Redis-backed worker state.
- `workerStatus`: `healthy`.
- `workerHeartbeatAt`: `2026-05-05T10:48:29.788Z`.
- `sweepStatus`: `healthy`.
- `lastSweepAt`: `2026-05-05T10:48:29.788Z`.

Daily brief data:
- `/api/v1/briefs` returned only 2 formal rows.
- Latest formal brief row: `2026-04-25`, created `2026-04-25T00:52:04.224Z`.
- Previous formal brief row: `2026-04-24`, created `2026-04-24T12:41:38.504Z`.

OpenAlice jobs:
- `/api/v1/openalice/jobs` returned 528 jobs.
- Latest visible jobs in API response are still `draft_ready` rows from 2026-04-24.

## Interpretation

OpenAlice runner/worker heartbeat is alive, but formal daily brief publishing is stale.

This is not a frontend rendering freshness bug anymore. The frontend can only show the latest formal brief row returned by `/api/v1/briefs`. If that endpoint only returns `2026-04-25`, the UI must show stale/overdue state and must not pretend there is a 2026-05-05 brief.

Likely backend-side causes to inspect:
- Daily brief producer did not enqueue or publish a formal `daily_briefs` row after 2026-04-25.
- Producer skipped because an existing draft/job state blocked rerun.
- `daily-brief-producer.ts` target-date logic may still use UTC date rather than Asia/Taipei trading-day date.
- API lacks a single daily-brief producer status endpoint that explains `lastFormalDate`, `lastDraftDate`, `lastJobStatus`, `lastSkipReason`, and `nextEligibleRunAt`.

## Requested Backend Contract

Please add a read-only endpoint:

`GET /api/v1/openalice/daily-brief/status`

Suggested response shape:

```json
{
  "data": {
    "state": "live | stale | blocked | missing",
    "todayTaipei": "2026-05-05",
    "lastFormalDate": "2026-04-25",
    "lastFormalCreatedAt": "2026-04-25T00:52:04.224Z",
    "lastDraftDate": null,
    "lastDraftStatus": null,
    "lastJobId": null,
    "lastJobStatus": null,
    "lastSkipReason": "formal_row_stale_but_no_new_publish | queued_job_exists | draft_waiting_review | device_missing | rate_limited | unknown",
    "workerStatus": "healthy",
    "workerHeartbeatAt": "2026-05-05T10:48:29.788Z",
    "nextEligibleRunAt": null
  }
}
```

Frontend behavior after endpoint exists:
- `live`: show current daily brief with source trail.
- `stale`: show old formal brief with explicit age and warning.
- `blocked`: show blocker, owner, next eligible run.
- `missing`: show no brief and the exact missing-source reason.

## Stop-Line

Do not fabricate a new daily brief in frontend.
Do not mark OpenAlice as current merely because the worker heartbeat is healthy.
Do not generate buy/sell recommendations or strategy promotion claims from OpenAlice text.
