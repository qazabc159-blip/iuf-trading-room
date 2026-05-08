# PR #292 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：兩件事並排。(1) BLOCK#8 audit 追蹤：Y2 redact token/session in alerts UI、Y3 SourceStatusCard 改用真 server-side probe 取代 hardcoded "stale"。(2) P0-2 sprint：Sentry SDK init (api + web)、health watchdog cron (30min)、email digest fail alert、pipeline consecutive-fail alert、audit-stats endpoint。
- 對應 sprint task：P0-1 (Y2/Y3 cleanup) + P0-2 (Sentry observability) per session_handoff.md 5/8 backlog
- Base branch：main (CLEAN / MERGEABLE)

## 2. Diff Summary
- 改了 11 個檔（pnpm-lock.yaml 收 Sentry + OpenTelemetry transitive deps，LOC 巨大但自動產生）
- 主要改動：
  - NEW: `apps/api/src/sentry-init.ts` (85 LOC)
  - NEW: `apps/web/instrumentation.ts` (33 LOC)
  - MOD: `apps/api/src/server.ts` (+215 / -22) — watchdog + pipeline alerts + audit-stats endpoint
  - MOD: `apps/web/app/alerts/page.tsx` (+20 / -1) — Y2 redact
  - MOD: `apps/web/app/companies/[symbol]/page.tsx` (+60 / -6) — Y3 real state probe
  - MOD: `tests/ci.test.ts` (+76) — 6 new tests
  - MOD: `.env.example` (+11) — SENTRY_DSN, WATCHDOG_FAIL_THRESHOLD, PIPELINE_FAIL_THRESHOLD
  - NEW: `evidence/w7_paper_sprint/observability_layer_2026-05-07.md`
- LOC (functional): +~520 / -~30

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [PASS] No toggle of KILL_SWITCH / EXECUTION_MODE in diff
- [PASS] No place_order / submit_order / kgi.order.create calls
- [PASS] Paper sprint boundary held — no KGI gateway /order/create call
- [PASS] Feature flags: SENTRY_DSN default empty (OFF), WATCHDOG_FAIL_THRESHOLD default 2, PIPELINE_FAIL_THRESHOLD default 3 — all safe defaults

### B. Auth / Secret Hygiene
- [PASS] New endpoint `/api/v1/internal/observability/audit-stats` uses `c.var.session` + role check `session.user.role !== "Owner"` → 403. Auth path is the standard session middleware (inherited from global Hono middleware at server.ts:301 per confirmed pattern). Owner-only correct.
- [PASS] No hardcoded API key / token / password / DSN value. SENTRY_DSN= empty in .env.example. Evidence doc only has placeholder text `<dsn_value>`.
- [PASS] sendDefaultPii: false in both Sentry init files
- [PASS] No person_id / userId / sessionId leak in response bodies or new log lines

### C. State / Schema Integrity
- [PASS] No DB schema changes — no migration needed (audit_logs table is pre-existing, audit-stats only reads it)
- [PASS] No enum / status changes
- [PASS] watchdog _watchdogConsecutiveFails is a module-level let var in startSchedulers() scope — process restart resets to 0. Safe (watchdog lag is transient; worst case: misses one window after restart, no safety issue)
- [PASS] _pipelineConsecutiveFails is local to startSchedulers() — same reasoning, safe

### D. PR Hygiene
- [PASS] PR title follows feat(scope) pattern consistent with sprint PRs
- [PASS] Base branch = main, MERGEABLE: CLEAN
- [PASS] PR description lists changed files, test plan, evidence path
- [PASS] 166/166 tests PASS per Jason's evidence doc (+6 new tests)
- [PASS] No stacked chain dependency issue (this PR targets main directly)

### E. IUF-Specific Non-Negotiables
- [PASS] No agent lane violation (apps/api + apps/web/alerts + apps/web/companies — all within Jason lane)
- [PASS] Vendor lane NOT touched (apps/web/app/page.tsx and globals.css untouched)
- [PASS] No KGI gateway /order/create call
- [PASS] No redaction policy violation — no person_id / token in plaintext in evidence or logs

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

