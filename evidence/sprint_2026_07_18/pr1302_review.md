# PR #1302 Desk Review — Pete 2026-07-18

## 1. PR Intent
- Wave2 frontend batch (5 items, all `apps/web`): (1) `apiGetMe()` honest session-error vs owner-lock messaging on `/ops/f-auto` + company page `AiAnalystReportPanel`; (2) market-intel mobile news card single-column stack `@media(max-width:640px)`; (3) settings/account "更新密碼" CTA solid gold (was translucent brown); (4) `calcVWAP()` trailing 22-bar rolling window fix for daily bars (was unbounded cumulative sum, +286% distortion); (5) company page + ai-recommendations `MarketStateBanner lastCloseDate` prop wiring via new `resolveBannerLastCloseDate()`.
- 對應 sprint task：Elva walkthrough `_MASTER_CATALOG.md` P1/P2 items #2-6.
- Base branch：`main` (merge-base = origin/main tip `7458c760`, i.e. rebased cleanly past #1298/#1299/#1300/#1301 — no stale-base risk, no file-conflict with those already-merged PRs).

## 2. Diff Summary
- 11 個檔，+271 / -29
- 主要改動：`lib/auth-client.ts` (4 lines), `AiAnalystReportPanel.tsx`, `ops/f-auto/page.tsx`, `OhlcvCandlestickChart.tsx` (calcVWAP split intraday/daily), `lib/index-snapshot-freshness.ts` (+test), `companies/[symbol]/page.tsx` + `ai-recommendations/page.tsx` (banner prop wiring), `market_intel/app.css` (mobile media query), `settings/account/page.tsx` (CTA color), new `packages/qa-playwright/tests/jim_apigetme_honesty_20260718.spec.ts`.
- 100% `apps/web` + 1 qa-playwright spec. Zero backend/migration/contracts touch (confirmed via `git diff -- packages/db/migrations/` empty).

## 3. IUF Blocker Checklist

**A. Kill-switch / Real-order safety** — PASS. Grepped full diff for `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|order/create|kgi.order` → zero hits. No order-path code touched at all.

**B. Auth / Secret hygiene** — PASS. No new endpoint. `apiGetMe()` still uses `credentials:"include"` unchanged; only error-classification changed (401/403 → `unauthenticated`, else `server_error_N`). Grepped diff for `console\.|person_id|userId|sessionId` → zero hits. Playwright spec's mock cookie value (`playwright-mock-session`) is a test fixture, not a real credential.

**C. State / schema integrity** — N/A. No DB/enum/state-machine change.

**D. PR hygiene** — PASS. Branch `fix/wave2-frontend-jim-20260718` matches `fix/<主題>-<作者>-<YYYYMMDD>`. DRAFT + OPEN + MERGEABLE. All 4 required checks green (validate / W6 No-Real-Order Audit / Secret Regression Check A2 / Playwright P0 Smoke — verified via `gh pr view --json statusCheckRollup`, no `continue-on-error`). Single commit, conventional-ish message, PR body lists test plan + evidence claims.

**E. Lane / governance** — PASS. Pete-scope only (no functional edits made by this review). No governance bypass. No KGI `/order/create` reference.

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
None.

**apiGetMe safety-critical trace (the item flagged as most important):** verified both consumers (`AiAnalystReportPanel.tsx:191-196`, `ops/f-auto/page.tsx:24-30`) gate in the order `if (!result.ok) → session-error; else if (role !== "Owner") → not-owner; else → ready`. `!result.ok` is checked and returns *before* `result.user` is ever touched (TypeScript's discriminated union makes `result.user` inaccessible on the `AuthFailure` branch anyway — a real owner whose `/auth/me` fails is shown "請重新登入", never silently granted `ready`; a non-owner whose call fails is shown the same, never shown the owner content). No path exists where a failed/network-error/401/403 response reaches `role !== "Owner"` comparison as `false` (which would require `result.user` to exist on a failure object — structurally impossible). **This is a UX-honesty fix only — the pre-existing code (`!result.ok || role !== "Owner"` → always `not-owner`) was already fail-closed, just with a misleading message.** No security regression, no new hole.

### 🟡 Suggestions (should fix)
1. **No committed regression test for `calcVWAP()`** — `OhlcvCandlestickChart.tsx:116` (module-private, not exported). PR's test plan cites only an ad-hoc "synthetic 2438-bar VWAP" manual sanity check, not a vitest case. The claimed "699/699 green" is 696 pre-existing + 3 new `resolveBannerLastCloseDate` tests — none cover VWAP. Given this is the second numeric-display bug this sprint (`+286%` VWAP, similar class to prior comma-truncation bugs), a committed unit test would catch regressions on the next OHLCV refactor. Non-blocking: display-only bug, not safety/money-path.
   - 建議：export `calcVWAP` (or add a thin wrapper) + 2-3 vitest cases (short daily series <22 bars, long series ≥22 bars checking window boundary, intraday session-reset still resets).
2. **`resolveBannerLastCloseDate()` adds 2 new parallel backend fetches** (`getMarketDataOverview` + `getTwseMarketOverview`) to `/companies/[symbol]` and `/ai-recommendations` render paths that previously didn't call either endpoint (confirmed via grep — no prior references in `companies/[symbol]/page.tsx`). Fail-open (`.catch(() => null)`) and kicked off in parallel with existing fetches (`page.tsx:313` fires the promise before OHLCV fetch, awaits at `page.tsx:435` after other awaits) — so no added serial latency and no page-break risk on failure. Flagging only as a new dependency surface, not a defect.

### 💭 Nits (nice to have)
1. Mobile media-query breakpoint (`640px`) is a hardcoded literal with no shared CSS variable — consistent with rest of `market_intel/app.css` (no breakpoint tokens exist elsewhere in that file either), so not a new inconsistency.
2. VWAP fix comment claims the 22-bar window "matches backend `/companies/:id/technical`" — Pete did not cross-verify the backend constant (out of frontend-only diff scope); worth a quick Bruce/Jason confirmation that the backend window is genuinely 22, not just asserted in a comment.

### ✅ Praise
- The `apiGetMe` fix is exactly the shape of change that's easy to get backwards (turn a fail-closed-but-confusing state into a fail-open security hole) and this PR gets it right in both consumers — traced call-order confirms `!result.ok` short-circuits before any role comparison, in both `AiAnalystReportPanel.tsx` and `ops/f-auto/page.tsx`.
- New Playwright spec (`jim_apigetme_honesty_20260718.spec.ts`) correctly tags `@smoke` (verified this actually gets picked up by CI's `qa:playwright:smoke` → `playwright test --grep @smoke`) and uses `context.route()` not `page.route()` — both are traps this same reviewer flagged on #1289/#1290 (dead untagged spec) and #1293 (PWA SW breaks `page.route()`) in the prior two weeks. Author demonstrably internalized prior review feedback rather than repeating the same mistakes.
- Banner-date wiring reuses the already-reviewed `resolveAuthoritativeTradeDate()` primitive with the same two sources/ordering as the homepage precedent (`app/page.tsx:850`), and feeds it into `MarketStateBanner`, which explicitly renders `null` until `mounted` — no SSR/hydration-mismatch risk introduced (verified in `components/MarketStateBanner.tsx:70`, pre-existing guard, correctly reused not bypassed).
- Clean lane discipline: zero backend/migration/contracts touch across all 5 fixes; PR cleanly rebased on current main tip with no residual conflict against the 3 same-day-merged sibling PRs (#1299/#1300/#1301).

## 5. Verdict
- [x] APPROVED — 可 ready，無 blocker

## 6. Suggested Owner for Fixes
- 🟡 #1 (calcVWAP regression test) → Jim (original author) or Bruce, low priority, can land in a follow-up
- 🟡 #2 (new fetch dependency, no action needed, FYI only) → Elva (awareness), no owner action required

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-18
Sprint: W6 Day (paper sprint, wave2 frontend batch)
