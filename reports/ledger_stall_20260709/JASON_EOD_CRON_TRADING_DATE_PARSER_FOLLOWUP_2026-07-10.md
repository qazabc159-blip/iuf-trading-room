# EOD cron's third inline ROC date parser — dead-code gate fix — 2026-07-10

**Branch**: `fix/eod-cron-trading-date-parser-jason-20260710`
**Follow-up to**: #1199 review (Pete) — a THIRD duplicate parser found after
the first two were collapsed into `lib/roc-date.ts`.

## Root cause (confirmed by code inspection)

`server.ts`'s `_runTwseEodCron` (the general, non-strategy TWSE EOD cron)
derived its own `tradingDateIso` with an inline parser at ~line 18477-18485:

```ts
let tradingDateIso = "";
if (stockRows[0]?.Date) {
  const parts = stockRows[0].Date.trim().split("/");
  if (parts.length === 3) { ... }
}
```

This only handles the legacy slash-separated ROC format (`"115/07/09"`). The
live TWSE STOCK_DAY_ALL wire format is compact 7-digit (`"1150709"`, no
separator — verified 2026-07-09, see #1192). Against that format,
`split("/")` returns a 1-element array, `parts.length === 3` is false, and
`tradingDateIso` stays `""` — silently, no error, no log line.

**Consequence — two gates downstream became unreachable dead code:**
1. TWSE persist gate (~line 18521 pre-fix): `if (db3 && tradingDateIso)` —
   false whenever `tradingDateIso === ""`, so the TWSE quote_last_close
   persist block (added #1159, 2026-07-03) never runs.
2. My own #1199 `_isTpexEodCloseDateValid` guard: fed by `tpexTradeDate =
   tradingDateIso ? tradingDateIso.slice(0, 10) : ""`. When `tradingDateIso`
   is `""`, `tpexTradeDate` is also `""`, which fails the date-shape regex
   check (`/^\d{4}-\d{2}-\d{2}$/.test(tpexTradeDate)`) one line before the
   guard would even be called — so the guard I added in #1199 has never
   actually executed once merged.

This is exactly the same failure pattern Pete flagged in #1192/#1199: a ROC
date parser drifting out of sync with the live wire format silently no-ops a
downstream guard instead of erroring. This makes three independent copies of
the same bug found in three different call sites across three review rounds.

## Fix

Replaced the inline parser with a call to the shared `lib/roc-date.ts`
parser (already imported top-level in server.ts since #1199), wrapped in a
new small, directly-testable, exported helper:

```ts
export function _computeTwseEodCronTradingDateIso(stockDateRaw: string | undefined): string {
  const stockDateIso = parseRocEodDateIso(stockDateRaw);
  return stockDateIso ? `${stockDateIso}T13:30:00+08:00` : "";
}
```

`_runTwseEodCron` now does `const tradingDateIso = _computeTwseEodCronTradingDateIso(stockRows[0]?.Date);`
— same output shape (`"YYYY-MM-DDT13:30:00+08:00"`) as before, so no other
call site (`ts`, `eodTradeDate`, `tpexTradeDate` slicing) needed to change.
No new parsing logic was introduced — per Pete's explicit warning, this
reuses the same shared lib the other two call sites already use.

## Tests (tests/ci.test.ts, all new)

- `EOD-CRON-DATE-1`: `_computeTwseEodCronTradingDateIso` — compact format now produces a non-empty ISO timestamp (previously silently `""`); slash format still works; garbage/missing → `""`.
- `EOD-CRON-DATE-2`: chains the fix through to both previously-unreachable gates — compact-format input produces a truthy `tradingDateIso` (TWSE persist gate reachable), a valid `YYYY-MM-DD` slice (date-shape gate passes), and `_isTpexEodCloseDateValid` now actually gets called and correctly accepts a same-day TPEX close / rejects a stale one.
- `EOD-CRON-DATE-3`: source-check — `_runTwseEodCron` calls the shared helper; regression guard that the old inline `split("/")` parser is gone.

## Answering the coordinator's question: 7/3 `quote_last_close` `source='tpex_eod'` verification

That 7/3 verification did **not** go through `_runTwseEodCron`'s TPEX persist
block (the one #1159 added and I patched in #1199). It went through a
**separate write path**: `s1-sim-runner.ts`'s `buildS1PositionsSnapshot()`,
"1b-persist" block (~line 1311-1330 in the pre-this-fix file):

```ts
tradeDate:  todayTst,
source:     (twseSymbolSet.has(p.symbol) ? "twse_eod" : "tpex_eod") as LastCloseEntry["source"],
```

This path is triggered by the S1 daily EOD report tick (`runS1EodReportTick`)
and the trading-room portfolio endpoint (per that function's own docstring:
"Shared by the daily EOD report and the trading-room portfolio endpoint").
It tags rows with `todayTst` (today's Taipei date, computed independently via
`taipeiDateStr()`) rather than a date parsed from the TWSE/TPEX response —
and it's only reached after that same function's own tier-1b freshness guard
(`stockDateIso !== todayTst` skip) has already passed, so by the time this
write executes, freshness is independently established a different way.

**No contradiction, once the two paths are told apart**: the general
`_runTwseEodCron` TPEX block has plausibly been dead code since #1159
(2026-07-03) itself — I cannot prove from source alone whether TWSE's wire
format was already compact back on 7/3 or changed since, but the `if (db3 &&
tradingDateIso)` / `tpexTradeDate` gates were written to only work with a
slash-separated `Date` field, which is not what the endpoint serves today.
The 7/3 "PASS" was real and is unaffected by this bug — it was s1-sim-runner's
independent write, not this cron's.

**Open item for prod verification (today's EOD, per coordinator)**: after
this fix deploys, the general cron's TWSE persist block (line ~18521) and
TPEX persist block should start actually writing rows for the first time in
this cron's history outside trading hours — worth confirming `quote_last_close`
gets a fresh batch tagged with today's date from this cron specifically
(distinguishable if needed by checking whether the full ~1400-symbol TWSE
universe shows up, vs. s1-sim-runner's write which is limited to the 8
F-AUTO position symbols).

## Validation

- `pnpm typecheck` — green (15/15 packages)
- `pnpm run build:packages` — green
- `pnpm test` — 1601 tests (3 new), 1591 pass, 2 fail (pre-existing `finmind-client.test.ts` T3/T11 `FINMIND_TOKEN` env leak, unrelated — see #1199 report for reproduction on clean origin/main), 8 skipped
- `pnpm --filter @iuf-trading-room/api run build` — green
- `pnpm smoke` — 1/1 PASS

## Lane note

Same file (`server.ts`, general TWSE EOD cron block) as #1199 — outside this
role's default file scope but explicitly named by this round's dispatch as a
direct continuation/urgent correction of that PR. No risk/broker/real-money
paths touched, no migration.
