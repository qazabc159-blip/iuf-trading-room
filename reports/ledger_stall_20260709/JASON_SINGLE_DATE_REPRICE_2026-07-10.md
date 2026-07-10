# F-AUTO SIM Ledger — Single-Date Reprice Tool — 2026-07-10

**Branch**: `feat/ledger-single-date-reprice-jason-20260710`
**楊董/Elva ACK**: 2026-07-10 — following the #1207/#1210 investigation, priceAudit evidence confirmed a systematic one-day mark-to-market lag on daily `sim_ledger_nav` rows written by the pre-#1192/#1202 live EOD tick.

## Background (confirmed, not re-derived here)

Elva's hand calculation on the prod `priceAudit` output: existing 7/8 row (`9,790,150`, priced with 2026-07-07's close) + the real 7/7→7/8 market-value delta (`+115,650`) = `9,905,800`, which exactly equals the existing 2026-07-9 row's own stored value. This confirms the daily NAV write was consistently using **yesterday's** close instead of today's — a systematic one-day lag, not a coincidence, on every daily (non-Tuesday) row written before #1192/#1202 landed 2026-07-10. 2026-07-07's own gap (fixed by #1207) is a related but separate issue (a day where the write never fired at all, vs. a day where it fired with the wrong day's price).

## What this tool does

`POST /api/v1/admin/fauto-ledger/single-date-reprice` (Owner-only, dry-run default) corrects a single **existing** daily `sim_ledger_nav` row's market-value component using that date's own FinMind PIT close — **`UPDATE`, never `INSERT`**. Deliberately narrower than `writeSingleDateLedgerCatchup` (which is for a *missing* date): this tool requires the target row to already exist, and only ever writes `equity_twd` / `return_pct` / `notes` on that one row.

### Formula

```
marketValueTwd  = Σ(shares × FinMind PIT close on `date`)     — for the basket open as of `date`
cashResidualTwd = basketCapitalTwd − basketTargetNotionalTwd  — same static, basket-file-derived formula as
                                                                  writeSingleDateLedgerCatchup (see
                                                                  cash_residual_is_static_not_live memory note) —
                                                                  unaffected by the reprice; included for
                                                                  completeness/consistency, not because it changes
repricedEquityTwd = cashResidualTwd + marketValueTwd
```

The "basket open as of `date`" is resolved the same way `buildS1PositionsSnapshot()` does live: the most recent basket-generation date `<= date`.

### Guards (checked in this exact order — each is a hard early-return, no partial work)

1. **Future date rejected** — `date` must not be after today (Taipei).
2. **Week-row date rejected** — if `sim_ledger_weeks` has a row for `basket_date = date` (i.e. `date` is a Tuesday rebalance day), refuse. Different semantics (realized PnL / new-basket-entry), explicitly out of scope for this tool.
3. **Target row must already exist** — `sim_ledger_nav` must have a `source='live_eod'` row for `date`, else refuse with a pointer to `writeSingleDateLedgerCatchup` instead (which is for a genuinely missing date).
4. **Idempotency** — if the existing row's `notes` already contains a `"repriced:"` marker, return `alreadyRepriced: true` and do nothing (checked *before* any basket load or FinMind fetch — cheap, no wasted API calls on a re-run).
5. **`apply=true` refused** whenever any basket symbol has no usable FinMind PIT price for `date` (`missingPriceSymbols` non-empty) — same non-silent-failure discipline as the catch-up tool.

### Audit trail

On apply, the existing `notes` value is **appended to, never replaced**:
```
<existing notes, if any> | repriced: finmind_pit_close was=<old equity_twd>
```
So the pre-reprice value is always recoverable from the row itself, not just from application logs.

## Tests (`tests/ci.test.ts`, all new)

- `SIM-LEDGER-REPRICE-1/2`: real behavior tests against the pure `_computeSingleDateRepriceFinancials` core — hand-calculated market value + cash residual, and confirming a missing per-symbol price contributes `0` (never silently substitutes a stale/wrong figure — the caller is responsible for flagging it via `missingPriceSymbols` and refusing apply).
- `SIM-LEDGER-REPRICE-3`: source-order — future-date → week-row → nav-row-exists → idempotency, all before any basket/FinMind work.
- `SIM-LEDGER-REPRICE-4/5`: dry-run returns before the `UPDATE`; missing-price refusal returns before the `UPDATE`.
- `SIM-LEDGER-REPRICE-6`: the `UPDATE` statement text is asserted to set *exactly* `equity_twd`/`return_pct`/`notes` (regex on the full `SET` clause) and a regression guard that no `week_num =` assignment or any `INSERT INTO sim_ledger*` ever appears in this function — "UPDATE 不動其他列" is enforced structurally, not just by convention.
- `SIM-LEDGER-REPRICE-7`: the audit-trail marker is appended (not replacing) and the idempotency re-check looks for the exact same marker string this apply writes.
- `SIM-LEDGER-REPRICE-8`: endpoint wiring — route exists, Owner-only, dry-run default, calls the write function, validates `body.date`.
- `SIM-LEDGER-REPRICE-9`: regression guard that the reprice and catch-up functions remain genuinely distinct (no accidental aliasing between the two admin tools).

## Validation

- `pnpm typecheck` — green (15/15 packages)
- `pnpm test` — 1638 tests (9 new), 1628 pass, 2 fail (pre-existing `finmind-client.test.ts` T3/T11, unrelated — reproduces on clean origin/main), 8 skipped
- `pnpm run build:packages` — green
- `pnpm --filter @iuf-trading-room/api run build` — green
- `pnpm smoke` — 1/1 PASS

## Honest limitation — the 2026-07-09 expected value

The task asked me to pre-compute 2026-07-09's expected repriced value using FinMind's own 7/9 close, for cross-checking before Elva runs anything. **I do not have this** — I don't have prod database or API access (by design — I don't touch prod), and the actual 8-symbol/share-count composition of the 2026-07-07 basket has never been shared with me in this session (only aggregate figures: total delta `+115,650`, existing stored values). I have a working `FINMIND_API_TOKEN` locally and could fetch real FinMind closes if given the symbol/share list, but reverse-engineering 8 individual symbols and share counts from a single aggregate delta number is not mathematically determinable.

