# PR #1292 Desk Review — Pete 2026-07-17

## 1. PR Intent
- P0 prod incident fix: `GET /api/ui-final-v031/market-intel` SSR route hung 70s+ because none of
  `buildMarketIntelPayload()`'s 5 `Promise.allSettled` upstream calls (`getNewsTop10`,
  `getMarketIntelAnnouncements`, `getFinMindStatus`, `getTwseMarketHeatmap`,
  `getMarketInstitutionalSummary`) had a timeout — `apps/web/lib/api.ts`'s shared `request()`/
  `requestRaw()` never pass an `AbortSignal`. Fix wraps each call in a local 20s `withTimeout()`
  (`Promise.race` against a rejecting `setTimeout`), scoped to this one route only.
- Corresponding sprint task: P0 hotfix, cross-lane dispatch (Jason, backend/strategy owner, doing a
  web-lib fix under explicit Elva P0 dispatch — documented in the RCA header, not a silent lane jump).
- Base branch: `main` (correct, standalone hotfix, not part of a stacked chain).

## 2. Diff Summary
- 2 files changed: `apps/web/lib/final-v031-live.ts` (+36/-5), RCA report (+143, new file).
- Main changes: `MARKET_INTEL_UPSTREAM_TIMEOUT_MS = 20_000` + `withTimeout()` helper
  (origin/fix branch lines 228-238); each of the 5 calls in `buildMarketIntelPayload()` (line 334)
  wrapped in `withTimeout(...)`.
- LOC: +179 / -5 total (mostly the RCA doc).

## 3. IUF Blocker Checklist
- §A Kill-switch/real-order: N/A — diff touches only a read-only market-intel aggregator, zero
  order/broker/KGI-gateway code. Grepped diff for `KILL_SWITCH`/`EXECUTION_MODE`/`order.create` —
  none. PASS.
- §B Auth/secret: N/A — no new endpoint, no secrets, no session/auth code touched. PASS.
- §C State/schema: N/A — no DB/migration/enum changes. PASS.
- §D PR hygiene: PASS — branch name matches `fix/<主題>-<作者>-<YYYYMMDD>` convention, commits are
  conventional (`fix(web): ...`, `docs(reports): ...`), DRAFT status correct, PR body lists RCA path
  + explicit test plan with checked/unchecked items (honestly discloses unit-test coverage gap).
- §E Lane/governance: PASS — cross-lane dispatch explicitly documented (Elva → Jason, P0), no
  governance bypass, no unscoped merge attempt.

## 4. Findings — Priority Ranked

### 🔴 Blockers
None.

### 🟡 Suggestions
1. **Timeout math doesn't match the actual enforcing constraint**: PR frames verification as "20s ×
   5 parallel = worst-case 20s page load, Playwright 60s test timeout is fine." But
   `packages/qa-playwright/playwright.config.ts:9` sets `expect: { timeout: 15_000 }` — and
   `market-intel.spec.ts`'s key assertion (`await expect(surface).toContainText(...)`) is bound by
   that 15s `expect` timeout, not the 60s overall test timeout. If a genuinely-slow-but-not-hung
   upstream call takes close to the full 20s in prod (not a hang, just slow), the SSR route
   correctly returns bounded/fallback data, but this Playwright assertion could still flake-fail
   before the route even responds — un-modeled by the PR's own math. Not a functional bug (fallback
   semantics are correct either way), but this is the exact flake class the RCA says this fix is
   meant to end (3+ sibling PRs blocked same day). Recommend tightening
   `MARKET_INTEL_UPSTREAM_TIMEOUT_MS` closer to the existing calibrated per-source constants in
   `apps/web/app/page.tsx` (`INTEL_SOURCE_MS=7000`, `PUBLIC_MARKET_ENDPOINT_MS=10000`,
   `KGI_MARKET_ENDPOINT_MS=3500`) rather than one flat 20s for 5 heterogeneous sources.
2. **Duplicate timeout mechanism, not reused**: `apps/web/app/page.tsx:271-294` already has a mature,
   resolve-based (sentinel, not reject/race) `withTimeout()` with per-source-calibrated constants for
   this identical problem class. This PR adds a second, independent implementation
   (`final-v031-live.ts:230-238`, reject-based `Promise.race`) instead of reusing it. RCA explicitly
   justifies the narrow scope for P0 blast-radius reasons (reasonable under time pressure), and its
   own §7 already lists a shared-helper consolidation as follow-up — just flagging so that follow-up
   also de-dups these two parallel implementations into one.

### 💭 Nits
1. `withTimeout()` (`final-v031-live.ts:230-238`) never `clearTimeout`s the losing timer — same as
   the pre-existing `page.tsx` pattern, so not a new regression, just worth fixing when consolidated.

### ✅ Praise
- RCA report (`reports/sprint_2026_07_17/MARKET_INTEL_OUTAGE_RCA_2026_07_17.md`) is unusually
  disciplined: distinguishes "fixed symptom" from "unconfirmed root cause," documents exactly what
  was ruled out with evidence (unauthenticated-vs-authenticated curl timing isolating the hang to
  this route; backend `AbortSignal.timeout` audit), and doesn't overclaim a fix it can't fully prove.
- Fallback semantics correctly verified: a timed-out/rejected source falls through the existing
  `Promise.allSettled` → `null`/empty-array path (`final-v031-live.ts:347-351` in canonical branch
  copy), never fabricates data — consistent with the repo's "缺資料不假綠" rule.
- CI 5/5 green confirmed against the PR's actual head commit (`ae579d35`, verified via
  `gh api .../actions/runs/29519505079` `head_sha` match to `gh pr view --json headRefOid`) — not a
  stale/cached run.

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker（2 🟡 為 post-merge follow-up，不擋此 P0 hotfix）

## 6. Suggested Owner for Fixes
- 🟡 #1 (timeout/expect-timeout mismatch) → Jason, fast follow-up before declaring the CI flake fully closed
- 🟡 #2 (duplicate withTimeout impl) → Jason, fold into the shared-helper consolidation already listed in RCA §7

## 7. Re-review Required
NO (both are non-blocking follow-ups; if #1 is addressed, no re-review needed, just confirm in a comment)

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6 Day (P0 hotfix, out-of-band)