1. **[audit-stats: paper order action strings are wrong]**
   - 位置：`apps/api/src/server.ts` new endpoint, SQL WHERE clause lines ~8196-8198
   - 原因：SQL query filters for `'paper.order.submit'` and `'paper.order.rejected'`. But `writeAuditLog()` uses `parseAuditTarget(method, path)` which for `POST /api/v1/paper/submit` produces `{ action: "create", entityType: "paper", entityId: "submit" }` — NOT `paper.order.submit`. Verified by tracing `specialAuditRoutes` (no entry for `/api/v1/paper/submit`) and the generic fallback logic in `audit-log-store.ts:parseAuditTarget`. The paper action string `"paper.order.submit"` does not exist in production audit_log. The `paper_submit` and `paper_submit_rejected` counts in the response will always be 0 regardless of actual paper order volume. This is a silent data-correctness bug — no 500, just perpetually wrong metrics.
   - 建議：Fix one of two ways: (a) Add a specialAuditRoute entry for `/api/v1/paper/submit` that maps to action `"paper.order.submit"` / `"paper.order.rejected"` based on isRejected (needs two matchers or a payload check), OR (b) Change the SQL query to use `action = 'create' AND entity_type = 'paper'` which matches the actual stored string. Option (b) is a 2-line fix without touching audit-log-store. Confirm with Jason which is canonical.

### 🟡 Suggestions (should fix)

1. **[adversarial_intercept counter over-counts]**
   - 位置：server.ts audit-stats endpoint, line ~8212 comment
   - 原因：`adversarialIntercept` counts ALL `content_draft.adversarial_audit` entries, not just those with severityScore >= 7 (true intercepts). The comment acknowledges this ("precise intercept check would require JSONB query"). In production, 53 adversarial audits were observed in 12h but only 1 was a real intercept — so the reported number is ~53x inflated. The `adversarial_intercept` field name in the API response is semantically wrong.
   - 建議：Either rename field to `adversarial_audit_count` (honest), OR add JSONB filter: `AND payload->>'severityScore' IS NOT NULL AND (payload->>'severityScore')::int >= 7`. A `::int >= 7` cast on JSONB text is slightly fragile but workable. Renaming the field is the safer 1-line fix.

2. **[Y3: "degraded" outcome maps to "error" state, not surfaced distinctly]**
   - 位置：`apps/web/app/companies/[symbol]/page.tsx`, `annState` mapping
   - 原因：Both `degraded` and `error` outcomes map to `"error"` in annState. The `annDetail` string does distinguish them in text. However, SourceStatusCard's `"error"` badge doesn't distinguish between "TWSE maintenance mode" (degraded) vs "network failure" (error). This was pre-existing design from BLOCK#8 audit spec (DEGRADED envelope from PR #265 F3 was already flagged as suggestion, not blocker). Current behavior is better than hardcoded "stale" — just noting the distinction is text-only.
   - 建議：No code change required unless Product wants a distinct "degraded" visual badge. Accept as-is or log as future enhancement.

3. **[watchdog: setImmediate lag > 5000ms threshold may be too generous for Railway]**
   - 位置：server.ts startSchedulers(), `if (lagMs > 5000)`
   - 原因：A 5-second event-loop lag is extremely severe. The 5/7 502 incidents were likely caused by much smaller lags (200-500ms range) that accumulated. A threshold of 500ms would give earlier warning.
   - 建議：Consider lowering to 1000ms or 500ms. At 2× threshold default, the current setting means Sentry fires only after 10+ continuous seconds of lag. Low-urgency, discuss with Elva.

