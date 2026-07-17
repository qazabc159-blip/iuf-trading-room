# PR #1295 Desk Review — Round 2 — Pete 2026-07-17

Branch: `fix/kgi-core-heatmap-price-corruption-jason-20260717`, commit `9f68c621`
(round 1 was `28579c64` → NEEDS_FIX 2🔴, see `pr1295_review.md`).

## 1. PR Intent
Round 2: fix the two 🔴 blockers Pete found in round 1 — (1) `parseTwseNumber("")`
returning `0` instead of `null`, (2) 3 undisclosed call sites with the identical
bare-`parseFloat(row.ClosingPrice)` comma-truncation bug.

## 2. Diff Summary (28579c64 → 9f68c621)
8 files changed, +218/-35.
- `data-sources/twse-openapi-client.ts:687-693` — `parseTwseNumber` now returns
  `null` for empty/whitespace-after-strip, before calling `Number()`.
- `kgi-heatmap-enricher.ts:135-141, 250-256` — both call sites hardened to
  `close === null || close <= 0` (belt-and-suspenders, not solely reliant on
  the helper fix).
- `server.ts:2858-2905` (`GET /api/v1/realtime/snapshot`, the canonical quote
  endpoint) — bare `parseFloat` replaced with `parseTwseNumber` for
  Close/Change/Open/High/Low/Volume, `close<=0` guard, + implausible-changePct
  whole-row drop via imported `isPlausibleChangePct`.
- `s1-sim-runner.ts:1296-1319` — `closeBySymbol` (TWSE + TPEX) now built via
  `parseTwseNumber`; downstream guard tightened `isFinite(close)&&close>0` →
  `close!=null&&close>0` (like-for-like, parse failures are `null` not `NaN`).
- `theme-refresh.ts:152-172` — same comma-safe parse + implausible-pct drop
  for theme-member mark-to-market feeding the LLM narrative prompt.
- Tests: 2 new unit/regression tests in `heatmap-consistency.test.ts`
  (`parseTwseNumber("")===null` direct assertion; empty-`ClosingPrice` row
  must yield `sourceState:"no_data"`, never `price:0`); `ci.test.ts`
  `STOCKDAYALL-SELFHEAL-6` import-string assertion updated to match new
  destructure.

## 3. Round-1 Blocker Re-verification

### 🔴#1 — `parseTwseNumber("")` → `0` not `null`
Re-derived, not trusted: `stripped === ""` now explicitly checked and returns
`null` before `Number()` runs (`twse-openapi-client.ts:689-690`). Confirmed:
- `parseTwseNumber("")` / `parseTwseNumber("   ")` / `parseTwseNumber(",")` →
  `null` (unit test + hand-traced: `",".replace(/,/g,"")` → `""` → empty
  branch fires).
- `parseTwseNumber("0")` (a genuinely-zero close) still returns `0`, not
  `null` — correctly distinguished from "no data"; this is pre-existing
  behavior unchanged by the fix and not a new risk (a real TWSE close is
  never legitimately 0, so this case doesn't currently arise in practice).
- Both `kgi-heatmap-enricher.ts` call sites additionally guard `close <= 0`
  independent of the helper — genuine belt-and-suspenders, not just moving
  the same single point of failure.
- New regression test constructs a row with `ClosingPrice: ""` and asserts
  `tile.sourceState === "no_data"` and `tile.price === null` — this is the
  exact scenario round 1 found untested; now covered.
**VERDICT: closed.**

### 🔴#2 — 3 undisclosed call sites with the same bug
Grepped `origin/<branch>` myself for `parseFloat(row.ClosingPrice)` /
`parseFloat(r.ClosingPrice)` repo-wide rather than trusting the PR's updated
file list:
- `server.ts:2890` (`/api/v1/realtime/snapshot`) — now `parseTwseNumber`. ✅
- `s1-sim-runner.ts:1305` — now `parseTwseNumber` for both TWSE and TPEX
  sources feeding `closeBySymbol`. ✅
- `theme-refresh.ts:166` — now `parseTwseNumber`. ✅
- Remaining bare `parseFloat(row.ClosingPrice)` at `twse-openapi-client.ts:1770`
  (`getTwseMarketBreadth`) and `:1878` (`getTwseLeaders`) — these are the
  **originally-disclosed** round-1 out-of-scope items (unchanged from round
  1, not newly hidden), and the round-2 report explicitly retains and
  supersedes that disclosure rather than dropping it. Acceptable as a
  documented, not silently-omitted, follow-up — flagging as 🟡 (see below),
  not reopening as 🔴 since it was never claimed fixed.
- Other `parseFloat(...ClosingPrice...)`-shaped hits at `server.ts:10262`
  (`_parseEodNum`) and `server.ts:19597` (`parseEodNum`) are pre-existing,
  already-comma-safe helpers (`.replace(/,/g,"")` before `Number()`/`parseFloat`)
  — a different, already-correct code path, not a missed instance of the bug.
**VERDICT: closed** (all 3 previously-undisclosed sites fixed; the 2
disclosed-and-retained out-of-scope sites are a known, documented gap, not a
new disclosure failure).

## 4. s1-sim-runner persisted-write integrity check (explicit ask)
Traced `quote_last_close` write path (`s1-sim-runner.ts:1267-1286`,
`upsertLastCloses` call) — **untouched by this diff**; only the upstream
`closeBySymbol` parse (feeding `p.last_price`) changed. This is a genuine
forward-only fix: future mark-to-market runs persist correct (comma-safe)
closes; rows already written to `quote_last_close`/`s1_audit_log` before this
merge are not touched, rewritten, or backfilled by this PR — confirmed by
diff inspection, not by trusting the report's own claim.

Report's own honesty check: report states it attempted (and failed, for a
legitimate infra reason — `pg.railway.internal` has no public endpoint from
this sandbox) to forensically check prod for historical corruption evidence,
and explicitly recommends Elva/Bruce run that check with real prod access.
This is the correct posture (disclosed unknown + concrete next step) rather
than a false "no impact" claim — no blocker.

