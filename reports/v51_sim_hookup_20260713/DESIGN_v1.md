# V5-1 SIM Basket → KGI SIM Hookup — Design v1

- Author: Jason (backend-strategy, 2nd instance)
- Date: 2026-07-13
- Contract: `IUF_SHARED_CONTRACTS/lab_to_tr_v51_sim_basket_contract_2026_07_12_v1.md` (Elva signed 2026-07-13)
- Branch: `feat/v51-sim-basket-hookup-jason-20260713` (isolated worktree, origin/main base)

## 1. Current S1/F-AUTO chain (as-built, traced from code — not memory)

Trigger: **in-process Node scheduler**, not GHA/OS cron. `server.ts` wires three
`ui()` (15-min poll wrapper) blocks inside `startSchedulers()`:

```
Tuesday 08:30-08:55 TST → isS1SignalWindow() + runS1SignalTick()
Tuesday 09:00-09:20 TST → isS1OrderSubmitWindow() + runS1OrderSubmitTick()
Daily   14:45-15:30 TST → isS1EodWindow() + runS1EodReportTick()
```

1. `runS1SignalTick()` (s1-sim-runner.ts) computes cont_liq score **entirely
   from live DB market data** (companies table + FinMind client) — there is
   **no external Lab file involved** in S1's own basket generation. It writes
   the resulting `S1Basket` JSON to the Railway persistent volume
   (`reportsBase()/s1_sim_basket/<date>.json`, `reportsBase()` =
   `$RAILWAY_VOLUME_MOUNT_PATH/trading_room` or `runtime-data/trading_room`
   locally) plus an `audit_logs` row.
2. `runS1OrderSubmitTick()` reads that day's basket JSON, opens a
   `KgiGatewayClient` (HTTP to the Windows/EC2 gateway process), logs in
   with `KGI_PERSON_ID`/`KGI_PERSON_PWD` (simulation:true), `setAccount()`,
   then per basket entry: `client.createOrder({action:"Buy", price:undefined
   (=MARKET), timeInForce:"ROD", orderCond:"Cash", oddLot:false})` with a
   3x exponential-backoff retry on gateway-unreachable errors (no retry on
   broker rejection, per Athena spec). Fills are reconciled via
   `reconcileKgiOrder()` (broker/kgi-order-reconciliation.ts) polling
   order-events/trades/deals. Result written to
   `reportsBase()/s1_order_submit/` + audit log.
3. **Important: this is the execution mechanism, not the transmission
   mechanism** — S1 never receives a Lab-produced basket file, so it is not
   a precedent for "how does a local-disk Lab file reach prod".

## 2. Existing "local file → prod" bridge (the actual precedent for this task)

Found in three sibling modules, all pre-existing and out of scope to modify:

- `lab-strategy-consumer.ts` — reads a Lab JSON via `readFileSync`, trying
  (a) a sibling `../IUF_QUANT_LAB/...` path (dev), then (b) an **embedded
  copy checked into this repo** at `data/lab/sanctioned/<file>.json` (prod —
  the sibling Lab repo does not exist inside the Railway container).
- `lab-three-strategy-consumer.ts` — same pattern, embedded copy at
  `data/lab/three-strategy/<file>.json`, no live fetch at all.
- `lab-strategy-snapshot-fetcher.ts` — tries a GitHub raw-content fetch
  first (`https://raw.githubusercontent.com/qazabc159/IUF_QUANT_LAB/main/...`),
  falling back to the same embedded-copy pattern on fetch failure.

**Verified this session**: `IUF_QUANT_LAB` (local path
`C:\Users\User\Desktop\小楊機密\交易\IUF_QUANT_LAB`) is a git repo
(`git rev-parse --is-inside-work-tree` → true, has commit history including
`b2296d7 forward: FT_V51 first formation 2026-07-13`) **but `git remote -v`
returns empty — no GitHub remote configured.** The raw-fetch path in
`lab-strategy-snapshot-fetcher.ts` is therefore not usable for V5-1 data;
only the **embedded-copy-in-TR-repo** pattern is a live option.

