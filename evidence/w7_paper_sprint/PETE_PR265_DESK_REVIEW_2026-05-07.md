# PR #265 Desk Review — Pete 2026-05-07

## 1. PR Intent
- 這個 PR 想做什麼：5 條 fix bundle — F2 TWSE 非 JSON 上游保護 / F3 announcements DEGRADED 狀態回傳 / S2 tw_shareholding + tw_market_value stale threshold 10d→5d / S3 shortChange 對稱計算 / S4 .env.example OPENAI_MODEL 文件補充；另附 migration 0024 DRAFT→promote rename。
- 對應 sprint task：BLOCK #5 Phase 2 Jason BG #2 cleanup bundle (Bruce+Pete identified gaps from #259 and BLOCK6 announcements verify)
- Base branch：main (CORRECT — not stacked)

## 2. Diff Summary
- 改了 4 個檔：`.env.example`, `apps/api/src/data-sources/twse-openapi-client.ts`, `apps/api/src/server.ts`, `packages/db/migrations/0024_finmind_market_intel.sql` (rename from .DRAFT.)
- 主要改動：+40 / -7 LOC；migration rename = 0 content delta
- CI (from PR checks): Secret Regression Check A2 PASS / W6 No-Real-Order Audit PASS / `validate` pending at review time

## 3. IUF Blocker Checklist

### A. Kill-switch / Real-order Safety
- [x] PASS — no `KILL_SWITCH` / `EXECUTION_MODE` toggle in diff
- [x] PASS — no `place_order` / `submit_order` / `kgi.order.create` in diff; only pre-existing HARD LINE comment lines in server.ts
- [x] PASS — paper sprint path not touched; no KGI gateway `/order/create` call added
- [x] PASS — no feature flag default changed

### B. Auth / Secret Hygiene
- [x] PASS — `/api/v1/companies/:id/announcements` uses `c.get("session").workspace.slug` at line 4917 via `resolveCompany`; session-gated by construction (global session middleware on `/api/v1/*`)
- [x] PASS — no hardcoded API key / token in diff
- [x] PASS — `.env.example` adds comment only; no real value exposed; FINMIND_API_TOKEN still redacted
- [x] PASS — no `person_id` / `userId` / `sessionId` in log lines or response bodies added by this PR; announcements DEGRADED response logs only error message string

### C. State / Schema Integrity
- [x] PASS — migration 0024 rename from `.DRAFT.sql` → `.sql` is a PROMOTE action, pre-cleared by Mike's `APPROVE_DRAFT_FOR_LATER_PROMOTE` verdict (evidence/w7_paper_sprint/MIKE_PR232_MIGRATION_AUDIT_2026-05-06.md §6 + §7 promote checklist item 1 explicitly names this exact rename)
- [x] PASS — down.sql exists and was NOT renamed (already named correctly); forward+down pair intact
- [x] PASS — `migrate.ts:24` filter `!file.includes(".DRAFT.")` — renamed file now passes; Mike's PR231 promote audit confirmed this mechanism
- [x] PASS — Mike §7 dependency check: 0022 and 0023 promoted via PR #231 (Mike PR231 audit confirmed); 0024 depends on no FK from 0022/0023 (standalone cache tables per audit §B)
- [x] PASS — no enum / status string changes
- [x] PASS — DEGRADED state already in server.ts SourceState enum (line 4021 comment); no new enum value added
- [x] PASS — shortChange compute is a pure expression change; no state machine touched

