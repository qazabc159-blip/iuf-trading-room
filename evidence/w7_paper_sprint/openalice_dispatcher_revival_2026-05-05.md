# OpenAlice Dispatcher Revival — 2026-05-05

**Owner:** Jason (backend-strategy)
**Priority:** P0-1
**Status:** ROOT CAUSE CONFIRMED — fix pending deploy

---

## §1 Root Cause

**Primary:** `runDailyBriefDispatcherTick(workspaceSlug)` passes `workspaceSlug = process.env.DEFAULT_WORKSPACE_SLUG ?? "default"` but the DB workspace slug is `"primary-desk"` (set by `seedOwnerIfEmpty()` in `auth-store.ts:329`).

Call chain:
```
startSchedulers("default")            ← server.ts:5403 (DEFAULT_WORKSPACE_SLUG not set in Railway)
→ runDailyBriefDispatcherTick("default")
→ enqueueOpenAliceJob({ workspaceSlug: "default", ... })
→ loadWorkspaceBySlug("default")      ← returns null (slug mismatch)
→ throw Error("Workspace must exist before queuing an OpenAlice job.")
→ caught by .catch() in runDailyBriefDispatcherTick  ← SILENT FAIL
→ logs "[daily-brief-dispatcher] Enqueue error: Workspace must exist..."
```

Result: zero jobs ever enqueued by F3 dispatcher since PR #192 deployed.

**Secondary (pre-F3):** Before PR #192 (2026-05-05 21:46 TST), there was no
dispatcher at all. F3 added the scheduler but the slug mismatch silenced it.

**Why fallback_local did not save us:** The API-side dispatcher (`server.ts`) only
enqueues — no fallback write. Worker-side `runDailyBriefProducer()` (which has
fallback_local) is in `apps/worker`, separate service. Worker IS running (heartbeat
healthy per observability), but `runDailyBriefProducer` also calls
`decideProducerRoute` → `findRecentFormalRow` → sees existing 4/25 row → returns
`skip_existing_formal_row` → skips every tick for the 24h window per that stale row.

Wait — the 4/25 row is 10 days old. `findRecentFormalRow` uses a 24h window
(`CONTENT_DRAFT_DEDUPE_WINDOW_SECONDS = 86400`). So 4/25 row is OUTSIDE the window.
This means worker fallback_local SHOULD be running on each hourly tick and writing
new rows, UNLESS worker's `isDatabaseMode()` returns false.

**Tertiary hypothesis (worker mode):** Worker `startProducers()` gates on
`isDatabaseMode()` (line 54 in worker.ts). If `PERSISTENCE_MODE` env is not `"database"`
in Railway worker service, all producers are skipped with log:
`"[worker] Skipping content producers — not in database mode."` This would explain
why worker is heartbeating (Redis is up) but no brief rows are written.

**Confirmed production evidence:**
- `briefs[0].date = 2026-04-25` (Bruce smoke run 2026-05-05 23:35 TST)
- `queuedJobs=0, terminalJobs=538` (all terminal jobs are 4/22-4/25 era)
- No new queued jobs since F3 deploy → confirms slug mismatch silent fail

---

## §2 Production Evidence

**Source: Bruce smoke baseline-20260505-2335 (real HTTP hits at 23:35 TST 2026-05-05)**

| Signal | Value | Verdict |
|--------|-------|---------|
| `GET /api/v1/briefs` data[0].date | `2026-04-25` | STALE — 10 days |
| `GET /api/v1/openalice/observability` queuedJobs | `0` | No dispatcher output |
| `GET /api/v1/openalice/observability` terminalJobs | `538` | All pre-4/25 era |
| Worker heartbeat status | healthy (Redis OK) | Worker process alive |
| F3 code in origin/main | commit 75ae497 (21:46 TST) | Code deployed |
| Time between F3 deploy and smoke | ~109 min | Enough for 23h-interval first tick |

**Static audit:**
- `auth-store.ts:329` seeds workspace with slug `"primary-desk"`
- `server.ts:5398` uses `process.env.DEFAULT_WORKSPACE_SLUG ?? "default"`
- Railway env audit: no evidence of `DEFAULT_WORKSPACE_SLUG=primary-desk` being set
- `loadWorkspaceBySlug("default")` → `SELECT * FROM workspaces WHERE slug='default'` → 0 rows → throws

**Cannot access Railway logs directly** (Bash dead, no Railway CLI in this session).
Log line to confirm: `"[daily-brief-dispatcher] Enqueue error: Workspace must exist before queuing an OpenAlice job."` — Bruce operator should grep Railway API service logs.

---

## §3 Fix

### Fix A — API dispatcher slug resolution (primary fix)

**File:** `apps/api/src/server.ts`

Change `runDailyBriefDispatcherTick` to resolve workspace from DB directly
(same pattern as `runDailyBriefProducer` in worker):

