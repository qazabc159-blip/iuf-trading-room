# PR #1314 Desk Review — Pete 2026-07-20

## 1. PR Intent
- Close round-1 Blocker #2 from PR #1313's review: `GET /api/v1/track-record/nav` and `GET /api/v1/track-record/performance` (shipped 2026-07-05 in #1177 as deliberately-thin "login-only, any role" public reads for the `/track-record` scorecard page) had no Owner role check. Once #1313 gated the *page* to Owner-only (Athena 7/18 §2), the underlying API remained directly reachable by any logged-in non-owner via curl/devtools — the exact data this whole fix-chain exists to protect.
- Adds the same inline `session.user.role !== "Owner"` + `403 {error:"OWNER_ONLY"}` guard used by 52 other Owner-only routes in `server.ts` (including the sibling Owner-only `/api/v1/portfolio/f-auto/nav` and `/api/v1/admin/ai-rec/performance` that these two routes were originally a "thinner public" counterpart to).
- Rewrites the `TRK-2` regression lock in `tests/ci.test.ts` (previously asserted the *absence* of a role gate) and adds 2 `GATE_CASES` rows to `apps/api/src/auth/role-matrix.test.ts`'s real HTTP-boundary role matrix harness.
- Base branch: `main` @ `85d5fee0` (current tip, up to date — no rebase debt).

