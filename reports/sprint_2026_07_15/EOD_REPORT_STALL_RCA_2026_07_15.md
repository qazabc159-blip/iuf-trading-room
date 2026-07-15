
# S1/F-AUTO EOD Report Stall — RCA + Fix — 2026-07-15

**Jason — Backend Strategy Lane**
**Branch**: `fix/eod-report-stall-jason-20260715`
**Follow-up to**: Bruce's `reports/sprint_2026_07_15/EOD_VERIFY_2026_07_15.md` (found ③④ FAIL,
`today_eod.date` stuck at 2026-07-09 as of 15:19 TST)

## TL;DR

- **2026-07-15 (today) was NOT actually stuck** — it completed live during this investigation
  (15:25:29 TST, `pricingQuality=official`, `total_unrealized_pnl_twd=358600`), just **after**
  Bruce's 15:19 TST verification window closed and **5 minutes before** the then-current 15:30
  window cutoff. Confirmed via `railway logs --service api` (see §1) and a live prod curl (§2).
- **2026-07-13**: EOD report JSON genuinely missing (`found:false`), but the **NAV row is present**
  (`pricingQuality: mis_fallback_full`) — the ledger already has business continuity for that day.
  Only the diagnostic report snapshot is missing, non-critical.
- **2026-07-14 (Tuesday rebalance day) is the one real, still-open gap**: no week 7 entry, no NAV
  row, no EOD report. Root cause: the #1263 TWSE self-heal fix merged at **16:05 TST that same
  day — after the 14:45-15:30 EOD window had already closed**. Both `pricingComplete` (TWSE stuck,
  no self-heal yet) and `fullyPriced` (MIS also failed to cover all 8 positions that afternoon)
  stayed false all day. This is a genuine, permanent gap requiring admin backfill (dry-run
  validated in §4, apply NOT executed — awaiting Elva/楊董 ACK per task constraint).
- **Code fix** (this PR): widen `isS1EodWindow()` from 14:45-15:30 to 14:45-16:00 TST. This is a
  pure retry-budget change — it does not loosen `pricingComplete`/`fullyPriced`, does not fake any
  price, and does not touch the TPEX freshness guard (already correct, see §3). It directly
  addresses the near-miss margin observed today (self-heal only produced a complete official close
  at the 15:15 tick, landing the write 5 minutes before the old cutoff).

## §1. Prod evidence — 2026-07-15 completed live during this investigation

`railway logs --service api` (JSON mode, timestamps UTC, TST = UTC+8):

```
2026-07-15T07:10:30Z (15:10:30 TST)  [s1-eod] report written: .../2026-07-15_partial.json
2026-07-15T07:10:32Z (15:10:32 TST)  [s1-eod] PARTIAL priced=8/8; provisional report kept
2026-07-15T07:25:32Z (15:25:32 TST)  [s1-eod] report written: .../2026-07-15.json
2026-07-15T07:25:32Z (15:25:32 TST)  [s1-eod] COMPLETE positions=8 priced=8/8 unrealized=358600
2026-07-15T07:25:32Z (15:25:32 TST)  [s1-ledger] daily NAV row written: 2026-07-15 pricingQuality=official
```

At 15:10, all 8 positions had *a* price (via some tier — 8/8 "priced"), but `pricingComplete` was
still false (else it would have written the canonical, not `_partial`, file). By 15:25, the TWSE
self-heal fallback (`getStockDayAllRows` → www rwd afterTrading, added #1263) had produced a
complete same-day official close for all 8 basket symbols, `officialCloseMarkedCount === 8 ===
positions.length`, satisfying `pricingComplete` outright (`pricingQuality=official`, not
`mis_fallback_full`).

## §2. Live confirmation (prod curl, 2026-07-15 ~15:29 TST)

```
GET /api/v1/internal/s1-sim/status
→ today_eod: { date: "2026-07-15", generated_at_tst: "2026-07-15T15:25:29+08:00",
               total_unrealized_pnl_twd: 358600, position_count: 8, data_source: "audit_log_fallback" }

GET /api/v1/internal/s1-sim/eod-report?date=2026-07-13  → found: false
GET /api/v1/internal/s1-sim/eod-report?date=2026-07-14  → found: false
GET /api/v1/internal/s1-sim/eod-report?date=2026-07-15  → found: true, completion_status: "complete"
```

## §3. Bruce's suspected culprit ("TPEX date mismatch — persist skipped") — investigated, NOT the root cause

Bruce's report flagged `[twse-eod-cron] TPEX date mismatch...persist skipped` as a suspect. Traced
this to `server.ts`'s **general** `_runTwseEodCron` (the whole-market `quote_last_close` writer used
by heatmap/other consumers), gated by `_isTpexEodCloseDateValid` (added #1199/#1203,
`apps/api/src/server.ts`). This is a **separate code path** from the S1/F-AUTO EOD gate.