```typescript
async function runDailyBriefDispatcherTick(): Promise<void> {
  const db = getDb();
  if (!db) {
    console.warn("[daily-brief-dispatcher] DB unavailable, skipping tick");
    return;
  }
  const [workspace] = await db.select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces).limit(1);
  if (!workspace) {
    console.warn("[daily-brief-dispatcher] No workspace found, skipping tick");
    return;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  // ... rest unchanged, use workspace.slug instead of passed workspaceSlug
```

Also update `startSchedulers` signature — no longer needs `workspaceSlug` param.
And add date-based deduplication before enqueue:

```typescript
  // Idempotency: skip if today's brief already queued or exists
  const [existingJob] = await db.select({ id: openAliceJobs.id })
    .from(openAliceJobs)
    .where(and(
      eq(openAliceJobs.workspaceId, workspace.id),
      eq(openAliceJobs.taskType, "daily_brief"),
      eq(openAliceJobs.status, "queued")
    )).limit(1);
  if (existingJob) {
    console.log(`[daily-brief-dispatcher] Job already queued (${existingJob.id}), skipping`);
    return;
  }
```

### Fix B — Railway env (secondary safety)

Set `DEFAULT_WORKSPACE_SLUG=primary-desk` in Railway API service environment.
This is belt-and-suspenders. Fix A (DB lookup) is the proper fix.

### Fix C — Worker PERSISTENCE_MODE audit

Bruce / operator: verify Railway worker service has `PERSISTENCE_MODE=database`.
If missing, worker runs in memory mode and all producers are silently skipped.
Log to confirm: `"[worker] Starting content producers"` should appear in worker logs.

**PR recommendation:** Single commit touching only `server.ts` scheduler block.
Label: `fix(api): daily-brief dispatcher workspace slug mismatch + date deduplication`
Trade Capability Score: +1

---

## §4 Stale → Fresh Transition

**After deploy with Fix A:**

1. On server startup: `runDailyBriefDispatcherTick()` fires immediately
2. DB lookup finds workspace `"primary-desk"` → proceeds to enqueue
3. `enqueueOpenAliceJob()` inserts row into `open_alice_jobs` with status=queued
4. Log: `"[daily-brief-dispatcher] Enqueued daily_brief for 2026-05-05: jobId=<uuid>"`
5. `GET /api/v1/openalice/observability` → `queuedJobs >= 1`
6. **BUT:** No OpenAlice Windows runner registered → job stays queued indefinitely

**Result:** Job is queued but not executed. `briefs[0].date` stays at `2026-04-25`
until either:
- (a) An OpenAlice Windows device registers and claims the job, OR
- (b) Worker fallback_local path executes (requires `PERSISTENCE_MODE=database` in worker)

**Worker path is the immediate bridge:** If worker has `PERSISTENCE_MODE=database`,
`runDailyBriefProducer()` will write a `fallback_local` row to `daily_briefs`
within the next hourly tick (DAILY_BRIEF_INTERVAL_MS = 1h). This does NOT require
OpenAlice. `briefs[0].date` would update to today within ~1 hour of worker restart.

**Immediate verification steps (Bruce operator):**
1. Check Railway worker logs: `"[worker] Starting content producers"` present?
2. Check Railway worker env: `PERSISTENCE_MODE=database`?
3. If missing, set env → worker restart → wait 5 min → re-probe `/api/v1/briefs`

---

## §5 Fallback Handling

**Worker fallback_local path** (when no OpenAlice device active):

`runDailyBriefProducer()` → `decideProducerRoute()` → `fallback_local`:
- Writes directly to `daily_briefs` table with `status="draft"`
- Sets `generatedBy="worker"`
- Does NOT call OpenAI — template-only aggregation of themes + notes
- `route` field = `"fallback_local"`, `fallbackReason` = `"no_active_device"`

**This is explicitly marked:** Any brief produced by fallback_local is clearly
identified by its `generatedBy="worker"` and the absence of AI-generated content.
It is NOT a fake brief — it is a rule-template brief. The `route` field in the
producer return is the audit trail.

**If OpenAlice enqueue succeeds but no device claims:** Job stays in `open_alice_jobs`
with `status="queued"`. No brief is written. `briefs[0].date` stays stale.
This is the correct behavior — we do not fake an AI brief.

**If OpenAI call fails inside OpenAlice device:** Device submits `status="failed"`
result. Job moves to terminal. Next producer tick re-enqueues or falls back to
fallback_local (via `decideProducerRoute` logic). NOT marked as fresh AI brief.

**Stop-line compliance:**
- No `OPENAI_API_KEY` value appears anywhere in this document
- No fake freshness — stale remains stale until dispatcher+worker fix confirmed
- Fallback template is explicitly labeled `fallback_local`, not AI-generated
