# F-AUTO SIM Ledger — Single-Date Live Catch-up (2026-07-07 gap) — 2026-07-10

**Branch**: `feat/ledger-single-date-catchup-jason-20260710`
**楊董 ACK**: 2026-07-07 帳本缺口回補（照 `reports/ledger_stall_20260709/JASON_LEDGER_STALL_ROOTCAUSE_2026-07-09.md` §5 方案實作）

## What this is

An admin-only, Owner-gated endpoint that patches the single missing 2026-07-07
week 6 + NAV row in `sim_ledger_weeks`/`sim_ledger_holdings`/`sim_ledger_nav`.
2026-07-07 was a Tuesday rebalance day where the live EOD cron's date guard
never saw a fresh TWSE/TPEX close inside its 14:45-15:30 window, so
`writeLiveLedgerAfterEod()` was never called that day — the EOD window cannot
reopen, so the code fix (#1192/#1199/#1202) prevents this from recurring but
cannot retroactively fill the gap. This is that fill.

## Design (implements §5 of the root-cause report)

- **New function**: `writeSingleDateLedgerCatchup()` in `sim-ledger-backfill.ts`.
- **New endpoint**: `POST /api/v1/admin/fauto-ledger/single-date-catchup`
  (Owner-only). Body: `{ date: "YYYY-MM-DD", apply?: boolean }`, dry-run
  default (`apply=false`).
- **Price source**: FinMind `TaiwanStockPrice` PIT close (`fetchFinMindPrices`,
  the same engine `runBackfill()` already uses) — **not** live TWSE/TPEX/MIS,
  which cannot answer for a past date. 10-calendar-day look-back window feeds
  `getPitClose()`'s walk-back so a trading-halt symbol on the exact catch-up
  date still resolves (same convention `runBackfill()` uses).
- **Not a `runBackfill()` re-run**: `runBackfill()` recomputes the *whole*
  ledger from `initialEquity` on a fixed `rebalanceDates[]` list and would
  produce a `source='backfill_dry_run'` row that visually collides with the
  existing `source='live'`/`'live_eod'` data — exactly the "混亂" the
  root-cause report's §5 warned against. This tool instead reads the current
  ledger tip (week 5, 2026-06-30) and writes exactly one week + one NAV row,
  tagged `source='live'`/`'live_eod'` (so it displays identically to a
  live-written row) with a `pricing_quality: finmind_catchup_backfill` marker
  in `notes` for traceability — no new `source`/CHECK-constraint value, no
  migration.
- **Provenance on holdings rows**: `entry_source`/`exit_source` use the
  already-CHECK-allowed `'finmind_close'` value (migration 0049) — the
  catch-up-specific marker lives in `sim_ledger_weeks.notes`/
  `sim_ledger_nav.notes` (JSONB/text, unconstrained), not a new enum value.

## Idempotency

Before any computation, the endpoint checks for an existing
`sim_ledger_weeks` row (`basket_date=date, source='live'`) or
`sim_ledger_nav` row (`nav_date=date, source='live_eod'`). If either exists,
it returns `alreadyWritten: true` and performs **no write**, whether called
in dry-run or apply mode, and regardless of how many times it's re-run.

## FinMind failure — explicit, not silent (per coordinator's explicit ask)

Two related fixes were needed in `fetchFinMindPrices()` (shared by
`runBackfill()` too):
1. It computed a `warnings` array on per-symbol fetch failure but never
   returned it to any caller — a FinMind token issue (e.g. the 2026-07-04
   Sponsor-tier expiry) would silently produce an empty price map with zero
   visible trace. Now returns `{ prices, warnings }`; `runBackfill()` forwards
   `.warnings` into its own `priceDataWarnings` (bonus fix, same root cause).
2. Added an explicit upfront check: if `FINMIND_API_TOKEN` is unset, it never
   even attempts the network calls and pushes one clear warning instead of N
   per-symbol HTTP-failure warnings.

The catch-up endpoint surfaces these as `finMindWarnings` in its response, and
separately tracks `missingPriceSymbols` (any old/new-basket symbol with no
usable PIT close after the fetch+walk-back). **`apply=true` is refused
(`ok: false`) while `missingPriceSymbols` is non-empty** — it will never
silently persist a ledger row derived from an incomplete price fetch.

## The 7/8 / 7/9 "which basket were they computed against" question (查清楚 as requested)

**Finding, from code reading (I did not query prod — this endpoint reads
prod as part of its own dry-run, see the curl plan below for the
coordinator's own verification)**:

`writeDailyNavRow()` (used for every non-Tuesday day, including 7/8 and 7/9)
takes `cashResidualTwd`/`totalMarketValueTwd` as inputs computed by
`buildS1PositionsSnapshot()` in `s1-sim-runner.ts` — and that function
rebuilds **positions** from `s1_sim.orders_submitted` audit log via
`readLatestS1ObservationAuditInWindow()`, which finds the **most recent**
Tuesday's orders within a 7-day look-back window. Since 2026-07-07 DID have
`orders_submitted` with 8/8 accepted (confirmed live in the root-cause
report), `buildS1PositionsSnapshot()` on 7/8 and 7/9 would correctly find
7/7's basket (not 6/30's) — **the position rebuild logic is audit-log
driven and is completely independent of `sim_ledger_weeks`**, which is a
separate table that simply never got a week-6 row written.

This means: **the dollar equity values on the existing 7/8/7/9
`sim_ledger_nav` rows are very likely already correct** (mark-to-market
against the new 7/7 basket) — but their `week_num` **column** is stale
(`writeDailyNavRow()` reads `week_num` from `getLatestLedgerState()`, i.e.
from `sim_ledger_weeks`, which was stuck at 5). So there is a plausible
**label-only** mismatch (`week_num` says 5, should say 6), not a
value-correctness problem.

**I did not touch the 7/8/7/9 rows** — per the coordinator's instruction
("若既有點已正確反映新籃子就不動、只補 7/7"), and because this is a code-reading
inference, not a verified fact (I do not query prod). Instead:
- `writeSingleDateLedgerCatchup()`'s dry-run response includes
  `subsequentNavRows`: a read-only list of every `sim_ledger_nav` row after
  the catch-up date (up to 14), each showing `navDate`, `weekNumRecorded`,
  `equityTwd`, `source`, `notes` — so the coordinator can visually confirm on
  the real dry-run output whether 7/8/7/9's `weekNumRecorded` is `5` (stale
  label, as predicted) and whether the `equityTwd` trend looks continuous
  with the newly-computed week-6 entry point (i.e. not a step-discontinuity
  that would indicate the values themselves are wrong).