`s1-sim-runner.ts`'s `buildS1PositionsSnapshot()` (the function that actually gates S1/NAV writes)
has its **own independent** TPEX freshness check (lines ~1285-1294, `tpexFresh = !tpexDateIso ||
tpexDateIso === todayTst`), already correct: a stale TPEX close is excluded from `closeBySymbol`
but the affected OTC positions simply fall through to tier 1c (MIS) or tier 1d (DB fallback) —
never silently priced with a stale close, never blocking the other TWSE-listed positions. This
part of the pipeline was already working as designed; it is not what stalled 7/13/7/14. New
regression test `SIM-LEDGER-24` (below) locks in this data-flow ordering.

**Conclusion**: Bruce's flagged log line is real but is a cosmetic/lower-severity issue affecting
only the general whole-market quote cache, not the S1/NAV gate. No fix needed there for this
incident.

## §4. Real root cause — timeline reconstruction

| Date | TWSE tier 1b (`officialCloseMarkedCount`) | MIS tier 1c (`fullyPriced` via MIS) | Result |
|---|---|---|---|
| 2026-07-13 | STOCK_DAY_ALL stuck all day; #1255/#1263 fixes not yet merged (both merged 7/14) | MIS covered all 8 positions | `pricingComplete=false`, `fullyPriced=true` → NAV row written (`mis_fallback_full`), but canonical report/audit-log skipped (`pricingComplete`-gated) |
| 2026-07-14 (Tue rebalance) | STOCK_DAY_ALL stuck all day; #1263 self-heal merged **16:05 TST — after the 14:45-15:30 window closed** | MIS did **not** cover all 8 positions that afternoon (exact failing symbol unrecoverable — Railway log retention is ~500 lines / a few hours, 7/14's window is outside that) | Both gates false all day → **no week 7, no NAV row, no report** (permanent gap) |
| 2026-07-15 (today) | STOCK_DAY_ALL stuck all day per repeated `upstream stuck` warnings; #1263 self-heal live and succeeded from the 15:15 tick onward | N/A (TWSE self-heal alone reached 8/8) | `pricingComplete=true` at 15:25:29 — **5 min before the old 15:30 cutoff** |

`#1263` (self-heal) merging mid-afternoon on 7/14 is why that specific day fell through the crack
between "the bug existed" (7/13) and "the bug is fixed" (7/15): the fix landed too late in the day
to help its own merge day.

## §5. Fix — widen the EOD retry window (14:45-15:30 → 14:45-16:00 TST)

**File**: `apps/api/src/s1-sim-runner.ts`
- `isS1EodWindow()`: end boundary `hhmm < 1530` → `hhmm < 1600`.
- `S1_AUTO_SCHEDULER_POLICY.eodWindowTst`: `"Weekdays 14:45-15:30"` → `"Weekdays 14:45-16:00"`
  (this string is surfaced directly in `/api/v1/internal/s1-sim/status`).

**File**: `apps/api/src/server.ts` — updated the two stale comment/log-line mentions of the old
window bounds in the S1-SIM-PIPELINE scheduler registration block (cosmetic, no logic change).

