# TO JASON - OpenAlice / Daily Brief Freshness Diagnosis - 2026-05-05

Status: READY FOR ELVA DISPATCH
Owner: Jason / OpenAlice worker lane
From: Codex frontend product owner

## User-visible problem

Several surfaces still show old daily brief / OpenAlice-driven content. The frontend can now label it as `資料過期`, but it cannot produce the new formal row safely.

Affected frontend surfaces now hardened:
- `/briefs`
- `/plans` daily brief sidebar
- `/m` latest daily brief card

## What Codex changed safely

- A daily brief is green only when `daily_briefs.date` equals Taiwan/Taipei today.
- Older rows render as `資料過期` with last data date and age.
- No row is rewritten, generated, or promoted by the frontend.

## Backend / worker facts found in code

1. `apps/worker/src/jobs/daily-brief-producer.ts`
   - Producer sets `today = new Date().toISOString().split("T")[0]`.
   - This is UTC date, not Asia/Taipei date.
   - Around Taiwan early morning, producer can target yesterday's date.

2. `apps/worker/src/openalice-router.ts`
   - Producer route can skip for:
     - recent formal row for same target date
     - non-rejected content draft with same dedupe key
     - queued/running OpenAlice job for same task + target date
   - Active OpenAlice device threshold is 5 minutes by default.
   - If no active device, it falls back to local direct write.

3. `apps/api/src/server.ts`
   - `GET /api/v1/briefs` returns repository daily briefs.
   - It does not expose producer skip reason, latest draft, pending job, or route decision.

4. `apps/api/src/openalice-bridge.ts`
   - Observability currently exposes high-level queue/device counts.
   - It does not explicitly answer "why no fresh daily brief was produced today".

## Likely root-cause classes

- UTC-vs-Taipei date mismatch in producer target date.
- Today's OpenAlice `daily_brief` job queued/running/stale and blocking rerun.
- Today's content draft awaiting review and blocking formal row creation.
- Formal row exists but is draft/stale/old-source and frontend previously treated it as normal.
- Worker cron did not run, or OpenAlice device was not active and fallback did not write as expected.

## Requested Jason deliverables

1. Add or extend an authenticated read-only diagnostic endpoint, e.g.:
   `GET /api/v1/openalice/daily-brief/status`

2. Response should include:
   - `taipeiToday`
   - `producerTargetDate`
   - `latestFormalBriefDate`
   - `latestFormalBriefCreatedAt`
   - `latestFormalBriefStatus`
   - `latestDraftDate`
   - `latestDraftStatus`
   - `queuedDailyBriefJobs`
   - `runningDailyBriefJobs`
   - `staleRunningDailyBriefJobs`
   - `activeDevices`
   - `lastDeviceHeartbeatAt`
   - `lastProducerRunAt` if available
   - `lastProducerRoute` if available
   - `lastSkipReason` if available

3. Fix producer target date to use Asia/Taipei trading-room date if accepted by backend lane.

4. Add a governed rerun path only if Bruce/Elva approve:
   - no frontend button yet
   - no unaudited mutation
   - no overwrite of approved formal rows without review

## Stop-lines

- Do not let Codex/frontend mutate OpenAlice jobs, content drafts, daily brief rows, cron, or DB state.
- No token display.
- No fake daily brief.
- No buy/sell recommendation.
- No strategy/live/paper promotion claim from this data.