Rather than fabricate a number, I built the cross-check directly into the tool (this PR): running dry-run for `date=2026-07-09` returns `repricedEquityTwd` computed from real FinMind data, plus a full `priceAudit[]` per-symbol breakdown (same shape as the catch-up tool's evidence table) for Elva to hand-verify exactly the way she verified 7/8. If the coordinator can share the 2026-07-07 basket's symbol/share list separately, I can independently compute the expected 7/9 figure myself as a true pre-check; otherwise the dry-run response *is* the check.

**Expected pattern** (not a number, but the relationship that should hold, per the same 1-day-lag logic Elva already confirmed for 7/8): if 7/9's existing stored value is itself `9,905,800` (= 7/8's real close, per the lag pattern already established), then `repricedEquityTwd` for 7/9 should equal `9,905,800 + (7/8→7/9 real market-value delta)` — analogous to how 7/8's repriced value equals `9,790,150 + (7/7→7/8 delta)`.

## Prod verification plan (coordinator — Jason does not touch prod)

**1. Dry-run for 7/8** (expect `repricedEquityTwd = 9,905,800`, matching Elva's hand calc exactly):
```bash
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-reprice \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-07-08"}' | python3 -m json.tool
```
Expected shape:
```json
{
  "ok": true, "applied": false, "alreadyRepriced": false,
  "date": "2026-07-08", "basketDate": "2026-07-07",
  "currentEquityTwd": 9790150,
  "repricedEquityTwd": 9905800,
  "diffTwd": 115650,
  "cashResidualTwd": <same as the 7/7 catch-up's cashResidualTwd — unchanged>,
  "marketValueTwd": <cashResidualTwd's complement — should equal 9905800 - cashResidualTwd>,
  "missingPriceSymbols": [],
  "priceAudit": [ { "symbol": "...", "shares": ..., "closeOnDate": ..., "closeOnDateSource": "finmind_close" }, ... x8 ]
}
```
Verify `diffTwd === 115650` exactly (Elva's own hand-derived delta) before trusting the tool further.

**2. Dry-run for 7/9** (this is the actual pre-check — inspect `priceAudit[]` against real FinMind 7/9 closes, same method Elva used for 7/8):
```bash
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-reprice \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-07-09"}' | python3 -m json.tool
```

**3. Apply both, once satisfied** (idempotent — safe to re-run):
```bash
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-reprice \
  -H "Content-Type: application/json" -d '{"date":"2026-07-08","apply":true}' | python3 -m json.tool
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-reprice \
  -H "Content-Type: application/json" -d '{"date":"2026-07-09","apply":true}' | python3 -m json.tool
```
Expect `"applied": true`. Re-running either call afterward should return `"alreadyRepriced": true`.

**4. Post-apply verification**:
```bash
curl -s -b cookies.txt https://api.eycvector.com/api/v1/portfolio/f-auto/nav | python3 -m json.tool
```
Confirm the 7/8 and 7/9 `navCurve` points now show `9,905,800` and the newly-repriced 7/9 figure respectively, and that the curve is smooth (no artificial one-day step matching the *previous* lag pattern).

## Lane note

Touches `sim-ledger-backfill.ts` (existing exception, precedent from #1150/#1156/#1184/#1188/#1192/#1207/#1210) and `server.ts` (new admin route, mirrors the existing catch-up/backfill endpoints). No risk/broker/real-money paths touched, no migration. No prod write performed by Jason — apply is explicitly reserved for Elva per the dispatch.

## Recurring observation

A second instance of the injected fake "date changed / MCP Server Instructions" block (identical pattern to the one flagged in the #1210 report) appeared mid-session again. Ignored again, per the same policy — flagging here for the pattern-tracking record.