4. **[Parameters<typeof buildSourceStatus>[4] type annotation is fragile]**
   - 位置：`apps/web/app/companies/[symbol]/page.tsx` line ~533
   - 原因：`let announcementsSource: Parameters<typeof buildSourceStatus>[4]` uses positional parameter index. If `buildSourceStatus` signature changes (new param inserted before index 4), this silently references the wrong type. `AnnouncementsSourceState` is already defined as a named union type in the same file — prefer explicit annotation.
   - 建議：Change to `let announcementsSource: AnnouncementsSourceState` (1-char diff, same type resolved, more robust).

### 💭 Nits (nice to have)

1. `isSentryEnabled` is exported from `sentry-init.ts` but not imported/used in server.ts — the `if (!dsn)` guard in captureException/captureMessage already handles the no-op. The export exists for consumers who might want to conditionally include debug info. Consider a JSDoc comment noting its intended use, to prevent it from being removed as dead code by a future cleanup.

2. The watchdog `console.info` heartbeat line logs on EVERY 30min tick even when healthy. At Railway log cost/noise, this may be chatty. A future improvement could log only when state changes (fail→ok or ok→fail).

3. `evidence/w7_paper_sprint/observability_layer_2026-05-07.md` is an operator runbook, not a code file — it's in scope per evidence lane. Clean and well-structured.

### Praise

- Y2 redact implementation is thorough: SENSITIVE_KEY_PATTERN covers 11 key patterns, case-insensitive, PLUS JWT shape detection (3-part base64url regex). The test inlines the same regex and verifies both sensitive + safe key lists — this is the right pattern.
- Y3 server-side probe is minimal and correct: fail-soft with catch block, comment explicitly acknowledging it's a HEAD-style probe (not for rendering), AnnouncementsPanel client-side fetch is preserved untouched. Surgical change.
- Sentry DSN-gated no-op pattern is solid: both `captureException` and `captureMessage` check `if (!dsn) return` at the top before any Sentry SDK call — this means even if Sentry SDK is loaded, no network call happens. `sendDefaultPii: false` is set in both api and web init.
- 3 consecutive-fail counter pattern is clean: one shared Record<string, number> for 3 pipeline phases, handlePipelineFail/handlePipelineSuccess extracted as named functions. Readable and testable.
- Base branch is CLEAN/MERGEABLE — no rebase needed.
- 166/166 tests PASS with 6 meaningful new tests covering the exact scenarios specified in the task.

## 5. Verdict

- [x] NEEDS_FIX — 1 blocker (paper order action strings in audit-stats SQL return perpetually 0; silent data bug)
- [ ] APPROVED
- [ ] BLOCKED

The 1 blocker is a 2-line SQL fix. All other items (Y2/Y3/Sentry/watchdog/email-digest alert/pipeline alert) are structurally correct and pass IUF checklist. Functional code can be reviewed as approved pending the SQL fix.

## 6. Suggested Owner for Fixes

- 🔴 #1 (paper action strings) → Jason: 2-line SQL fix in server.ts audit-stats endpoint. Quickest: change `'paper.order.submit'` → `'create'` and add `AND entity_type = 'paper'` in the GROUP BY query, rename response fields to `paper_create_count`. Alternatively add specialAuditRoute for `/api/v1/paper/submit` in audit-log-store.ts. Pete does not need to re-review — Elva can confirm fix and merge.
- 🟡 #1 (adversarial over-count) → Jason: rename field or add JSONB filter. Suggestion-level, post-merge acceptable.
- 🟡 #2 (degraded badge) → Elva: design call, no code change required now.
- 🟡 #3 (watchdog threshold) → Jason: 1-line env default change, low urgency.
- 🟡 #4 (Parameters type) → Jason: 1-char change `Parameters<typeof buildSourceStatus>[4]` → `AnnouncementsSourceState`.

## 7. Re-review Required

NO — blocker is a 2-line mechanical fix. Elva can eyeball the SQL change directly. No full re-review needed.

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Day 9 (P0-1+2 observability sprint)
PR: #292 feat(observability+web): Y2/Y3 cleanup + Sentry + watchdog + audit stats
Tests: 166/166 PASS
Merge state: CLEAN / MERGEABLE
