# PR #1315 Desk Review — Pete 2026-07-20

## 1. PR Intent
- Fix a prod symptom: `/m` mobile watchlist (`includeStale=true`) shows an ancient residual manual/tradingview quote (2330 → 875, 0050 → 100.15) instead of the real official close (2,290 / 201.35), because `resolveMarketQuotes()` picks the eligible candidate purely by **source priority** once `includeStale=true`, never by recency — so a months-old cached tick from a lower-tier source still outranks "no fresh candidate." `_applyOfficialCloseFallback`'s old guard (`selectedQuote !== null` ⇒ never touch) let that ancient value permanently block the `official_close` DB fallback.
- Fix: replace the blanket "never touch a non-null selectedQuote" guard with a recency arbitration — official_close only replaces an existing **stale** selection when official_close's own timestamp is `>=` the stale quote's timestamp. Fresh selections are always left alone (unchanged, first line). DB lookup set (`lookupSymbols`) broadened from "selectedQuote===null" to "freshnessStatus!=='fresh'" so quote_last_close is actually queried for previously-blocked-by-staleness symbols.
- Corresponds to: Elva's explicit 09:00-open dispatch (prod finding on `/m`), not a numbered sprint ticket.
- Base branch: `main` (not part of a stacked chain; standalone hotfix). Confirmed via `gh pr view` — correct.

## 2. Diff Summary
- 2 files changed. `apps/api/src/market-data.ts`: +40/-9 (two hunks: `_applyOfficialCloseFallback` guard rewrite + docstring; `getEffectiveMarketQuotesWithOfficialCloseFallback` lookup-set broadening). `apps/api/src/__tests__/effective-quotes-official-close-fallback.test.ts`: +160/-0 (3 new "ROUND 3" tests appended, no existing tests touched).
- LOC: +200 / -9.

## 3. IUF Blocker Checklist

**A. Kill-switch / Real-order safety** — N/A. Full diff grepped for `KILL_SWITCH`/`EXECUTION_MODE`/`place_order`/`submit_order`/`order/create` — 0 hits. No order paths touched. PASS.

**B. Auth / Secret hygiene** — N/A. No new endpoint, no secrets/tokens in diff (grepped). Route already behind existing session middleware (unchanged). PASS.

**C. State / Schema integrity** — No DB schema change, no migration needed. No new enum member (`freshnessStatus`/`QuoteResolutionFreshnessStatus` unchanged — reuses existing `"fresh"|"stale"|"missing"|"closed_snapshot"`). PASS.

**D. PR hygiene** — Branch name follows `fix/<topic>-<author>-<date>` convention. Title is conventional-commit style (`fix: ...`). DRAFT status correct. Description has clear root-cause narrative, guarantees-preserved section, explicit scope statement, and test-plan checklist with commands run. PASS.

**E. IUF 不可越線** — No lane violation (Pete review only, no code touched by reviewer). No governance bypass — DRAFT, CI required, not self-merged. No KGI gateway `/order/create` calls. No redaction-policy issue (evidence below has no person_id/token). PASS.

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
None found.

### 🟡 Suggestions (should fix, non-blocking)
1. **Timestamp cross-source recency comparison isn't schema-enforced** — `quoteSchema.timestamp` in `packages/contracts/src/marketData.ts:68` is a plain `z.string()`, not `.datetime()`. The recency comparison (`item.selectedQuote.timestamp >= closeTimestampIso`) is only lexicographically safe because *every current write path* normalizes through `toIso()` (line ~650, `market-data.ts`) which always emits `.toISOString()` UTC-Z format before persisting. I traced this for manual (`upsertProviderQuotes`), tradingview, and `quote_last_close` (`dateToTaipeiIso`) — all consistent today. But nothing in the type system stops a future provider from writing a differently-formatted timestamp (e.g., `+08:00` offset without normalizing) and silently breaking the `>=` comparison. Consider tightening `quoteSchema.timestamp` to `z.string().datetime()` (UTC) as a follow-up, or at minimum a comment in `_applyOfficialCloseFallback` noting this invariant dependency (partially present, could be more explicit).
   - Position: `apps/api/src/market-data.ts:2862` (comparison), `packages/contracts/src/marketData.ts:68` (schema)
   - Owner: Jason (author) / low priority, no known current violator.
2. **DB query frequency increase during off-hours/all-stale windows not called out in test plan** — broadening `nonFreshExistingSymbols` from "null only" to "not fresh" means `getLastCloses()` now runs on essentially every `/m` poll during off-hours (when nothing is fresh), not just for missing symbols. This is bounded per-request (`WHERE symbol IN (...)`, confirmed via `quote-last-close-store.ts:106-111` — no unbounded scan, no cross-symbol leakage) so it's not a correctness or safety issue, just a quantitative increase in read load proportional to `/m`'s poll interval × watchlist size. Worth a quick post-merge glance at Postgres query volume on `quote_last_close` if `/m` polls aggressively, but not worth blocking a time-sensitive fix over.
   - Position: `apps/api/src/market-data.ts:3210-3226`
   - Owner: Bruce (post-deploy observability), FYI only.

### 💭 Nits
1. Docstring at line ~2823 says "requirement #3 of the 2026-07-19 dispatch" — now slightly stale since this is a 2026-07-20 round-3 fix; harmless, just a dating nit if anyone re-reads later.

### ✅ Praise
- Root-cause narrative is precise and testable: I independently re-derived the exact mechanism (`eligible = quote!==null && (includeStale||freshnessStatus==="fresh")` picking by source-priority-only order) from `resolveMarketQuotes()` at `market-data.ts:2609-2615/2629` and it matches the PR description exactly — no hand-waving.
- Deliberately chose the harder-but-correct fix (recency arbitration) over the simpler "official_close always wins over any stale source" option, and proved the harder choice was necessary with a dedicated regression test (ROUND 3 test #2: near-fresh same-day stale quote must still beat yesterday's close) — this is exactly the kind of boundary-case test that would have caught a naive fix.
- Explicitly re-verified and documented in the PR body which downstream consumers are NOT touched (`getMarketDataConsumerSummary`/`SelectionSummary`/`DecisionSummary`, i.e. the risk/strategy/paper path) — I independently confirmed via grep that only the `/effective-quotes` HTTP route wires `getEffectiveMarketQuotesWithOfficialCloseFallback`, while `strategy-engine.ts` and the other summary functions call the untouched `getEffectiveMarketQuotes()` directly.
- 3 new tests are genuine repro coverage, not decorative: test #1 uses the PR's own reported numbers (90-day-old manual quote, 100.15 → 201.35), test #2 locks in the boundary that must NOT regress, test #3 confirms the fresh-path early-return is untouched.

## 5. Verdict
- [x] **APPROVED** — 可 ready，無 blocker（CI 5/5 green: W6 No-Real-Order Audit / validate / Secret Regression / DB-mode Tests / Playwright P0 Smoke all SUCCESS as of 2026-07-19T18:1x）.

## 6. Suggested Owner for Fixes
- 🟡 #1 (schema tightening) → Jason, low priority, non-blocking follow-up.
- 🟡 #2 (DB query volume watch) → Bruce, post-deploy observability note only.

## 7. Re-review Required
NO — clear to mark ready and merge given time-sensitive 09:00-open window.

---
Reviewer: Pete
Date: 2026-07-20
Sprint: W6 Day (paper sprint, prod hotfix — Elva 09:00 dispatch)