- If the coordinator's dry-run confirms values are correct and only
  `week_num` is stale, that is a **separate, lower-stakes cosmetic follow-up**
  (a label backfill on already-existing rows) — not bundled into this PR,
  since it wasn't asked for and touches already-written live data outside
  this endpoint's stated scope.

## Tests (`tests/ci.test.ts`, all new)

- `SIM-LEDGER-CATCHUP-1/2/3`: real behavior tests against a new pure,
  DB-free computation core `_computeSingleDateCatchupFinancials()` (extracted
  from the endpoint, mirrors the pattern of `_computeHoldingsRowsForTest`
  already in this file) — hand-calculated exit/entry PnL + transaction costs
  + NAV against `STANDARD_COST_RATES`/`ZERO_COST_RATES`, the
  basket-file-vs-fallback `cashResidualTwd` branch, and the
  missing-price-falls-back-to-entry-price (0 PnL, never a phantom gain/loss)
  behavior.
- `SIM-LEDGER-CATCHUP-4/5/6`: source-order assertions — idempotency check
  runs before basket/price fetch; the dry-run gate returns before any INSERT;
  the missing-price refusal returns before any INSERT.
- `SIM-LEDGER-CATCHUP-7`: `fetchFinMindPrices` returns `{ prices, warnings }`
  and an unset token produces an explicit warning (not silence); the
  catch-up function forwards those warnings.
- `SIM-LEDGER-CATCHUP-8`: holdings rows use the CHECK-allowed `'finmind_close'`
  value (regression guard against ever needing a migration for this).
- `SIM-LEDGER-CATCHUP-9`: endpoint wiring — route exists, Owner-only,
  dry-run default, calls `writeSingleDateLedgerCatchup`, validates
  `body.date` shape.

Why not real-DB tests: `writeSingleDateLedgerCatchup()`'s outer shell
(idempotency read, basket/holdings reads, INSERT writes) needs a real
Postgres connection — this repo's `pnpm test` runs in memory mode; the
real-Postgres `test:db` job is a separate CI gate. This matches the existing
convention throughout `sim-ledger-backfill.ts`'s test coverage
(`SIM-LEDGER-15/17/18` etc. are all source-order/structural assertions for
the same reason) — the pure arithmetic core is where real behavioral
coverage lives.