### D. PR Hygiene
- [x] PASS — title follows `fix(api):` conventional commits pattern
- [x] PASS — not a stacked chain PR; direct to main, base=main confirmed
- [x] PASS — PR description lists all 5 fix labels (F2/F3/S2/S3/S4) with explanation; test plan listed (typecheck / 129 tests PASS)
- [x] PASS — migration rename described implicitly (not called out in PR summary — see suggestion #3)

### E. IUF-Specific Non-negotiables
- [x] PASS — Pete not modifying production code
- [x] PASS — no governance bypass; PR is OPEN not bypassing review
- [x] PASS — no KGI gateway `/order/create` call (existing HARD LINE comments only)
- [x] PASS — no redaction policy violation in evidence or response bodies

---

## 4. Findings — Priority Ranked

### Blockers
NONE

### Suggestions

1. **[F3 DEGRADED state not surfaced to UI]**: The DEGRADED response shape `{ data: [], state: "DEGRADED", degradedReason }` is never consumed by `AnnouncementsPanel.tsx`. The frontend calls `getCompanyAnnouncements()` which uses `request<CompanyAnnouncement[]>()` and reads only `response.data`. When backend returns `state: "DEGRADED"`, `response.data = []` → panel shows `status: "empty"` (無資料 badge) instead of `status: "blocked"` (暫停 badge). The DEGRADED user-facing signal is silently swallowed.
   - 位置：`apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx` lines 70-86 (`.then` handler) + `apps/web/lib/api.ts:1585` (`getCompanyAnnouncements`)
   - 原因：`request<T>()` wrapper unwraps to `{ data: T }` — the `state` / `degradedReason` fields on the DEGRADED response are invisible to the caller because TypeScript typed the return as `CompanyAnnouncement[]`, not a union type.
   - 建議：Either (a) update `getCompanyAnnouncements` return type to include `{ state?: string; degradedReason?: string }` and add a `.then()` branch in `AnnouncementsPanel` that routes `state === "DEGRADED"` to `status: "blocked"`, or (b) accept that DEGRADED silently degrades to "empty" (simpler, slightly worse UX). This is a frontend follow-up; backend is correct.

2. **[S2 stale threshold comment still says "weekly=10"]**: `server.ts` line 4143 comment originally read `"dividend/market_value: weekly (staleDays=10)"`. The diff updates this comment partially: `"dividend: weekly (staleDays=10); market_value/valuation: daily (staleDays=5)"`. This is now correct. Confirmed PASS — no follow-up needed. (Noted as praise instead, see below.)

3. **[Migration rename not called out in PR description]**: PR summary lists F2/F3/S2/S3/S4 but does not mention the `0024_finmind_market_intel.DRAFT.sql → .sql` promote rename. Reviewers who don't read the diff closely may not realize a migration is being promoted. Recommend adding a line: "0024 DRAFT promote: filename rename per Mike audit §7 promote checklist."
   - 位置：PR description `## Summary`
   - 原因：migration promotes have outsized production impact (runner will now apply 0024 on next deploy)
   - 建議：Amend PR description before merge (one line). Non-blocking if Elva is aware.

### Nits

1. **[Dead code: re-throw check at line 170]**: `twse-openapi-client.ts` inner try block (lines 168-173) contains `if (e instanceof Error && e.name === "TwseNonJsonError") throw e;` at line 170. This is unreachable — `TwseNonJsonError` is thrown at line 162, which is OUTSIDE the inner try block. The inner try only wraps `response.json()` (a JSON parse call). The re-throw is dead code leftover from an earlier iteration where content-type check may have been inside the try.
   - 位置：`apps/api/src/data-sources/twse-openapi-client.ts:170`
   - 原因：Structural leftover. Functionally correct (error does propagate correctly), but adds reader confusion.
   - 建議：Remove line 170. One-liner cleanup.

2. **[No unit test for HTML-200 maintenance path]**: F2 guard (content-type check → TwseNonJsonError) is a meaningful behavior change. No new test mocks a `fetch` response with `content-type: text/html` and `status: 200` to verify the guard fires. PR test plan says 129/129 PASS — coverage is existing tests, not new coverage.
   - 位置：`tests/ci.test.ts` (no twse coverage found)
   - 建議：Add a unit test: mock `fetch` returning `{ ok: true, status: 200, headers: { "content-type": "text/html" } }` → verify `fetchTwse()` throws `TwseNonJsonError`. Nice to have; TWSE maintenance is rare.

### Praise
- S3 `shortChange` compute perfectly mirrors `marginChange` pattern — symmetric, null-safe, uses same non-null assertion style. Clean execution.
- F3 try/catch correctly differentiates `TwseNonJsonError` vs generic fetch errors with two separate `degradedReason` strings (`twse_upstream_non_json` vs `twse_fetch_error`). The `isNonJson` discriminator is precise.
- S2 comment update is surgical — simultaneously fixes the code (10→5) AND updates the comment to correctly categorize market_value as daily (not weekly). Both lines in one diff hunk.
- Migration promote is clean: Mike's audit at §7 pre-authorized this exact rename; no content delta; down.sql pair intact; runner filter verified.
- .env.example S4 note is accurate and saves future operator confusion (confirmed: `hallucination-check` endpoint reads `process.env["OPENAI_MODEL"]`, no separate var).

---

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker

Reasoning: All 5 stated fixes are correct. IUF blocker checklist §A-E all PASS. Migration promote is pre-authorized by Mike. The DEGRADED→UI gap (Suggestion #1) is a pre-existing architectural gap introduced at the F3 backend level — it requires a frontend follow-up PR (not a blocker on this backend-only fix). Dead code nit (#1) is cosmetic. No real-order safety concerns.

---

## 6. Suggested Owner for Fixes

- Suggestion #1 (F3 DEGRADED UI gap) → Frontend owner (Jim / Codex); follow-up PR on `apps/web/app/companies/[symbol]/AnnouncementsPanel.tsx`
- Suggestion #3 (PR description migration note) → Jason (amend before Elva merges; one line)
- Nit #1 (dead code line 170) → Jason (1-line delete; can bundle with next cleanup PR)
- Nit #2 (unit test) → Jason or Bruce (low priority; defer to next test sprint)

---

## 7. Re-review Required
NO — APPROVED as-is. Suggestion #3 (PR description) is cosmetic and can be Elva's judgment call at merge time.

---
Reviewer: Pete
Date: 2026-05-07
Sprint: W7 Paper Sprint / BLOCK #5 Phase 2
PR: #265 fix(api): announcements upstream guard + stale threshold + shortChange compute + env doc
Files reviewed: 4 changed (3 production, 1 migration rename)
LOC: +40 / -7