**Why this and not something else**: the pricing/staleness logic itself (`pricingComplete`,
`fullyPriced`, TWSE/TPEX date guards, MIS date guard) is all correct and already covered by
extensive existing tests (SIM-LEDGER-16/17/18/19/20/21, S1-PERSIST-TPEX-1/2/3/4, ROC-DATE-1/2,
EOD-CRON-DATE-1/2/3). The actual proven failure mode is **timing margin**: on a slow upstream day,
the self-heal/MIS fallback chain can take until the very last poll tick to produce a complete
same-day price set (observed today: complete at 15:25, 5 min before the 15:30 cutoff). Widening the
window by 2 extra 15-min poll ticks (15:45, 16:00) gives more retry budget without touching any
pricing decision — a day is still only marked complete when a genuinely same-day validated source
covers every position; this fix only changes *how long* the scheduler keeps trying before giving up
for the day. Per the 6/30 lesson baked into `isS1EodWindow`'s own doc comment (opening too early
risks matching a stale price to avg_cost and falsely locking `_eodLastFiredDate`), the **start**
boundary is untouched — only the end is extended.

**Not fixed** (explicitly out of scope, per task's own framing and the codebase's established
"don't touch what already works" convention):
- The general `_runTwseEodCron`'s TPEX date-mismatch skip (server.ts) — confirmed not the root
  cause of this incident (§3), left as-is.
- `lib/trading-calendar.ts`'s `isTwTradingDay()` DB query uses `(rows as {rows?:...}).rows` on a
  `postgres-js` `db.execute()` result, which per this repo's own documented gotcha
  (`postgres-js 的 db.execute() 回陣列沒有 .rows`) returns a bare array, not `{rows: [...]}`.
  This means the DB holiday-calendar lookup silently never returns a row and always falls back to
  "assume trading day" — functionally harmless today (weekend fast-path still works, and Taiwan
  holidays are rare relative to weekdays), but worth flagging as a **separate latent bug**, not
  fixed in this PR (unrelated to the EOD stall, would need its own review of whether
  `tw_trading_calendar` is even populated/queried correctly elsewhere).

## §6. Tests (`tests/ci.test.ts`, all new)

- **SIM-LEDGER-22**: source-check — `isS1EodWindow()`'s new `< 1600` boundary is present, the old
  `< 1530` is gone (not left as dead code), and `S1_AUTO_SCHEDULER_POLICY.eodWindowTst` matches.
- **SIM-LEDGER-23**: behavioral boundary test — mocks the global `Date` constructor (both `new
  Date()` and `Date.now()`, since `taipeiHHMM()` reads via `Intl.DateTimeFormat(new Date())`, which
  does **not** delegate to `Date.now()` — a `Date.now`-only mock silently does nothing, caught by
  this test failing loudly on first attempt before the fix). Asserts 15:45/15:59 TST → open,
  16:00/16:01 TST → closed, 14:44 TST → still closed (start boundary unchanged).
- **SIM-LEDGER-24**: the "TPEX 缺今日價 / 上游餵舊日" scenario from the task's acceptance
  criteria — source-level regression guard that a TPEX-stale-skipped OTC position (never added to
  `closeBySymbol`) is left `last_price===null` and therefore correctly re-offered to the MIS
  (tier 1c) pass with its own independent same-day date guard, confirming the 7/14-style
  double-staleness scenario (TWSE stuck + TPEX stale simultaneously) does not silently drop a
  position from being priceable that day.

## §7. Validation