## 5. IUF Blocker Checklist
- A. Kill-switch/real-order: N/A — no kill-switch/order-path touched. PASS.
- B. Auth/secret: no new endpoints, no secrets in diff. PASS.
- C. State/schema: no migration; touches `quote_last_close` write value
  only, not schema or write path. PASS.
- D. PR hygiene: branch/commit naming conventional; CI: validate / W6
  No-Real-Order Audit / Secret Regression / Playwright P0 Smoke / DB-mode
  Tests all green (`gh pr checks 1295`). PASS.
- E. Lane/governance: no scope violation observed. PASS.

## 6. Findings — Priority Ranked

### 🔴 Blockers
None remaining.

### 🟡 Suggestions
1. **Follow-up still open**: `getTwseMarketBreadth`/`getTwseLeaders`
   (`twse-openapi-client.ts:1770`, `:1878`) still bare-`parseFloat` the same
   field. Disclosed and retained across both rounds, not new — but these
   feed `/market/breadth` and `/market/leaders/twse`, both product-facing.
   Recommend a fast dedicated follow-up PR before the next ≥1,000-priced
   stock triggers the same corruption on those two endpoints.
2. **Historical-corruption forensic check** recommended in the report
   (`s1_audit_log`/`quote_last_close` since 2026-06-30 for
   `close < avg_cost*0.15` on a known ≥1,000-priced symbol) has not actually
   been run yet — owner is Elva/Bruce (prod DB access), not this PR. Track
   as an open action item, don't let it silently drop.

### 💭 Nits
1. `theme-refresh.ts` and `server.ts` each do a fresh dynamic
   `await import("./kgi-heatmap-enricher.js")` per call for `isPlausibleChangePct`
   — fine functionally (module cache dedupes the cost), just duplicated
   import lines across 3 files now; could hoist to the shared
   `data-sources/twse-openapi-client.ts` module alongside `parseTwseNumber`
   in a later cleanup pass. Not blocking.

### ✅ Praise
- Genuine re-derivation discipline in the fix itself: didn't just patch the
  one reported symptom, added a direct unit test for the helper's edge case
  AND an integration-level regression test for the call-site behavior —
  exactly the two-layer test coverage round 1 found missing.
- The impact-assessment section on `s1-sim-runner.ts` is a model of honest
  disclosure under uncertainty: named the concrete corruption signature,
  attempted a real prod check, explained precisely why it couldn't complete
  the check (no public DB endpoint, correctly did not bypass that as
  out-of-authorization), and handed a concrete actionable query to the
  people who can actually run it — rather than asserting "no impact" or
  silently dropping the question.

## 7. Verdict
- [x] APPROVED — ready, no blockers remaining (both round-1 🔴 confirmed
  fixed via independent re-derivation, not by trusting the report).

## 8. Suggested Owner for Fixes
- 🟡 #1 (breadth/leaders follow-up) → Jason (new PR)
- 🟡 #2 (prod forensic query) → Elva / Bruce

## 9. Re-review Required
NO (unless the 🟡 breadth/leaders follow-up itself becomes a new PR, which
would get its own fresh review).

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6 Day (paper sprint, 2026-07-17 round)
