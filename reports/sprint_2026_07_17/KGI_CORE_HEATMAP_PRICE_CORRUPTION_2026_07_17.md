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

## Out of scope originally flagged (superseded — see Round 2 below)

Round 1 flagged only `getTwseMarketBreadth`/leaders derivation (~L1753/1861) as remaining risk.
Pete's review caught that this understated the real blast radius — see Round 2.

## Round 2 — Pete review (PR #1295) NEEDS_FIX, 2 blockers, both fixed same PR

Full review: `evidence/sprint_2026_07_17/pr1295_review.md` + PR #1295 comment. Verdict was
correct on both counts — 🟡#1 (tradeoff note on the ±10.5% guard) accepted as non-blocking.

### 🔴#1 — `parseTwseNumber("")` returned `0`, not `null`

`Number("")` and `Number("  ")` both evaluate to `0` in JS, which `Number.isFinite` happily
accepts. A no-trade EOD row (halted/corporate-action day) with an empty `ClosingPrice` would
parse to `price:0` and sail past the `close === null` skip — reintroducing the exact "silently
serve a wrong number" bug class this PR exists to kill, via a different trigger string than the
comma-truncation case.

**Fix**: `parseTwseNumber()` now explicitly rejects the empty-after-strip case
(`if (stripped === "") return null;`) before calling `Number()`. Additionally, per Pete's
suggested hardening, both `kgi-heatmap-enricher.ts` call sites now also explicitly guard
`close === null || close <= 0` rather than trusting the parse result alone (belt-and-suspenders —
the fixed `parseTwseNumber` alone would already be correct, but a future refactor should not be
able to silently reintroduce this by only checking `=== null`).

**Tests added**: a direct `parseTwseNumber` unit test (empty/whitespace/`","` → `null`; real and
comma-formatted values still parse correctly) + a `kgi-core heatmap` regression test asserting an
empty `ClosingPrice` row falls through to `no_data`, never `price:0`.

### 🔴#2 — "Out of scope" disclosure understated the blast radius

Pete's grep of `origin/main` found the identical bare `parseFloat(row.ClosingPrice)` pattern at
3 more live call sites beyond the 2 originally named (breadth/leaders):

1. **`apps/api/src/server.ts` — `GET /api/v1/realtime/snapshot`** (the file's own comment calls
   this the "**Canonical** quote snapshot endpoint" — product-facing, more central than the
   heatmap). Fixed: comma-safe parse for `ClosingPrice`/`Change`/`OpeningPrice`/`HighestPrice`/
   `LowestPrice`/`TradeVolume`, `close <= 0` guard, and the same "drop whole row on implausible
   changePct" defense-in-depth as the heatmap enricher (imports `isPlausibleChangePct` from
   `kgi-heatmap-enricher.ts`).
2. **`apps/api/src/s1-sim-runner.ts:1296`** (S1 SIM mark-to-market — see impact assessment below).
   Fixed: comma-safe parse for both the TWSE `ClosingPrice` and TPEX `Close` sources feeding
   `closeBySymbol`; downstream guard tightened from `isFinite(close) && close > 0` to
   `close != null && close > 0` (parse failures are now `null`, not `NaN`, so this is a like-for-
   like tightening, not a behavior change for valid data).
3. **`apps/api/src/theme-refresh.ts:160`** (theme member mark-to-market `changePct`, fed into an
   LLM narrative prompt — not displayed as a raw number, but a corrupted % move could still bias
   the generated thesis text). Fixed: comma-safe parse + same implausible-pct drop.

The RCA's "Out of scope" section above is retained for history but is **superseded** — all 5
identified call sites (2 in this PR's original scope + 3 found by Pete) are now fixed in this
same PR.

### Impact assessment — s1-sim-runner.ts (per dispatch's explicit instruction: assess before
### silently fixing, since this feeds the S1 SIM ledger)

This call site has existed since PR #1060 (2026-06-30) and feeds `p.last_price` /
`p.market_value_twd` / `p.unrealized_pnl_twd` for S1 SIM positions, and is persisted into the
`quote_last_close` DB table (`upsertLastCloses`) — i.e. a durable ledger write, not just a
transient display value. **If S1 ever held a position in a stock priced ≥1,000 on a day this
mark-to-market ran, that position's `last_price` would have been silently corrupted to a
single-digit value**, producing a wildly incorrect `unrealized_pnl_twd` (and a spuriously tiny
persisted `quote_last_close` row for that symbol/date).

**Could not confirm or rule out historical occurrence** — this repo's S1 universe is drawn
dynamically from the `companies` table (any 4-digit TWSE ticker, no price filter — see
`s1-sim-runner.ts` universe-selection code), so it is not excluded by construction; several of
the exact symbols known to be ≥1,000-priced (2330/2454/3008/6669) are plausible/likely present in
the seeded universe. Attempted a read-only forensic check against prod Postgres from this
sandbox (`railway run`/`railway connect pg`) to inspect `s1_audit_log`/persisted
`quote_last_close` rows for the corruption signature (a mark-to-market close implausibly below
~10% of a position's `avg_cost`) — **could not reach prod DB**: the `pg` service only exposes a
private Railway-network hostname (`pg.railway.internal`), no `DATABASE_PUBLIC_URL` is configured
(by design), so it is unreachable from outside Railway's network. Did not attempt to temporarily
expose a public DB endpoint — that is an infra/security change outside this session's scope and
authorization.

**No historical data was silently rewritten** — the fix is forward-only (corrects parsing for
all future mark-to-market runs); any already-persisted `quote_last_close`/audit-log rows from
before this fix are untouched.

**Recommended next step for Elva/Bruce** (who have prod DB access): query `s1_audit_log` /
`quote_last_close` for any date since 2026-06-30 where a held S1 position's persisted close is
implausibly small relative to its `avg_cost` (e.g. `close < avg_cost * 0.15`) for a symbol known
to trade ≥1,000 TWD — that is the exact signature this bug would have left if it fired.

## Files changed (cumulative, both rounds)

- `apps/api/src/kgi-heatmap-enricher.ts`
- `apps/api/src/data-sources/twse-openapi-client.ts` (export + harden `parseTwseNumber`)
- `apps/api/src/server.ts` (`/api/v1/realtime/snapshot` eodMap builder)
- `apps/api/src/s1-sim-runner.ts` (S1 mark-to-market `closeBySymbol`)
- `apps/api/src/theme-refresh.ts` (theme member mark-to-market)
- `apps/api/src/__tests__/heatmap-consistency.test.ts` (+4 tests total)
- `tests/ci.test.ts` (`HEATMAP-GARBAGE-2` corrected; `STOCKDAYALL-SELFHEAL-6` import string updated)

## Verification (Round 2, after all fixes)

- `pnpm typecheck` — 15/15 green
- `pnpm --filter api build` — green
- `pnpm test` — 1867 tests, 1857 pass, 2 fail (both pre-existing `finmind-client.test.ts` T3/T11,
  unrelated — confirmed via `git stash` A/B against clean `origin/main`)
- `python scripts/audit/w6_no_real_order_audit.py` — 6/6 PASS
- `python scripts/audit/secret_regression_check.py` — 0 findings
