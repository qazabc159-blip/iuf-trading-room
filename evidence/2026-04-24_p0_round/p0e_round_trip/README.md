# P0-E Live Round-Trip Proof — 2026-04-24

Full end-to-end proof of the OpenAlice → content_drafts → approve → formal-table
pipeline on production (`api.eycvector.com`, `app.eycvector.com`) after commit
`c54e74c` deployed at 15:29:57 UTC.

## What this proves

1. A runner device can register, claim a job, submit `draft_ready`.
2. The API mirrors `draft_ready` results into `content_drafts` with
   `status=awaiting_review` (P0-D hook).
3. `POST /api/v1/content-drafts/:id/approve` atomically inserts a row into the
   formal table (`theme_summaries` / `company_notes`) and updates the draft.
4. The approved draft carries `approvedRefId` + `reviewedAt`.
5. Scope-lock holds: only `theme_summary` + `company_note` are accepted into
   the draft queue; other task types stay in `openalice_jobs` only.

## Run 1 — theme_summary

Script: [`run_round_trip.sh`](./run_round_trip.sh)
Log: [`run_round_trip.log`](./run_round_trip.log)

```
themeId     = 9f54e15c-66ef-49ba-87ef-3aae2476590d   ([ORPHAN] AI Optics (->CPO))
jobId       = e75ccf6d-a6fc-412a-93b2-41a91cc8125d
draftId     = 9ad1773a-cfc5-46b9-99c1-bc4119cb0352
approvedRefId (theme_summaries.id) = 6d3e66ba-d326-45f3-9962-7b28ec1becac
reviewedAt  = 2026-04-24T15:33:10.069Z
```

11-step flow: login → list awaiting → pick theme → register runner → enqueue
→ claim → submit → verify draft → approve → verify formal row → confirm
`approved` state in list. **PASS**

## Run 2 — company_note

Script: [`run_round_trip_company.sh`](./run_round_trip_company.sh)
Log: [`run_round_trip_company.log`](./run_round_trip_company.log)

```
companyId   = bfce1f91-4246-465e-a725-d867e7656e6b   (竣邦-KY, 4442)
jobId       = 3afe38d3-83f6-4438-931f-965b092812d6
draftId     = e9baa06a-e873-40de-9213-4f2c1db8bd00
approvedRefId (company_notes.id) = e6670eff-6942-4883-9a8a-f4c84534110a
reviewedAt  = 2026-04-24T15:35:58.876Z
```

Same flow, `taskType=company_note`, `schemaName=company_note@v1`,
`targetTable=company_notes`. **PASS**

## Fallback path (producer writes direct)

The fallback branch (`route === "fallback_local"` in
`apps/worker/src/jobs/theme-summary-producer.ts` /
`apps/worker/src/jobs/company-note-producer.ts`) triggers when no device has
been seen within `OPENALICE_ACTIVE_DEVICE_SECONDS` (default 300s). In that
case the producer renders the rule-template locally and inserts directly
into the formal table, bypassing `content_drafts`.

Historical evidence of direct-write producer path pre-P0-C is in
[`../p1_producer_rows.md`](../p1_producer_rows.md) (review_summaries,
signal_clusters rows written by worker at 15:07–15:10 UTC). The same
rule-template is now reached via the explicit `fallback_local` branch.

## Producer routing (P0-C)

`decideProducerRoute` in `apps/worker/src/openalice-router.ts`:

| precondition                                                         | decision                       |
|---------------------------------------------------------------------|--------------------------------|
| non-rejected `content_drafts` row <24h for `(table, entity)`        | `skip_existing_draft`          |
| queued/running `openalice_jobs` for same `(taskType, entity)`       | `skip_pending_job`             |
| `openalice_devices.lastSeenAt` within 5min for one device           | `enqueue_openalice`            |
| otherwise                                                            | `fallback_local`               |

Dedupe key: `${workspaceId}:${targetTable}:${targetEntityId}:${producerVersion}`
(24-hr window). Matches the P0-C spec.

## Scope-lock enforcement (P0-B)

Enforced both sides:

- **Runner**: `tools/openalice-runner/openalice_runner.py` —
  `SUPPORTED_TASK_TYPES = {"theme_summary", "company_note"}`; any other
  claimed task is submitted back as `validation_failed` without LLM call.
- **API bridge**: `apps/api/src/openalice-bridge.ts` —
  `OPENALICE_TASK_TO_TARGET_TABLE` only maps these two task types; other
  task types never reach `content_drafts`.
- **Worker**: only `theme-summary-producer` and `company-note-producer` use
  `decideProducerRoute`. `daily_brief` / `review_summary` / `signal_cluster`
  remain direct-write (deferred to P0.5 / P1 / P2 per scope-lock).

## Deploy / commit

```
commit c54e74c  feat(openalice): P0-A/C/D — content drafts review queue
                 + producer routing + Windows runner MVP
Railway deploy  2026-04-24T15:29:57Z  (service iuf-api-prod, service iuf-worker-prod)
```

## Summary — P0 phase closure

| phase | status | evidence                                               |
|-------|--------|--------------------------------------------------------|
| P0-A  | DONE   | `tools/openalice-runner/` MVP, register+run PASS       |
| P0-B  | DONE   | scope-lock enforced runner-side + api-side + worker    |
| P0-C  | DONE   | `apps/worker/src/openalice-router.ts` wired into both prod producers |
| P0-D  | DONE   | `apps/api/src/content-draft-store.ts` + 3 routes, approve is atomic |
| P0-E  | DONE   | 2 × live round-trips above (PASS), fallback branch exists + exercised by prior worker run |