## 2. Diff Summary
- 3 files changed: `apps/api/src/server.ts` (+22/-8, two routes), `apps/api/src/auth/role-matrix.test.ts` (+7), `tests/ci.test.ts` (+18/-10, TRK-2 rewrite).
- Zero `apps/web/*` touched (PR body's "scope check" claim verified true — the `/track-record` page from #1313 is unaffected by this diff).
- CI: 5/5 green (`gh pr checks 1314`: validate / W6 audit / Secret Regression / DB-mode / Playwright P0).

## 3. IUF Blocker Checklist

**A. Kill-switch / Real-order Safety**
- grep full diff for `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|order/create` → 0 hits. PASS. No order path touched, pure read-endpoint auth.

**B. Auth / Secret Hygiene**
- Guard is the *very first statement* in both handler bodies — before the dynamic `import("./track-record-handlers.js")` and before any data assembly (`buildFAutoNavFull()` / `getAiRecPerformance()`). Confirmed by reading the diff context directly (line `app.get(...)` → `const session = c.get("session"); if (!session || session.user.role !== "Owner") return c.json(...,403); try { ... }`). PASS — no partial-data-before-check window.
- 403 response body is `{ error: "OWNER_ONLY" }` — same literal shape used by 52 other existing Owner-only routes (grepped and counted); no field/shape hint about what data would have been returned. PASS — no data-shape leak on the reject path.
- grep full diff for `api_key|secret|password|token` → 0 hits. PASS.

**C. State / Schema Integrity**
- No migration, no enum, no runtime state touched. N/A.

**D. PR Hygiene**
- Branch `fix/track-record-api-owner-guard-jason-20260720` matches convention. Commit message conventional (`fix(api): ...`). Base = main, up to date, no rebase debt. PR description explicitly attributes the fix to Pete's #1313 finding, lists test plan, and calls out an unrelated pre-existing `finmind-client.test.ts` env-artifact false-fail (verified via diff that this PR touches neither file — accurate, not a dodge). PASS.

**E. IUF 不可越線**
- Lane check: Jason (backend owner) fixing a backend API gap identified in Jim's (#1313) PR review — correct lane, not a cross-lane edit. PASS.
- 0 governance bypass, DRAFT untouched pending this review. PASS.
- TRK-2 lock rewrite — see Finding/archaeology below; this is the one item worth a deeper look before rubber-stamping "just a test update."

### TRK-2 lock archaeology (#1177, 2026-07-05)
Read the original commit `4d5a5409` ("feat(api): public track-record read endpoints (P0-C)"). The original TRK-2 assertion ("must NOT re-add a role gate") was **not** an accidental leftover or someone else's unrelated safety intent being quietly overridden — it was a deliberate, explicit product decision at the time: these two routes were *designed* as a thinner, field-whitelisted "public" (any logged-in role) counterpart to the pre-existing Owner-only `/api/v1/portfolio/f-auto/nav` and `/api/v1/admin/ai-rec/performance` routes, specifically so any logged-in user could see the `/track-record` marketing/transparency scorecard page (#1174) without being Owner. The commit message and route comments at the time are explicit about this being intentional, not a gap.
That design premise was superseded — not violated — by Athena's 2026-07-18 §2 governance rule (F-AUTO run P&L must not reach non-owner users), which came *after* #1177 and directly contradicts its "any logged-in role" premise. #1313 already implemented the page-level consequence of §2; this PR completes it at the API boundary. This is a legitimate, well-documented supersession of an intentionally-obsoleted prior decision, not "quietly killing a separate security intent" — confirmed by reading both the original commit and this PR's rationale side by side.
- One residual question worth surfacing to Elva (not a blocker): is there any OTHER currently-approved product surface that still depends on the original "any logged-in role can see F-AUTO track record" premise? Checked known consumers on `origin/main` (not local disk, which is stale — see below): `apps/web/app/track-record/page.tsx` (now Owner-gated by #1313) and a legacy static artifact `apps/web/public/home-exact/index.html` (client-side fetch, degrades to "--" on 403, pre-existing orphan-artifact backlog item, not part of either PR's scope). No other live consumer found. `apps/web/app/quant-strategies/*` calls were already removed by #1311 (confirmed via `quant-strategies-page.test.ts`'s explicit `not.toContain("getTrackRecordNav")` regression lock) — ⚠️ note for future reviewers: the local working tree still has stale copies of `strategy-data.ts` / `live-strategy-data.ts` files that were actually deleted on `origin/main` by #1311; a naive local grep will falsely suggest they still exist and still call these endpoints. Verified via `git show origin/main:<path>` (file not found) before ruling this out.

## 4. Findings — Priority Ranked

### 🔴 Blockers
None.

### 🟡 Suggestions

1. **[Doc drift]** Two frontend comments now describe stale behavior: `apps/web/lib/api.ts:372` and `apps/web/lib/fauto-sim-api.ts:880` both say "login-only (any role, no Owner check)" for these two endpoints — that's no longer true after this PR merges. Not user-facing, not a functional risk (the actual guard lives server-side and is correct regardless of what the client-side comment says), but will mislead the next engineer who reads only the frontend file. Neither this PR nor #1313 touches these two lines. Recommend a small drive-by fix in a follow-up (owner: whoever touches either file next, or Jason as a 2-line cleanup).
2. No test asserts the *response body* of the 403 case beyond the role-matrix harness's generic "is 403" check — i.e. nothing pins `{error:"OWNER_ONLY"}` specifically for these two new routes (existing convention elsewhere in the test suite is inconsistent on this too, so not a new gap introduced by this PR — just noting it wasn't tightened either).

### 💭 Nits
- PR body's explicit "swept `server.ts` for a third route in the family — only these two exist" is a nice diligence note that pre-empts an obvious "did you get all of them" review question.

### ✅ Praise
- Guard placement (top-of-handler, before any import or data assembly) is exactly right and was verified by direct diff inspection, not assumed.
- Reused the exact existing `OWNER_ONLY` idiom (grepped 52 prior instances) instead of inventing a new error code or a `requireOwner()` abstraction for a 2-route change — correct "simplicity first" call for this scope.
- TRK-2 rewrite doesn't just flip the assertion polarity — it rewrites the docstring explaining *why* the lock changed and cites both the original design commit's intent and the superseding governance event, so the next person reading this test understands the history instead of just seeing an assertion that contradicts what a stale comment nearby still says.
- PR body proactively discloses an unrelated flaky/environment-dependent test failure (`finmind-client.test.ts` T3/T11 under ambient env vars) and explains why it's not this PR's regression — good hygiene, saves the reviewer a trip down a false lead.

## 5. Verdict
- [x] APPROVED — no blockers, safe to mark ready

## 6. Merge-order recommendation (joint with PR #1313)
**Recommend merging #1313 before #1314.**
- Neither order causes a data leak — `/track-record/page.tsx`'s existing per-section `AuthIssueNotice` already fails closed on 401/403 (verified by reading the pre-#1313 page source at `85d5fee0`, which is what #1314's API change would be paired against if merged alone).
- But if #1314 merges alone first (before #1313's page gate lands), a non-owner visiting `/track-record` will see per-section "登入階段異常，請重新整理或重新登入後再試" (login-session-anomaly) messages — technically accurate reject path, but semantically misleading (implies a login bug, not a deliberate Owner-only policy), and refreshing/re-logging-in will never resolve it for that user.
- Merging #1313 first means non-owner sessions never reach those per-section fetches at all (page-level gate returns before any call) — so the confusing interim wording window never appears. Once #1314 also lands, the residual direct-API-curl bypass closes too, with zero additional user-facing change (Owner sessions see identical 200 responses before and after either merge).
- Both PRs are independently safe to merge in either order from a security-regression standpoint; the above is a UX-polish preference, not a blocking constraint.

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-20
Sprint: W6 Day 7 (paper sprint governance fix-chain, round 2 — API-layer companion to #1313)
