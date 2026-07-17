# PR #1300 Desk Review — Pete 2026-07-18

## 1. PR Intent
- P0 data-honesty fix: `/companies/2330` and `/companies/3661` showed 最新價 (2,470.0 / 3,770.0)
  physically **exceeding** 當日最高 (2,395.0 / 3,655.0), because `/companies/:id/quote/realtime`'s
  EOD-fallback tier fetched TWSE/TPEX OpenAPI live (publish-lagged, still one session behind) while
  `companies_ohlcv` (fed by the separate EOD cron) had already landed the newer trading day. Same
  publish-lag disease as #1299's index headline regression, different endpoint.
- Fix: cross-validate the live EOD fetch's date against persisted `companies_ohlcv` bars via the
  shared `resolveAuthoritativeTradeDate()` gate (#1299's gate), superseding live only when the
  persisted bar is a strictly newer trading day. Plus new structural invariant #6
  `verifyPriceWithinDailyRange()`.
- Sprint task: P0 prod-verify fix, backend-only (author explicitly stayed out of `apps/web`/Jim's lane).
- Base branch: `main` — correct.

## 2. Diff Summary
- 5 files changed, +381 / -20.
- `apps/api/src/server.ts`: new module-scope `EodFallbackResult`/`PersistedOhlcvBar` types, new
  `_queryLatestPersistedOhlcvBars()`, new pure `mergeEodFallbackWithPersistedBars()`, `_twseEodFallback`
  now wraps a renamed `_twseEodFallbackLive` + the persisted cross-check.
- `apps/api/src/market-data-integrity-gate.ts`: new `verifyPriceWithinDailyRange()` + 2 new
  `IntegrityRejectionReason` variants.
- 2 test files (+39 in existing, +170 new), `package.json` registers the new test file.
- No `apps/web`, no migrations, no real-money/broker paths touched.

## 3. IUF Blocker Checklist

**A. Kill-switch / Real-order safety** — N/A, no order paths, no KILL_SWITCH/EXECUTION_MODE touched. PASS.
**B. Auth / Secret hygiene** — no new endpoints, no secrets, no PII in the new code. PASS.
**C. State / Schema integrity** — no schema/migration change; new DB read query uses `execRows()`
  normalizer correctly, not the raw-array-vs-`.rows` landmine. PASS.
**D. PR hygiene** — title matches P0 fix pattern; commit message is a well-structured conventional
  commit; DRAFT correctly pending Pete review; description accurately describes the diff (verified
  by independent re-derivation below, not by trusting the prose). PASS.
**E. Lane boundaries** — author explicitly disclosed staying out of `apps/web`
  (`CompanyHeroBar.tsx`'s dual-source `bestPrice`/`changePercent` root cause named but NOT touched);
  no migration, no W6, no Mike-owned files touched. PASS.

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)

1. **Invariant #6 (`verifyPriceWithinDailyRange`) is defined + unit-tested but never called from
   any production code path — the PR's own claim that it "catches this bug class in CI going
   forward" is false.**
   - 位置: `apps/api/src/market-data-integrity-gate.ts:243` (definition) — grepped the entire
     branch tree (`apps/api/src`): the only call sites are
     `apps/api/src/__tests__/market-data-integrity-gate.test.ts` and
     `apps/api/src/__tests__/quote-realtime-persisted-supersede.test.ts`. Zero references in
     `server.ts` or anywhere else outside `__tests__/`.
   - 原因: This is the exact "wired in definition, dead at call site" anti-pattern that is the
     single most recurring bug class across past Pete reviews (see
     `.claude/agent-memory/pr-reviewer-pete/MEMORY.md` cross-cutting rules). The core fix
     (`mergeEodFallbackWithPersistedBars` + `resolveAuthoritativeTradeDate`) does correctly prevent
     the literal reported repro — verified independently below — so today's specific symptom is
     genuinely fixed. But invariant #6 was pitched as the durable structural guard against this
     *class* of bug for the future (any other code path, or a later refactor of the merge/tie-break
     logic that reintroduces a date mismatch). As shipped, nothing in the live `/quote/realtime`
     response path ever runs this check against what is actually served — it only re-validates
     itself against hand-picked literals in a unit test. If a future change reintroduces
     "price outside its own day's range" via a different route than this exact merge function, CI
     will not catch it, contradicting the PR's stated intent.
   - 建議: Call `verifyPriceWithinDailyRange(result.lastPrice, result.high, result.low)` at the
     actual point the route builds its EOD-fallback JSON response (e.g. right after
     `mergeEodFallbackWithPersistedBars()` returns, or inside it before returning), with an explicit
     fail-safe behavior (log `console.warn` + degrade `state`/`note`, do not silently serve an
     invalid tuple). Owner: Jason.

### 🟡 Suggestions (should fix)

1. **`_queryLatestPersistedOhlcvBars()`'s `db.execute()` has no explicit timeout**, unlike the
   sibling live fetches in the same route (MIS fetch uses `AbortSignal.timeout(4000)`). Every
   request that reaches the deep EOD-fallback tier now does one extra unconditional DB round-trip.
   It's wrapped in try/catch and fails open to `[]` on error (no crash risk), but a slow/hung DB
   connection (not an outright error) could still add latency to this path with no upper bound.
   Not a new pattern this PR invented (matches existing DB-read conventions elsewhere in
   `server.ts`), so not blocking, but worth a bound given it's now on every deep-fallback request.
   Owner: Jason.

2. **Edge case in `_buildTwseEodResult`/`_buildTpexEodResult`: a found EOD row with an unparseable
   price still carries a valid `dataDate`.** If `_parseEodNum(row.ClosingPrice)` returns `null`
   (state becomes `NO_DATA`) but `parseRocEodDateIso(row.Date)` succeeds, `live.dataDate` is
   non-null. If that date happens to tie or be newer than the persisted bar's date,
   `mergeEodFallbackWithPersistedBars` will NOT supersede (per its by-design tie/older-never-wins
   rule), so the response stays `NO_DATA` even though a usable persisted bar for an equal-or-older
   date exists. Narrow (requires a found-but-price-corrupted upstream row), not the reported P0,
   but worth a regression test given this file's history of upstream wire-format surprises. Owner: Jason.

## 5. Verification notes (re-derived independently, not trusted from PR prose)

- **Concern ① (盤中即時價被蓋成昨收?) — verified structurally impossible.** Traced the full
  `/api/v1/companies/:id/quote/realtime` route: `_twseEodFallback`/`_twseRealtimeFallback` is
  reachable **only** after both (a) KGI's live tick/subscribe fails, AND (b) `_twseMisIntradayFetch`
  (real TWSE MIS intraday quote) also returns `null`. Every call site (whitelist-block branch,
  subscribe-fail branch, tick-fail branch) returns the MIS result immediately when MIS succeeds,
  before ever reaching `_twseEodFallback`. Since `mergeEodFallbackWithPersistedBars` only runs
  inside `_twseEodFallback`, it can never override a genuine live intraday tick — it only ever
  arbitrates between two already-EOD-tier candidates (live TWSE/TPEX OpenAPI EOD vs persisted
  `companies_ohlcv`). This also means the "persisted bar might be an incomplete same-day snapshot"
  risk is not a new risk this PR introduces: `companies_ohlcv` is fed by
  `runOhlcvFinmindSync`/FinMind `TaiwanStockPriceAdj` (a finalized-daily-bar dataset, not intraday
  ticks), and the hero bar's 最高/最低 already trusts this exact same table today, pre-PR.
- **Same-day tie / persisted-older-never-overrides / no-persisted-noop / NO_DATA-gap-filled** — all
  4 re-derived by hand-tracing `resolveAuthoritativeTradeDate`'s `key > best.tradeDateKey` (strict
  `>`, array order `[live_eod, persisted_ohlcv]`): tie → `best` stays `live_eod` (persisted never
  overtakes on `>`) → `chosenSource !== "persisted_ohlcv"` → `mergeEodFallbackWithPersistedBars`
  returns `live` unchanged. Persisted older → same outcome. Live `dataDate: null` (NO_DATA) →
  `taipeiCalendarDateKey(null)` is `null` → `continue`s past the live candidate → persisted wins by
  default. All 4 match the 6 tests in `quote-realtime-persisted-supersede.test.ts`; tests genuinely
  exercise the claimed directions, not just the happy path.
- **Concern ② (invariant #6 boundary: 漲跌停 close==high/low) — correct.** `close > high` / `close <
  low` are strict inequalities in `verifyPriceWithinDailyRange` (`market-data-integrity-gate.ts`),
  so a limit-up/limit-down close exactly equal to high/low passes. Confirmed by
  `market-data-integrity-gate.test.ts`'s explicit `verifyPriceWithinDailyRange(2290.0, 2395.0,
  2290.0)` (close==low) asserting `valid:true`. (Function is correct — see 🔴 #1 for the
  call-site gap, a different issue from correctness.)
- **Concern ③ (cross-check bound?) — see 🟡 #1.** Fails open on error, no hard timeout.
- **Concern ④ (date authority across midnight/mid-session) — safe.**
  `resolveAuthoritativeTradeDate` is a pure comparison of two already-resolved date strings; it
  never consults wall-clock "today" (unlike #1299's `mostRecentTradingDayYYYYMMDD`), so there is no
  midnight/mid-session wall-clock dependency in this reused function. Already independently
  reviewed/approved as part of #1299.
- **Concern ⑤ (2330=2,290 / 3661=3,480 pinned regression values) — could not independently verify
  against a live TWSE feed** (no live network tool in this review pass; no corroborating evidence
  file found under `evidence/` for the original prod-verify report as of this review). The PR
  attributes these numbers to "Elva prod verify" catching the live mismatch and backing out the
  true close from the displayed changePct. Tests correctly assert internal consistency (given these
  inputs, the merge/invariant produce the claimed outputs) — that part is verified true regardless
  of whether the pinned literals are themselves TWSE-official. Flagging as a disclosed
  verification-limit, not a code defect.
- **Concern ⑥ (lane/scope) — clean.** File list is exactly `apps/api/src/server.ts`,
  `apps/api/src/market-data-integrity-gate.ts`, 2 test files, `package.json` (test registration).
  No `apps/web`, no `packages/db/migrations`, no real-order/W6 paths, no Jim/Mike-owned files.

## 6. ✅ Praise
- The persisted-bar `dt` query explicitly casts `dt::text` in SQL rather than letting postgres-js
  hand back a JS `Date` object — correctly citing and avoiding a previously-diagnosed locale-format
  landmine already documented for other `companies_ohlcv` reads in this same file.
- The 6-test guard-rail suite for `mergeEodFallbackWithPersistedBars` genuinely locks both
  directions (supersede only when strictly newer; never regress a fresher/tied live result) with
  real behavioral assertions, not source-string checks — this is exactly the shape of test the
  reviewer wants for a "which direction does the override go" bug class.
- Honest scope discipline: root-caused the frontend half of the bug
  (`CompanyHeroBar.tsx` mixing `realtimeQuote.lastPrice` with `quote.changePercent`) but explicitly
  declined to touch `apps/web` since that's Jim's lane, choosing instead to close the gap at the
  backend source — correctly reasoned trade-off, clearly disclosed, not silently punted.

## 7. Verdict
- [ ] APPROVED
- [x] **NEEDS_FIX** — 1 blocker (dead invariant call-site), 2 suggestions.
- [ ] BLOCKED

## 8. Suggested Owner for Fixes
- 🔴 #1 (wire `verifyPriceWithinDailyRange` into the real response path) → Jason
- 🟡 #1 (DB query timeout bound) → Jason
- 🟡 #2 (found-row-but-unparseable-price edge case) → Jason

## 9. Re-review Required
YES — after 🔴 #1 is wired in, a quick re-check that the call site actually degrades gracefully
(doesn't hard-throw/500 on a legitimately-invalid tuple) is sufficient; no need to re-derive the
whole merge logic again.

---
Reviewer: Pete
Date: 2026-07-18
Sprint: sprint_2026_07_18 (W6 paper sprint continuation)
