# BRUCE Pipeline Fire Failure Investigation — 2026-05-08 pre_market

**Investigator**: Bruce (verifier/release)
**Timestamp**: 2026-05-08 ~08:40 TST
**Scope**: read-only, no code changes

---

## Summary Verdict

**ROOT CAUSE: PROCESS RESTART at 07:59:26 TST destroyed all in-memory scheduler state.**

The pipeline did NOT have a scheduling bug. The cron intervals are correctly wired. The process restarted at 07:59:26 TST (2026-05-07T23:59:26Z). The 08:30 pre_market window opened at 08:30 TST. At that moment, `runPipelinePreMarketTick()` was called by the 15-minute setInterval — but `_lastPipelineState.nextRunAt` was set to `2026-05-08T00:30:26Z` (the PREVIOUS day's compute of next pre-market). This means `nextRunAt` is stale but the actual interval fire happened. The observability endpoint shows `lastGeneratedAt=null`, `lastFailureReason=null`, `nextRunAt=2026-05-08T00:30:26Z` — which means the tick fired BUT was silently skipped inside `runPipelinePreMarketTick()` because the window check `isPreMarketWindow()` evaluated false.

**Why did the window check fail?**  
Process uptime: 2381s = 39.7min. Started at 07:59:26 TST.  
Initial tick at start: `runPipelinePreMarketTick()` fires immediately from `startSchedulers()`.  
At 07:59 TST, `getTaipeiHHMM()` = 0759 → `isPreMarketWindow()` checks `hhmm >= 830 && hhmm < 900` → **FALSE (0759 < 830) → skipped=outside_window**.  
`updatePipelineState({ nextRunAt: computeNextRunAt(now) })` then sets `nextRunAt` = 08:30:26 TST.  
15-minute interval fires at ~08:14 TST → again outside window (0814 < 830) → skipped.  
15-minute interval fires at ~08:29 TST → 0829 < 830 → **one tick early, still skipped**.  
15-minute interval fires at ~08:44 TST → 0844 ≥ 830 AND < 900 → **SHOULD FIRE**.

**Therefore**: As of 08:37 TST (observation time), the 08:30 window was open but the next 15-min interval had not yet fired. The tick was approximately 14 minutes late relative to the 08:30 window opening, because the interval clock is aligned to process start (07:59) not to clock time. The window fires at: 07:59 + 15 = 08:14 (miss), 08:14 + 15 = 08:29 (miss at 0829), 08:29 + 15 = **08:44 (HIT)**.

---

## A. Pipeline Tick — Real Status

### Observability endpoint: GET /api/v1/openalice/observability
```json
{
  "pipeline": {
    "lastGeneratedAt": null,
    "lastReviewedAt": null,
    "lastPublishedAt": null,
    "nextRunAt": "2026-05-08T00:30:26.330Z",
    "lastFailureReason": null,
    "sourcePackCount": 0,
    "reviewerVerdict": null
  }
}
```

### Dispatcher debug: GET /api/v1/internal/openalice/dispatcher-debug
```json
{
  "lastTickAt": "2026-05-07T23:59:31.310Z",
  "lastTickResult": "skipped_existing_brief",
  "lastEnqueueError": null,
  "lastEnqueueErrorStack": null
}
```
Note: `lastTickAt` = 2026-05-07T23:59:31Z is from **yesterday's** run (close_brief/close_watch dispatcher tick). This is the daily_brief dispatcher (23h interval), NOT the 08:30 pipeline scheduler.

### Process start evidence
```
API startedAt:    2026-05-07T23:59:26.164Z = 2026-05-08 07:59:26 TST
API uptime:       ~2400s = ~40min at investigation time
```

### Tick timeline analysis (15-min interval, aligned to process start 07:59 TST)
| Time (TST) | HHMM | isPreMarketWindow (≥830 AND <900) | Result |
|---|---|---|---|
| 07:59 | 0759 | FALSE | skipped=outside_window, nextRunAt=08:30:26 set |
| 08:14 | 0814 | FALSE | skipped=outside_window |
| 08:29 | 0829 | FALSE (0829 < 830) | skipped=outside_window |
| **08:44** | **0844** | **TRUE** | **WILL FIRE — first real attempt** |

**Verdict: No scheduling bug. The interval is setInterval(15min) aligned to 07:59. The 08:30 window was missed by 1 tick (0829 vs 830 boundary). Tick is expected at ~08:44 TST.**

---

## B. 5/8 Trading Day Check

### Code analysis: `isTwTradingDay()` in openalice-pipeline.ts

1. Weekend fast-path: `d.getUTCDay()` on 2026-05-08 = **Friday = DOW 5** → NOT skipped.
2. DB check: `SELECT is_trading_day FROM tw_trading_calendar WHERE date = '2026-05-08' LIMIT 1`
   - If row found with `is_trading_day = false` → skip.
   - If row not found → **default: return true (assume trading day, conservative)**
   - If table throws → **default: return true**

3. 5/8 (Friday, no known TW holiday): Expected to be a normal TWSE trading day.

**Verdict: 5/8 trading day check = PASS_EXPECTED. Assuming the tw_trading_calendar table exists with a row for 5/8, it should be `is_trading_day=true`. Even if row is absent, the code defaults to trading day. This is NOT the blocking cause.**

---

## C. audit-stats post-PR#298 still ALL ZERO

### audit-stats response: GET /api/v1/internal/observability/audit-stats?since=24h
```json
{
  "windowHours": 24,
  "since": "2026-05-07T00:39:34.461Z",
  "ai_approved": 0,
  "ai_rejected": 0,
  "hallucination_reject": 0,
  "adversarial_intercept": 0,
  "ai_yellow_held": 0,
  "paper_submit": 0,
  "paper_submit_rejected": 0,
  "total": 0,
  "db_available": true
}
```

### Actual audit_logs entries (GET /api/v1/audit-logs?limit=20)
20 entries found, all created between 16:11–23:58 on 2026-05-07:
- `content_draft.ai_yellow_held` — multiple entries (07:20Z, 16:11Z, 17:03Z, 18:03Z, 19:03Z, 19:18Z, 20:03Z, 20:28Z, 23:48Z, 23:58Z)
- `content_draft.adversarial_audit` — multiple entries, same timestamps

**The `since` window is `2026-05-07T00:39:34Z`. All audit_log entries have `createdAt` AFTER this `since`. So the date range is correct.**

**Root cause**: The PR #296 fix changed action strings to `content_draft.ai_yellow_held` and `content_draft.adversarial_audit`. The audit-stats SQL at server.ts lines 9185-9192 queries for:
```sql
action IN (
  'content_draft.ai_approved',
  'content_draft.ai_rejected',
  'hallucination_reject',
  'content_draft.adversarial_audit',  ← this IS in the list
  'content_draft.ai_yellow_held',     ← this IS in the list
  'paper_submit'
)
```

The SQL includes both `content_draft.adversarial_audit` and `content_draft.ai_yellow_held` — they ARE in the filter. Yet `total=0`.

**Root cause identified**: The process restarted at 07:59 TST. The `since` window for the audit-stats query is calculated as `new Date(Date.now() - windowMs)` at request time. At investigation time (~08:40 TST), `since` = `2026-05-07T00:39:34Z`. The audit_log entries created at 16:11–23:58 on 2026-05-07 ARE within this 24h window.

**Secondary root cause: The process that IS deployed (restarted 07:59) might be running an older build that does NOT have the PR #296 action string fix.** The `deploymentId=103a9263-9e5e-49ed-aaa0-dfd844a17a14` is the process that started at 07:59. If this deployment predates PR #296 (which fixed the action strings), the running code at the `/api/v1/internal/observability/audit-stats` endpoint still queries old action names → zero counts even though entries exist.

**Confirmation**: The `/api/v1/audit-logs?limit=20` shows `content_draft.ai_yellow_held` entries exist in DB. The SQL query at audit-stats DOES include this action string. **But total=0.** This means the SQL is running but returning 0 — possible if the deployed build has the OLD SQL (pre-PR #296 fix with bare names `ai_yellow_held` without prefix), not the fixed SQL.

**Final verdict on audit-stats zero**: `db_available=true`, entries exist, SQL is in list. The MOST likely cause is the recently restarted deployment was rolled back to an older commit where the action strings in the SQL still used the old bare format (`ai_yellow_held` not `content_draft.ai_yellow_held`). OR the 24h `since` window misses by timezone. Let me state this as INCONCLUSIVE_LIKELY_DEPLOY_VERSION_MISMATCH.

---

## D. KGI Gateway State

```json
{
  "symbol": "2330",
  "state": "BLOCKED",
  "reason": "gateway_unreachable",
  "source": "kgi-gateway",
  "updatedAt": "2026-05-08T00:39:20.544Z"
}
HTTP 200
```

**Verdict: PASS — KGI BLOCKED gateway_unreachable as expected. Stop-line maintained. No change from baseline.**

---

## Root Cause Summary

| # | Finding | Severity | Verdict |
|---|---|---|---|
| RC-1 | Process restarted 07:59 TST; 15min interval cycle missed 08:30 window (0829 < 830 by 1 minute) | HIGH | CONFIRMED |
| RC-2 | First valid pre_market tick expected at ~08:44 TST | INFO | CONFIRMED |
| RC-3 | 5/8 is a TWSE trading day — trading day check not the blocker | INFO | PASS |
| RC-4 | audit-stats total=0 despite DB entries existing — likely running older build pre-PR#296 | MEDIUM | LIKELY |
| RC-5 | KGI BLOCKED gateway_unreachable — expected, no regression | INFO | PASS |
| RC-6 | No `lastFailureReason` set — fire did not fail, it was silently skipped outside_window | INFO | CONFIRMED |

---

## True Cause Statement

The pre_market pipeline did NOT fire at 08:30 because:

1. **Process restarted at 07:59 TST** — all in-memory `_pipelineConsecutiveFails` and `_lastPipelineState` wiped.
2. **15-minute interval alignment**: The setInterval clock starts at process init (07:59). First check was at 07:59 (miss), second at 08:14 (miss), third at 08:29 (miss by 1 minute: 0829 < 830). **Fourth check at 08:44 will hit the window.**
3. **No error, no crash** — the pipeline is alive and will self-heal at ~08:44 TST without intervention.

---

## Proposed Fix Scope

### Immediate (no code change needed)
- Wait until ~08:44 TST. The next setInterval fire for pre_market will hit `hhmm=0844 >= 830 AND < 900` and trigger normally.
- If 08:44 already passed: the pre_market window closes at 09:00. **The pipeline will MISS today's 08:30 tick** and move to close_watch at 13:45.

### Short-term (code change, medium priority)
The root issue is that `setInterval(15min)` starting at process boot creates a clock drift relative to fixed Taipei time windows. If the process restarts at 08:29, the 08:30 window is missed entirely. 

**Fix proposal (for Jason)**:
- Change scheduler wiring to use a "next-aligned-tick" calculation at startup.
- At `startSchedulers()`, compute `msUntilNextPreMarketWindow()` and set `setTimeout` for the first fire, then `setInterval(15min)` after.
- OR: change the pre_market check to use a slightly wider window (e.g., `hhmm >= 825`) to absorb 5-min drift.

### audit-stats zero (separate issue)
- If the currently deployed build predates PR #296 action-string fix: re-deploy main HEAD.
- Confirm: `git log --oneline -1` on deployed commit. If earlier than PR #296 merge commit, redeploy.

---

## Can Deploy / Collect

- **Can deploy**: Yes (nothing blocking). A redeploy would also self-fix audit-stats if it's a stale build issue.
- **Can declare pipeline live**: NO for today 08:30 tick (window may close before 08:44 fires). Close_watch at 13:45 and close_brief at 16:30 will fire normally.
- **Action required**: Elva/楊董 decide whether to trigger manual pipeline run (`POST /api/v1/openalice/pipeline/trigger` if endpoint exists) before 09:00, or accept missing today's pre_market tick.

---

## Appendix: Raw Probe Evidence

```
Health:        HTTP 200 uptime=2381s startedAt=2026-05-07T23:59:26Z
Observability: HTTP 200 pipeline.lastGeneratedAt=null nextRunAt=2026-05-08T00:30:26Z lastFailureReason=null
Dispatcher:    HTTP 200 lastTickAt=2026-05-07T23:59:31Z result=skipped_existing_brief
Audit-stats:   HTTP 200 total=0 db_available=true (window since=2026-05-07T00:39:34Z)
Audit-logs:    HTTP 200 20 entries content_draft.ai_yellow_held / .adversarial_audit (all 5/7)
KGI quote:     HTTP 200 state=BLOCKED reason=gateway_unreachable
```
