# kgi-core heatmap price corruption — RCA + fix (2026-07-17)

Reported by: Bruce, `PROD_FINAL_VERIFY_2026_07_17.md` §9 point 4 (🟡 finding, not fixed at the
time). 5/40 tiles (2330/2454/2308/3008/6669) served `price` as a single digit (e.g. 2330
`price:2`) with `change` real (`-180`) but `changePct:null`.

## Root cause

`StockDayAllRow.ClosingPrice` (and `Change`) are TWSE-formatted strings that gain a
thousands-comma once the value crosses 1,000 (e.g. `"2,470.0000"`). Two call sites in
`apps/api/src/kgi-heatmap-enricher.ts` (`updateLastCloseFromTwse` and the `twseMap` builder
inside `enrichHeatmapTiles`) parsed this with a bare `parseFloat()`, which stops at the first
non-numeric character — `parseFloat("2,470.0000")` silently returns `2`. Every one of the 5
corrupted symbols was priced ≥1,000 that day; the other 35 (all <1,000, no comma) parsed fine.
This affected both the primary STOCK_DAY_ALL fetch and the `www rwd afterTrading` self-heal
fallback equally (same `StockDayAllRow` shape, same broken parse downstream) — not specific to
the timeout/self-heal path Bruce suspected.

Secondary defect: `isPlausibleChangePct()` already existed to reject an implausible computed
`changePct`, but only nulled the `changePct` field while still serving the (corrupted) `price` —
exactly the `price:2, changePct:null` shape observed in prod. An existing test
(`HEATMAP-GARBAGE-2` in `tests/ci.test.ts`) had actually encoded this as the *expected* behavior,
inconsistent with the sibling `HEATMAP-GARBAGE-3` test which correctly required Tier 1 to drop
the whole tile on an implausible pct.

## Fix

1. Exported the repo's existing comma-safe `parseTwseNumber()` helper from
   `apps/api/src/data-sources/twse-openapi-client.ts` (already used correctly elsewhere, e.g.
   `computeChangePct`) and reused it in both `kgi-heatmap-enricher.ts` call sites instead of
   duplicating parsing logic.
2. Defense-in-depth: when the computed `changePct` for a TWSE row is outside the ±10% daily
   limit band, the enricher now skips the **whole row** (falls through to Tier 2.5/cache/no_data)
   instead of nulling only `changePct` while still returning the price. Updated
   `HEATMAP-GARBAGE-2` to assert the corrected (consistent-with-Tier1) behavior.
3. Added 2 new regression tests in `apps/api/src/__tests__/heatmap-consistency.test.ts`:
   comma-formatted ClosingPrice must parse to the full value; an implausible-pct row must never
   leak a corrupted price (falls to `no_data`).

## Files changed

- `apps/api/src/kgi-heatmap-enricher.ts`
- `apps/api/src/data-sources/twse-openapi-client.ts` (export `parseTwseNumber`, +doc comment)
- `apps/api/src/__tests__/heatmap-consistency.test.ts` (+2 tests)
- `tests/ci.test.ts` (HEATMAP-GARBAGE-2 corrected)

## Verification

- `pnpm run build:packages` — 5/5 green
- `pnpm typecheck` — 15/15 green
- `pnpm --filter api build` — green
- `pnpm test` — 1865 tests, 1855 pass, 2 fail (both `finmind-client.test.ts` T3/T11,
  confirmed pre-existing on clean `origin/main` via `git stash` A/B compare, unrelated to this
  change)
- `python scripts/audit/w6_no_real_order_audit.py` — 6/6 PASS
- `python scripts/audit/secret_regression_check.py` — 0 findings

## Out of scope (noted, not fixed)

`apps/api/src/data-sources/twse-openapi-client.ts` lines ~1753/1861 (`getTwseMarketBreadth` /
leaders derivation) use the same unsafe `parseFloat(row.ClosingPrice)` pattern and are
susceptible to the identical comma-truncation bug for any ≥1,000-priced stock in the breadth/
leaders universe. Not touched here — outside the dispatched kgi-core heatmap scope; flagging
for a follow-up owner-dispatched fix (now that `parseTwseNumber` is exported, it's a 1-line
reuse per site).
