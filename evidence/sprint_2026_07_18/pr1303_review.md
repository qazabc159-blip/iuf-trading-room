# PR #1303 Desk Review — Pete 2026-07-18

## 1. PR Intent
- Root-cause fix for the recurring cross-page banner date bug (company/ai-recommendations showed 07/16 while homepage showed 07/17, same trading day 2026-07-17). Real root cause: NOT divergent resolvers — `resolveBannerLastCloseDate()` already delegates to the same `resolveAuthoritativeTradeDate()` the homepage uses. The bug is downstream: `data-state-copy.ts::formatAsOfDate()` and `index-snapshot-freshness.ts` each privately did `value.slice(0, 10)` on the resolved ISO string. That's correct for Taipei-local `"+08:00"` timestamps (KGI/TWSE overview format) but wrong for UTC `"Z"` timestamps (`marketContext.index.timestamp`, e.g. `"2026-07-16T16:00:00.000Z"` whose true Taipei calendar day is 07/17). Homepage happened to dodge it only because its KGI branch's timestamp format is already Taipei-local.
- Adds `lib/taipei-date.ts::taipeiCalendarDate()` as the single canonical UTC/local-instant → Taipei-calendar-day converter, and rewires the 3 naive-slice call sites through it. Also fixes an independent same-class weekday-derivation bug in `market-state-banner.ts`, and a `/market-intel` mobile 390px horizontal-overflow CSS bug (unrelated but bundled).
- Corresponds to sprint task: W6 Day-N product-walkthrough banner-date root-cause item (session_handoff 2026-07-17→18, "市場資料治本鏈" #1298/#1299/#1300/#1302 series; this is the follow-up closing the last banner-date gap).
- Base branch: `main` (verified `git merge-base origin/main origin/fix/banner-date-unify-jim-20260718` == `origin/main` HEAD `b52c5d75`, i.e. PR is 0 commits behind, branched directly off latest main — includes #1298/#1299/#1300/#1302 already).

## 2. Diff Summary
- 9 files changed, +204 / -15
- New: `lib/taipei-date.ts` (canonical helper) + `lib/taipei-date.test.ts` (6 cases) + `lib/banner-date-consistency.test.ts` (2 cross-page invariant tests)
- Modified: `lib/data-state-copy.ts` (`formatAsOfDate` routed through helper) + its test, `lib/index-snapshot-freshness.ts` (private `taipeiCalendarDate` deleted, imports shared one) + `lib/market-state-banner.ts` (weekday derivation routed through helper), `lib/heatmap-stale-render.test.ts` (regression case added), `public/ui-final-v031/market_intel/app.css` (mobile overflow fix, scoped inside existing `@media (max-width:640px)` block)
- No changes to `apps/api`, no DB migration, no auth/endpoint changes.

## 3. IUF Blocker Checklist

**§A Kill-switch/Real-order**: N/A — grepped full diff for `KILL_SWITCH|EXECUTION_MODE|place_order|submit_order|kgi.order.create|order/create` → zero matches. PASS.
**§B Auth/Secret**: N/A — no new endpoints, no session middleware touched. Grepped diff for `api_key|password|token|secret` → zero matches (docblock prose only, no literals). PASS.
**§C State/Schema**: N/A — no DB/migration/enum/state-machine changes. Pure frontend date-formatting + CSS. PASS.
**§D PR Hygiene**: Title `fix(web): unify banner close-date resolver + market-intel mobile overflow` — conventional commit format, matches single commit message. Branch name `fix/banner-date-unify-jim-20260718` matches `<type>/<topic>-<author>-<date>` convention. Base=main, DRAFT, single commit (Jim + Claude co-author). PR body lists root cause, scope, and an explicit test-plan checklist including a real-browser Playwright verification claim with concrete before/after scrollWidth numbers (734→390) and 4-page banner-label screenshots. PASS.
**§E IUF 不可越線**: No lane crossing (pure apps/web, no backend/strategy touch). No governance bypass — PR is DRAFT, not merged. No KGI `/order/create` calls. No redaction violation (no person_id/token in evidence). PASS.

CI (`gh pr checks 1303`): validate / W6 No-Real-Order Audit / Secret Regression / Playwright P0 Smoke / DB-mode Tests — **5/5 pass** (informational, this is Bruce's turf, not re-verified by Pete beyond confirming green).

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
None found.

### 🟡 Suggestions (should fix)
1. **Untested timezone-parsing edge case in `taipeiCalendarDate()`**: the function relies on `new Date(value)`, whose parsing semantics differ by input shape per the ECMA-262 spec — date-only strings (`"YYYY-MM-DD"`) parse as UTC midnight (proven safe here: adding Taipei's fixed +8h offset to a UTC midnight can never roll to the previous day, and can only roll forward within the same calendar day since 8h < 24h — this is why the "date-only passes through unchanged" test at `apps/web/lib/taipei-date.test.ts:7-9` is correct, not coincidental), and explicit-offset/`Z` strings parse as that instant (also correct, proven by the two rollover tests). **But** a bare local datetime string with no offset and no `Z` (e.g. `"2026-07-17T23:30:00"`) parses as the *host machine's local timezone*, which is ambiguous between dev (may be TST) and Railway prod (likely UTC) — this shape isn't tested anywhere in `taipei-date.test.ts`. Currently a non-issue because every real production source confirmed via grep (`kgi.ts`, `twse.ts` → `+08:00`; `marketContext.index.timestamp` → `Z`) always carries an explicit offset. Recommend adding a locked test (and/or an explicit runtime guard) so a future data source that ever emits a naked-local timestamp fails loudly in CI instead of silently reintroducing this exact bug class.
   - Location: `apps/web/lib/taipei-date.ts:33-37`
   - Failure scenario: if any future upstream (or a Fubon/other-broker adapter later) starts emitting timestamps like `"2026-07-17T23:30:00"` (no zone), and the deploy host's TZ differs from Taipei (Railway containers are typically UTC), `new Date(...)` would parse it as 23:30 UTC → the Taipei calendar day would come out one day ahead of the intended date — the exact regression this PR is fixing, just from a new source.
2. **Duplicate `taipeiCalendarDate(isoDate)` computation inside `formatTradeDateWithWeekday`**: `formatAsOfDate(isoDate)` (line 59) already internally calls `taipeiCalendarDate(value)`, then line 61 calls `taipeiCalendarDate(isoDate)` again to get `datePart` for the weekday derivation. Harmless (pure function, cheap), but slightly obscures that `mmdd` and `datePart` are guaranteed to agree — a comment noting "recomputed, not reused, for locality" would save the next reader a double-take.
   - Location: `apps/web/lib/market-state-banner.ts:59-61`

### 💭 Nits (nice to have)
1. `if (!datePart) return mmdd;` at `market-state-banner.ts:62` is dead code under current callers — if `mmdd` (from `formatAsOfDate`) is truthy, `taipeiCalendarDate(isoDate)` computed independently on the same `isoDate` cannot be null (same pure function, same input). Harmless defensive redundancy, not worth a diff churn to remove.
2. Other pre-existing `.slice(0, 10)` sites across the repo (e.g. `OhlcvCandlestickChart.tsx`, `InstitutionalPanel.tsx`, `final-v031-live.ts`'s `epochMs + 8h → toISOString().slice(0,10)` pattern) are correctly out of scope — verified each is either operating on already-date-only strings (OHLCV `bar.dt`) or uses a different-but-already-correct epoch+8h-then-UTC-slice technique, not the naive-slice-of-a-raw-ISO-string bug this PR targets. PR's "3 處" scope claim is accurate; no silent scope gap.

### ✅ Praise
- The root-cause narrative is unusually well-substantiated: the PR explicitly traces *why* the homepage didn't exhibit the bug (its KGI branch's timestamp format happens to already be Taipei-local) rather than hand-waving "homepage was fine." I independently re-derived this via `readMarketIndex()` in `app/page.tsx` (origin/main) and confirmed `updatedAt` can ALSO come from `contextIndex!.timestamp` — the same UTC-format field — when `resolveAuthoritativeTradeDate()` picks that source, meaning the homepage benefits from this fix too, not just company/ai-recommendations. The PR's claim holds under this deeper trace.
- The `banner-date-consistency.test.ts` invariant test is genuine, not decorative: it mocks two different upstream response shapes (UTC-format `market_context_index` vs Taipei-local `+08:00` twse) and asserts the SAME rendered label — this is exactly the right test shape to prevent this bug class from silently reappearing (per team's "wired but dead" recurring anti-pattern, this is the opposite: verified live-wired via `git grep` against `origin/main`, not just defined).
- Correctly proved (not just tested) that date-only string inputs (`"YYYY-MM-DD"`) are safe under the +8h Taipei conversion by construction: a positive 8h offset applied to a UTC midnight instant can only move forward within the same calendar day, never backward — this is a real structural guarantee, not incidental to the current test fixtures.
- Mobile CSS fix is correctly scoped: verified `.row2{grid-template-columns:1fr 320px}` base rule (line 86) is untouched, and the override lives entirely inside the pre-existing `@media (max-width:640px)` block — no desktop regression risk.

## 5. Verdict
- [x] **APPROVED** — 可 ready，無 blocker (2 🟡 suggestions, both non-blocking hardening/documentation items, no behavioral risk to current production data shapes)

## 6. Suggested Owner for Fixes
- 🟡 #1 (untested naked-local-timestamp edge case) → Jim (owner of this PR/helper) — low priority, add as a follow-up test lock whenever a new broker/data source is wired in (e.g. Fubon adapter work)
- 🟡 #2 (duplicate computation) → Jim — trivial, fold into next touch of this file, not worth a standalone PR

## 7. Re-review Required
NO

---
Reviewer: Pete
Date: 2026-07-18
Sprint: W6 (product-walkthrough banner-date root-cause chain)
