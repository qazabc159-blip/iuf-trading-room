# PR #1295 Desk Review — Pete 2026-07-17

## 1. PR Intent
- Fix kgi-core heatmap price corruption: 5/40 tiles (2330/2454/2308/3008/6669, all ≥1,000-priced)
  served `price:2`-style single-digit garbage with `changePct:null`. Root cause: bare `parseFloat()`
  on TWSE `ClosingPrice`/`Change` truncates at the thousands-comma (`"2,470.0000"` → `2`).
- Fix reuses existing comma-safe `parseTwseNumber()` (exported from twse-openapi-client.ts) in both
  `kgi-heatmap-enricher.ts` call sites, and adds defense-in-depth: an implausible computed `changePct`
  (outside ±10% daily limit band) now drops the **whole row** instead of nulling only `changePct`
  while still serving the corrupted price.
- Sprint task: reports/sprint_2026_07_17/KGI_CORE_HEATMAP_PRICE_CORRUPTION_2026_07_17.md (self-filed,
  traces to Bruce's PROD_FINAL_VERIFY_2026_07_17.md §9 point 4).
- Base branch: main (single commit `28579c64`, not part of a stacked chain).

## 2. Diff Summary
- 5 files changed: +152/-17
- `apps/api/src/data-sources/twse-openapi-client.ts` — export `parseTwseNumber` (+doc comment, body unchanged)
- `apps/api/src/kgi-heatmap-enricher.ts` — 2 call sites switched from `parseFloat` to `parseTwseNumber`; implausible-pct guard changed from "null pct, keep price" to "skip whole row"
- `apps/api/src/__tests__/heatmap-consistency.test.ts` — +2 regression tests
- `tests/ci.test.ts` — `HEATMAP-GARBAGE-2` assertion corrected to match new "skip whole row" behavior (now consistent with sibling `HEATMAP-GARBAGE-3`)
- `reports/sprint_2026_07_17/KGI_CORE_HEATMAP_PRICE_CORRUPTION_2026_07_17.md` — RCA + fix doc

## 3. IUF Blocker Checklist
- A. Kill-switch/real-order: N/A — no order/execution-mode/KGI-order code touched. PASS
- B. Auth/secret: N/A — no new endpoint, no secrets. PASS
- C. State/schema: no DB migration involved; runtime state = existing in-memory `_lastCloseCache`/`twseMap`, behavior change only (values, not shape). PASS
- D. PR hygiene: title/commit follow `fix(api): ... (P1)` convention; single non-stacked commit; report doc present with verification section. PASS (see 🟡 re: incomplete "out of scope" disclosure below)
- E. Lane/governance: no cross-lane edits, no bypass. PASS

## 4. Findings — Priority Ranked

### 🔴 Blockers (must fix before ready)
1. **`parseTwseNumber()` silently returns `0` for empty/whitespace-only strings, not `null`** — reintroduces the exact "silently serve a wrong number" bug class this PR exists to kill, just via a different trigger string.
   - 位置: `apps/api/src/data-sources/twse-openapi-client.ts:679-682` (`Number(String(value).replace(/,/g,"").trim())` — `Number("")` and `Number(" ")` both evaluate to `0`, which `Number.isFinite` accepts); reused at `apps/api/src/kgi-heatmap-enricher.ts` (`updateLastCloseFromTwse` close-parse line, and the `twseMap` builder inside `enrichHeatmapTiles`).
   - Failure scenario: a `HEATMAP_CORE_SYMBOLS` row where TWSE returns `ClosingPrice:""` (and/or `Change:""`) for a no-trade EOD (e.g. a blue-chip halted for a corporate action that day). `close = parseTwseNumber("") = 0` — not `null`, so the `close === null` skip does **not** fire. If `Change` is also empty, `changeVal = 0`, `close - changeVal === 0` so `prevClose = null` → `pctRaw = null`. The new implausible-pct guard (`pctRaw !== null && !isPlausibleChangePct(pctRaw)`) only fires when `pctRaw` is non-null, so it does **not** catch this case either. Row is committed to cache/`twseMap` with `price: 0`. Tile renders `price:0` instead of falling through to the next tier / `no_data` — directly violating the repo's own 缺價不當0 product law and reproducing the "corrupted price served" failure shape this PR's own comment calls out ("Serving `price:2, changePct:null` is exactly the bug this guard closes" — `price:0, changePct:null` slips through untouched).
   - Verified reachable in node: `Number("")` → `0`, `Number("  ")` → `0` (vs. `Number("--")`/`Number("X")` → `NaN`, correctly rejected). Neither new regression test (comma-value, garbage-pct-value) exercises the empty-string input, so this gap ships untested.
   - 建議: harden `parseTwseNumber()` itself — reject empty/whitespace-only strings (`if (trimmed === "") return null;`) before the `Number()` call. One-line fix, same file already being touched.

2. **PR's "Out of scope" disclosure understates the real blast radius — omits at least 2-3 more live call sites with the identical, already-prod-proven bug.**
   - 位置: report doc names only `twse-openapi-client.ts` `getTwseMarketBreadth`/`getTwseLeaders` (~lines 1753/1861) as remaining risk. Grep of `origin/main` for the same `parseFloat(row.ClosingPrice)` pattern turns up: `apps/api/src/server.ts:2881` (inside `GET /api/v1/realtime/snapshot` — the file's own comment calls this the "**Canonical** quote snapshot endpoint," i.e. product-facing, not a secondary aggregate), `apps/api/src/s1-sim-runner.ts:1296`, and `apps/api/src/theme-refresh.ts:160` — none mentioned.
   - Failure scenario: a teammate reads "Out of scope: breadth/leaders" and reasonably (but wrongly) concludes the canonical `/realtime/snapshot` quote path is safe. It is not — any ≥1,000-priced symbol requested through that endpoint on a day its `ClosingPrice` carries a thousands-comma will silently return the same single-digit corrupted price, on a route explicitly documented as canonical/shared.
   - 建議: correct the report's "Out of scope" section to name all 3-4 call sites (not just 2 lines in 1 file) before this is treated as "tracked separately, safe to defer" — this changes the urgency/owner-priority of the promised follow-up ticket.

### 🟡 Suggestions (should fix)
1. The "skip whole row on implausible pct" behavior change (Tier 2 `twseMap` + `_lastCloseCache`) is a net safety improvement and correctly brought Tier 2 in line with the pre-existing Tier 1 (`HEATMAP-GARBAGE-3`) precedent — but it does mean a false-positive implausible-pct computation (e.g. an un-adjusted ex-rights/ex-dividend reference price edge case, however rare for this blue-chip-only universe) now discards a possibly-still-valid `price` along with the bad `pct`, where previously the price would have survived. Low likelihood given `isPlausibleChangePct`'s own comment ("40 established large-caps... none are newly-listed or disposition-category"), not blocking, but worth a one-line note in the report acknowledging the tradeoff.

### 💭 Nits
1. `HEATMAP-GARBAGE-2` test name/assert messages still literally say `"HEATMAP-GARBAGE-2: implausible row must not be served..."` on the renamed test — harmless but slightly stale copy-paste inside the assertion string itself (not the `test()` title, which was correctly reworded).

### ✅ Praise
- The two new regression tests (`heatmap-consistency.test.ts`) precisely reproduce the actual prod symptom with real TWSE row shapes (`"2,470.0000"`/`"-30.0000"`) rather than synthetic round numbers, and assert both the positive case (comma value parses fully) and the negative case (corrupted row never leaks a price) — good coverage discipline for the bug class actually observed.
- Correcting `HEATMAP-GARBAGE-2`'s prior expectation (which had encoded the bug's own broken shape as "expected behavior") instead of just leaving it green is exactly the right move, and the report explicitly calls out *why* the old assertion was wrong rather than silently loosening it — this is a genuine bug-fix to a test, verified against the still-intact sibling `HEATMAP-GARBAGE-3` for consistency, not a scope-narrowing.
- RCA report is unusually rigorous for a 1-commit P1 fix: names the exact prod symptom, the exact secondary defect (existing guard nulled pct but still served price), and proactively (if incompletely, see 🔴 #2) discloses adjacent risk instead of staying silent about it.

## 5. Verdict
- [x] NEEDS_FIX — 2 blockers, owner to fix and re-review

## 6. Suggested Owner for Fixes
- 🔴 #1 (parseTwseNumber empty-string→0 landmine) → Jason
- 🔴 #2 (incomplete out-of-scope disclosure, /realtime/snapshot exposure) → Jason (fix report doc scope list; separately escalate urgency of the follow-up ticket to Elva given canonical-endpoint exposure)
- 🟡 #1 → Jason (optional, note-only)

## 7. Re-review Required
YES

---
Reviewer: Pete
Date: 2026-07-17
Sprint: W6 Day (paper sprint, 2026-07-17)
