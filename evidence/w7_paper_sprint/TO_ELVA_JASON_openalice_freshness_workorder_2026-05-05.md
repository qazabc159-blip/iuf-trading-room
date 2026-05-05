# TO ELVA / JASON - OpenAlice freshness work order - 2026-05-05

Status: READY FOR ELVA/JASON DISPATCH

## User-visible problem

Yang saw old information across the site, especially daily brief / OpenAlice-backed content. Frontend PR #178 makes stale state visible, but the actual producer freshness still needs backend / runner action.

## Current implementation read

- `apps/worker/src/jobs/daily-brief-producer.ts`
  - Daily brief producer is OpenAlice-first.
  - If an active OpenAlice device exists, it enqueues a `daily_brief` job.
  - Result lands in `content_drafts` as `awaiting_review`.
  - If no active device exists, worker writes a fallback `daily_briefs` row.
  - Producer skips if today's formal row, today's non-rejected draft, or a pending job already exists.
- `apps/api/src/openalice-bridge.ts`
  - Active device depends on device heartbeat / stale threshold.
  - Expired running jobs can be requeued or failed.
  - `draft_ready` jobs are mirrored into `content_drafts` for supported targets.
- `apps/api/src/content-draft-store.ts`
  - `daily_briefs` is now included in `CONTENT_DRAFT_TARGET_TABLES`.
  - Drafts block duplicate production within the dedupe window unless rejected.

## Likely causes of stale content

Any one of these can make the UI look old:

1. OpenAlice device is not active or not heartbeating.
2. A `daily_brief` OpenAlice job is queued/running/stale and blocking a fresh rerun.
3. A daily brief draft is awaiting review, so no formal `daily_briefs` row appears.
4. Today's formal row already exists but was produced from old source inputs.
5. Worker cron is not firing after deploy, so producers never rerun.

Frontend can reveal these states, but cannot safely mutate jobs/drafts or cron state.

## Jason tasks

1. Add/verify an authenticated diagnostic endpoint that returns:
   - active OpenAlice device count
   - last device heartbeat
   - queued / running / stale / failed `daily_brief` jobs
   - latest formal `daily_briefs.date`
   - latest awaiting-review daily brief draft date
   - latest worker producer route and skip reason
2. Add an ops-safe rerun endpoint only if governance allows:
   - scope: `daily_brief` only
   - no raw OpenAlice token return
   - audit log required
   - reject if current draft/job is younger than a configured safety window
3. Confirm worker cron is deployed and running:
   - route name / schedule
   - last successful run timestamp
   - latest route result: `openalice`, `fallback_local`, `skipped_existing_*`, or error

## Elva / Bruce tasks

1. Bruce production smoke should capture:
   - `/briefs` latest brief date vs Taipei today
   - `/ops` OpenAlice warnings
   - dashboard source rail OpenAlice status after PR #178
2. Elva should decide whether awaiting-review daily brief drafts should show a visible review CTA on `/briefs` for operators.
3. If OpenAlice runner is supposed to be active, Elva should dispatch the runner owner to restart / heartbeat it and record the last heartbeat.

## Codex frontend follow-up

After Jason exposes the diagnostic shape, Codex should wire:

- dashboard OpenAlice source card
- `/briefs` producer route / pending draft / stale job panel
- `/ops` stale OpenAlice job drilldown
- no investment advice wording
- no buy/sell wording

## Stop-lines

- Do not expose OpenAlice device tokens.
- Do not auto-approve drafts.
- Do not generate fake daily briefs in frontend.
- Do not make stale or fallback content look like today's OpenAlice output.
- Do not use FinMind / OpenAlice content as strategy, paper, or live promotion evidence.