## Validation

- `pnpm typecheck` — green (15/15 packages)
- `pnpm run build:packages` — green
- `pnpm test` — 1628 tests (18 new — 9 `SIM-LEDGER-CATCHUP-*` from this PR + 9 already-merged from earlier today), 1618 pass, 2 fail (pre-existing `finmind-client.test.ts` T3/T11 `FINMIND_TOKEN` env leak, unrelated — reproduces identically on clean origin/main), 8 skipped
- `pnpm --filter @iuf-trading-room/api run build` — green
- `pnpm smoke` — 1/1 PASS

## Prod dry-run → apply plan (for the coordinator — Jason does not touch prod)

**1. Get an Owner session cookie** (established pattern, per team memory):

```bash
railway variables --service api --kv | grep SEED_OWNER
# -> SEED_OWNER_EMAIL=..., SEED_OWNER_PASSWORD=...

curl -s -c cookies.txt -X POST https://api.eycvector.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<SEED_OWNER_EMAIL>","password":"<SEED_OWNER_PASSWORD>"}'
```

**2. Dry-run (default — writes nothing):**

```bash
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-catchup \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-07-07"}' | python3 -m json.tool
```

**Expected dry-run response shape** (all fields always present; values below
are illustrative, not the real prod numbers):

```json
{
  "ok": true,
  "applied": false,
  "alreadyWritten": false,
  "date": "2026-07-07",
  "weekNum": 6,
  "prevBasketDate": "2026-06-30",
  "realizedPnlTwd": <number>,
  "equityAfterTwd": <number>,
  "cashResidualTwd": <number>,
  "navEquityTwd": <number>,
  "transactionCostsTwd": <number>,
  "finMindWarnings": [],
  "missingPriceSymbols": [],
  "subsequentNavRows": [
    { "navDate": "2026-07-08", "weekNumRecorded": 5, "equityTwd": 9790150, "source": "live_eod", "notes": "daily_mark_to_market" },
    { "navDate": "2026-07-09", "weekNumRecorded": 5, "equityTwd": <number>, "source": "live_eod", "notes": "daily_mark_to_market" }
  ],
  "notes": [
    "pricing_quality: finmind_catchup_backfill",
    "catchup_computed: weekNum=6 prevBasketDate=2026-06-30 realizedPnl=... equityAfter=... navEquity=... costs=..."
  ],
  "generatedAt": "..."
}
```

**What to check before applying:**
- `alreadyWritten` must be `false` (if `true`, someone already ran apply — stop, nothing to do).
- `missingPriceSymbols` must be `[]` (if non-empty, FinMind coverage is incomplete for one or more of the 16 symbols involved — do not apply; investigate the named symbols/`finMindWarnings` first, possibly a token issue).
- `finMindWarnings` should be `[]` or at least contain nothing alarming (a `walkback` note is fine — a `HTTP 402`/`token not set` warning is not).
- `subsequentNavRows[].weekNumRecorded` — expected to show `5` for 7/8/7/9 per the analysis above (stale label, not a value bug). Compare `equityTwd` trend against `navEquityTwd` in this response for continuity; if there's a visible discontinuity, stop and flag back to Jason/Elva rather than applying.

**3. Apply (only after the above checks pass):**

```bash
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-catchup \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-07-07","apply":true}' | python3 -m json.tool
```

Expect `"applied": true`. Re-running the SAME apply call afterward should
return `"alreadyWritten": true` (idempotency proof) — worth doing once as a
live confirmation.

**4. Post-apply verification** (read-only):

```bash
curl -s -b cookies.txt https://api.eycvector.com/api/v1/portfolio/f-auto/nav | python3 -m json.tool
```
Confirm `weeks` now has a `weekNum=6, basketDate=2026-07-07` entry and
`navCurve` has no gap at 2026-07-07 anymore.

## Lane note

Touches `sim-ledger-backfill.ts` (existing exception, see #1150/#1156/#1184/
#1188/#1192 precedent), `s1-sim-runner.ts` (one `export` keyword addition,
zero behavior change — exposes an existing pure read function for reuse),
and `server.ts` (new admin route, same pattern as the existing
`/admin/fauto-ledger/backfill`). No risk/broker/real-money paths touched, no
migration. No prod write performed by Jason — apply is explicitly reserved
for the coordinator per the dispatch.