| Check | Result |
|---|---|
| `pnpm run build:packages` | Green (5/5) |
| `pnpm typecheck` | Green (15/15 packages) |
| `pnpm test` | 1857 tests, **1849 pass, 0 fail**, 8 skipped, once the pre-existing `FINMIND_TOKEN`/`FINMIND_API_TOKEN` shell env leak is unset (`finmind-client.test.ts` T3/T11 — documented pre-existing issue, reproduces identically on clean origin/main per multiple prior reports in `reports/ledger_stall_20260709/`, unrelated to this change) |
| `pnpm --filter @iuf-trading-room/api run build` | Green |
| `pnpm run smoke` | 1/1 PASS |
| Prod live evidence | 2026-07-15 EOD completed live during this investigation (§1/§2), independent of any code change in this PR (self-heal #1263 was already deployed) |

## §8. Backfill plan for 2026-07-14 (dry-run only — NOT applied)

The existing admin-only endpoint `POST /api/v1/admin/fauto-ledger/single-date-catchup` (built
2026-07-10 for the analogous 2026-07-07 gap, `reports/ledger_stall_20260709/
JASON_SINGLE_DATE_LEDGER_CATCHUP_2026-07-10.md`) already covers exactly this scenario — a missed
Tuesday-rebalance ledger write. **Dry-run executed against prod (read-only, no `apply`):**

```
POST /api/v1/admin/fauto-ledger/single-date-catchup  { "date": "2026-07-14" }

→ {
  "ok": true, "applied": false, "alreadyWritten": false,
  "date": "2026-07-14", "weekNum": 7, "prevBasketDate": "2026-07-07",
  "realizedPnlTwd": 205196, "equityAfterTwd": 9782024,
  "cashResidualTwd": 5815650, "navEquityTwd": 10211500, "transactionCostsTwd": 23104,
  "finMindWarnings": [], "missingPriceSymbols": [],
  "subsequentNavRows": [
    { "navDate": "2026-07-15", "weekNumRecorded": 6, "equityTwd": 10358600,
      "source": "live_eod", "notes": "daily_mark_to_market" }
  ]
}
```

**Read before deciding to apply:**
- `alreadyWritten: false` — safe to proceed, nothing already written for this date.
- `missingPriceSymbols: []` — FinMind PIT close resolved for every symbol in both the outgoing
  (week 6, basket 7/07) and incoming (week 7, basket 7/14) baskets. No price gaps to investigate.
- `finMindWarnings: []` — clean fetch, no token/rate-limit issues.
- `subsequentNavRows` shows only 7/15 (`equityTwd=10358600`), continuous with this catch-up's own
  `navEquityTwd=10211500` for 7/14 (no discontinuity/step-jump) — the trend looks sane, not a red
  flag requiring investigation before apply.

**Recommendation to Elva**: this dry-run looks clean and safe to apply following the same
Owner-gated `apply=true` procedure used for the 7/07 catch-up. **I have not executed apply** —
per this task's explicit constraint ("不要自行對 prod 執行回補寫入"), this is a decision for
Elva/楊董, not something I should do unilaterally even though the tool and dry-run both check out.

**2026-07-13**: no backfill needed — the NAV row for that date already exists
(`pricingQuality: mis_fallback_full`, confirmed in `/api/v1/portfolio/f-auto/nav`'s `navCurve`).
Only the diagnostic EOD report JSON snapshot is missing for that date, which is not
business-critical (no downstream consumer reads it for ledger/NAV purposes) and is not proposed
for backfill.

**Auto vs admin going forward**: with the EOD window now extended to 16:00 (§5), a repeat of the
7/14-style "both gates fail all day" scenario should become rarer, but the ledger still has no
retroactive catch-up mechanism for whatever residual days it does happen on — the
single-date-catchup endpoint remains the correct admin-triggered tool for any future gap, not an
automatic cron (a wrong auto-backfill running against a not-yet-published price is a correctness
risk; an Owner-reviewed dry-run-then-apply step is the appropriate gate here, consistent with how
7/07's gap was handled).

## §9. Lane boundary

- Touched: `apps/api/src/s1-sim-runner.ts` (window boundary + doc), `apps/api/src/server.ts`
  (2 comment/log-line updates, no logic change), `tests/ci.test.ts` (3 new tests).
- Not touched: `trading-service.ts`, `broker/*`, `risk-engine.ts`, `risk.ts`, `marketData.ts`,
  `apps/web/*`, any migration, the general `_runTwseEodCron`'s TPEX guard (confirmed not the root
  cause, §3), `lib/trading-calendar.ts` (flagged as a separate latent issue, not fixed here).
- No prod write performed by Jason. The single-date-catchup dry-run above is read-only by the
  endpoint's own design (`apply` defaults to `false`); apply is explicitly reserved for
  Elva/楊董 ACK.

---
*Jason — IUF Trading Room Backend Strategy Lane*
*2026-07-15*