**Conclusion: an existing rail was found.** Per task instruction, this means
Phase 2 implementation proceeds (not a stop-and-report-only case).

## 3. V5-1 design: reuse both existing rails, don't invent a third

- **Transmission** (Lab local disk → TR prod): reuse the
  embed-into-repo pattern (§2). The V5-1 basket CSV
  (`v51_sim_basket_2026-07-13.csv`, verified against contract schema — see
  §4) is copied verbatim into this repo at
  `data/lab/sim_baskets/v51_sim_basket_2026-07-13.csv`, committed as part of
  this PR, and reaches prod via the normal deploy pipeline. This is a
  **manual step each month** until/unless the Lab repo gets a pushed remote —
  documented here as an operational gap, not a code TODO (see §6).
- **Execution** (basket → KGI SIM orders): reuse S1's KGI gateway mechanics
  (§1.2) — same `KgiGatewayClient`, same login/setAccount/createOrder/retry/
  reconcile shape, same in-process 15-min-poll scheduler style. Implemented
  as an independent module (`v51-sim-basket-runner.ts`) rather than adding
  branches inside `s1-sim-runner.ts`, because the two tracks differ
  structurally (S1: weekly, self-computed signal, 8 names, no fixed hold
  period vs V5-1: monthly, Lab-CSV-sourced, 30 names equal-weight, 20-day
  hold) — this is isolating a genuinely distinct data track, not duplicating
  the same one.

New scheduler block in `server.ts` (`V51-SIM-BASKET-PIPELINE`), same file/
style location as `S1-SIM-PIPELINE`: weekday 08:20-08:40 TST poll →
`runV51OrderSubmitTick()` scans embedded `data/lab/sim_baskets/*.csv`,
computes each basket's entry date as `nextWeekdayIso(signal_date)`, and
submits any basket whose entry date is today and hasn't already been
submitted (idempotency guard: query `audit_logs` for an existing
`v51_sim.order_submit` row keyed by the basket's signal date before
submitting — this matters more here than for S1 because a single basket is
10M notional across 30 names, not 8 names re-submitted weekly).

## 4. Ingestion / fail-closed gates (implemented)

1. **Schema v1 strict match**: exact 6 headers in exact order
   (`stock_id,weight,signal,signal_date,entry_rule,label`). Any deviation
   (missing/extra column, wrong order, wrong column count on any row) →
   `parseV51BasketCsv()` returns `{ok:false, error}` — never partially
   accepted.
2. **Label passthrough gate**: every row's `label` must equal
   `SIM_EXECUTION_SAMPLE_NOT_VALIDATED` verbatim, else fail-closed. This is
   the same string carried into the order-submit report and audit log —
   never softened or dropped.
3. **entry_rule gate**: must equal `next_trading_day_open` verbatim.
4. **Basket-file-absent gate**: `readV51BasketForDate()` tries the embedded
   path then the dev-sibling path; if neither exists, returns
   `basket_file_not_found` — the submit function aborts with zero orders,
   no substitute data (contract §3: "TR 側 fail-closed 不進場並回報，不用替代
   資料湊單").
5. **Real embedded file caveat found + fixed**: the actual Lab-produced CSV
   is UTF-8 **with a BOM** (`b'\xef\xbb\xbf...'`, Python `utf-8-sig` writer
   convention). Without stripping it, the first header token parses as
   `"﻿stock_id"` and schema match fails on the real file even though it
   is otherwise valid. `parseV51BasketCsv()` strips a leading BOM before
   splitting. Covered by a dedicated test using the real byte sequence.

## 5. KGI subscription cap check

`checkKgiSubscriptionCap()` counts unique symbols across the basket +
`V51_BENCHMARK_RESERVED_SYMBOLS = ["0050"]` (matches Elva sign-off §2: 籃30
＋0050=31). Fail-closed (no orders submitted at all) if count > 40.

**Known gap, not resolved in this round**: this checks the V5-1 track in
isolation. It does not query the live gateway for S1's concurrently-held
subscriptions (currently 8 names) before submitting, so the true combined
account-wide subscription count (up to 8 + 31 = 39 in the worst case) is not
verified at runtime — only asserted safe by size (39 < 40). If S1's universe
ever grows, or V5-1's basket size changes, this static assumption needs
re-verification. Flagging for Elva/Athena rather than building a live
cross-track gateway query in this round (would require adding a
"list current subscriptions" capability to `KgiGatewayClient`, which does
not currently exist — out of scope for the deadline).

## 6. Order sizing

Equal weight: `V51_CAPITAL_TWD (10,000,000) / basket.rows.length` per name.
Shares = board-lot-rounded (`floor(notional / lastClose / 1000) * 1000`),
mirroring `s1-sim-runner.ts`'s `roundDownBoardLot()` convention. Missing
last-close price for a symbol → that symbol is skipped (0 shares,
`sizingNote:"skipped_missing_last_close"`), not silently treated as a valid
zero-cost fill — the rest of the basket still submits. This is a per-symbol
skip, not a whole-basket fail-closed, consistent with S1's precedent of
truncating on missing data for individual names.

Order type: MARKET (`price: undefined`, `timeInForce:"ROD"`,
`orderCond:"Cash"`) submitted within the 08:20-08:40 TST window right after
gateway open — this is the same approximation S1 uses for its target price;
the gateway client has no distinct "opening-auction" order type.

## 7. Explicitly deferred to Phase 2 (not implemented this round)

- **20-trading-day auto SIM close-out.** The contract specifies Lab's ledger
  auto-settles at day 20 and "SIM 平倉由 TR 側依同規則執行" — this requires a
  scheduled close-out tick that reads back the original basket + entry date,
  computes day-20 (calendar trading-day count from `entryDateTst`), and
  submits offsetting SELL market orders. Not built this round (task
  explicitly scoped entry as priority, exit as Phase 2). The order-submit
  report (`V51OrderSubmitReport`) already carries `entryDateTst` so the
  close-out tick has what it needs to compute the day-20 target date when
  built.
- **Ledger/positions UI surfacing.** The passed-through label lives in the
  audit log (`v51_sim.order_submit` action) and the JSON result file
  (`reportsBase()/v51_sim_order_submit/<date>.json`) but is not yet wired
  into `sim_ledger_weeks`/NAV/positions display (that is a separate,
  larger continuous-ledger system built for S1 — reusing it for V5-1 is a
  follow-up task, not attempted here to avoid scope creep into ledger
  schema changes under this deadline).
- **SIM fill callback into Lab's forward evidence chain** — contract §TR
  accepts this as a v1-not-blocking follow-up (schema TBD); not built.

## 8. Files changed this round

- NEW `apps/api/src/v51-sim-basket-runner.ts` — CSV parse/validate, cap
  check, order sizing, KGI SIM submit loop, scheduler entry point.
- NEW `apps/api/src/v51-sim-basket-runner.test.ts` — pure-function unit
  tests (schema fail-closed cases, sizing, cap check, entry-date calc).
- NEW `data/lab/sim_baskets/v51_sim_basket_2026-07-13.csv` — embedded copy
  of the first Lab-produced basket (verified byte-identical to
  `IUF_QUANT_LAB/research/forward_track/sim_baskets/v51_sim_basket_2026-07-13.csv`).
- EDIT `apps/api/src/server.ts` — new `V51-SIM-BASKET-PIPELINE` scheduler
  block (same style/location as `S1-SIM-PIPELINE`).
- EDIT `package.json` (root) — registered the new test file in the `test`
  script's explicit file list (this repo's `pnpm test` uses an explicit
  file list, not a glob — a new test file is invisible to CI otherwise).

## 9. What was NOT touched (lane boundaries held)

- `trading-service.ts`, `kgi-sim-env.ts`, `execution-mode.ts`,
  `services/kgi-gateway/app.py`, `risk-engine.ts` — not opened.
- `market-data.ts` — not opened (another instance's active lane).
- `s1-sim-runner.ts` — not opened. V5-1 is a fully independent module;
  its own KGI-gateway-client usage pattern was read (not edited) for
  precedent.
- Basket generation logic — not touched; CSV consumed as-is per contract
  §邊界 ("TR 不改籃檔生成邏輯").
