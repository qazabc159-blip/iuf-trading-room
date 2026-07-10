# Why catch-up's 2026-07-07 navEquityTwd exactly matches the existing 2026-07-08 NAV row — 2026-07-10

**Branch**: `fix/ledger-catchup-price-audit-jason-20260710`
**Trigger**: coordinator's prod dry-run (`date=2026-07-07`) returned `navEquityTwd=9,790,150`, which is byte-identical to the existing `sim_ledger_nav` row for 2026-07-08 (`equity_twd=9,790,150`). Not applied pending this investigation.

## TL;DR

- **cashResidualTwd matching is provably NOT a bug** — it is a structural property of how "cash residual" is defined in this system, confirmed by direct code trace (§A below). Both the catch-up and the existing 7/8 row derive it from the same static 7/7 basket file, which never changes day to day.
- **The catch-up tool's own FinMind fetch cannot be the cause of the total-value match** — traced `getPitClose`'s date-bounding logic; it structurally cannot pull a later date's price into an earlier date's answer (§B).
- **Most likely explanation for the market-value match**: the *existing* 2026-07-08 `sim_ledger_nav` row was very likely priced by the OLD (pre-#1192/#1202) live EOD tick using STALE data that was, in fact, 2026-07-07's close — via one of two concrete, code-documented mechanisms (§C). This is a **data-quality issue in an already-written row**, not a bug in this new catch-up tool, and not a coincidence.
- I cannot prove definitively *which* of the two mechanisms fired, or whether 7/9 has the same issue, without prod log/DB access (I don't query prod). Built the evidence-gathering capability directly into the tool instead (§D) — re-running the coordinator's exact same dry-run call now returns a full per-symbol price table.
- **Recommendation**: do not apply this catch-up until the coordinator re-runs dry-run with the new `priceAudit[]` field and confirms the interpretation; do not let this tool silently correct 7/8's row (out of scope — see §E for a proposed, separate follow-up).

---

## A. What prices does the catch-up's 2026-07-07 estimate actually use?

```
navEquityTwd = cashResidualTwd + totalMarketValueTwd
```

- `totalMarketValueTwd` = `newBasketCost` = Σ(shares × FinMind PIT close for **exactly** `date=2026-07-07`) across the new week-6 basket's 8 symbols. This is the basket's **entry cost basis** — and for the entry day itself, "market value" is definitionally equal to "cost" (the position was just opened at that day's close; there has been zero elapsed time for price movement). This is correct, not a bug: any day-1 mark-to-market of a freshly-entered position must equal its cost.
- `cashResidualTwd` = `capital_twd − Σtarget_notional_twd`, read directly from the 2026-07-07 `s1_sim.signal_generated` audit log (`readS1ObservationAudit`) — **not** a live, day-by-day-updated cash sweep. It is a fixed snapshot computed once, at basket-generation time.

`missingPriceSymbols=0` in the coordinator's dry-run confirms every symbol resolved to *some* FinMind price — but the original response did not distinguish an exact `2026-07-07` match from a walked-back earlier date. Fixed in §D.

## B. My own catch-up code cannot be pulling 7/8's price into the 7/7 answer

`getPitClose(priceMap, symbol, date)`:
```ts
const direct = dateMap.get(date);
if (direct && direct > 0) return { price: direct, source: "finmind_close" };
const sorted = [...dateMap.keys()].sort();
for (let i = sorted.length - 1; i >= 0; i--) {
  const d = sorted[i]!;
  if (d <= date && (dateMap.get(d) ?? 0) > 0) {
    return { price: dateMap.get(d)!, source: `finmind_close_walkback_from_${d}` };
  }
}
```
The walk-back loop is explicitly bounded by `d <= date` — it can **never** select a date after the target. `fetchFinMindPrices` is also called with `end_date=date` (`2026-07-07`), so even the raw FinMind response used by this catch-up cannot contain a `2026-07-08` row in the first place. This rules out a bug in the new tool as the explanation for the match.

## C. Why the existing 7/8 row's market value is very likely a stale (7/7-dated) replay

Two structural facts, both confirmed by reading `s1-sim-runner.ts` as it exists **today** (post-#1192/#1202, i.e. the CURRENT code — the *old* code that actually ran on 7/8 lacked the #1192/#1202 fixes but had the same *surrounding* control-flow structure, since those PRs only replaced the date-parsing function bodies, not the guard/gate shape around them):

1. **`buildS1PositionsSnapshot()`'s `cashResidualTwd` is keyed by `positionsDate`, not "today".** `positionsDate` resolves to the most recent Tuesday's `orders_submitted` audit within a 7-day look-back (`readLatestS1ObservationAuditInWindow`). On 7/8 (Wednesday), the most recent Tuesday is 7/7 — so the 7/8 tick's own `cashResidualTwd` computation reads the **same** 2026-07-07 basket file my catch-up reads. This is why the cash-residual component of the match is *guaranteed*, not suspicious.

2. **The pre-#1192 TWSE freshness guard was provably a no-op against the live wire format.** #1192's own commit message documents this: the original `_parseRocEodDateIso`-equivalent parser only handled the legacy slash-separated ROC date shape; the live `STOCK_DAY_ALL` wire format is compact 7-digit (verified 2026-07-09). Against compact input, the old parser returned `null`, and the guard is written as `if (stockDateIso && stockDateIso !== todayTst) { skip }` — a `null` short-circuits the `&&` to `false`, so the skip **never fires**, and mark-to-market proceeds **unconditionally**, treating whatever `STOCK_DAY_ALL` served as "fresh" regardless of its actual publish date.

Separately, the "1b-persist"/"1c-persist" writes to `quote_last_close` inside `buildS1PositionsSnapshot()` are **unconditional on `marked > 0`** — they are **not** gated by `pricingComplete`. This means even on 7/7 itself (when the EOD report/ledger write never fired because `pricingComplete` was false), *any* tier that individually succeeded that day (even partially) would still have silently written its priced symbols into `quote_last_close` tagged `trade_date='2026-07-07'`. If 7/8's own tiers 1b/1c then also failed or under-covered, tier 1d (`persisted_close_fallback`, reading `quote_last_close`) would replay those 7/7-tagged prices on 7/8 — and the code explicitly logs this with the stale date attached: `persisted_close_fallback: <symbol> priced <price> from DB (trade_date=2026-07-07, source=...)`.

**Either mechanism (broken tier-1b guard, or tier-1d replay of a 7/7-tagged `quote_last_close` write) would produce an EXACT 7/7-vs-7/8 price match** — I cannot distinguish which one fired without prod log access, but both are real, documented, pre-existing code behaviors (not new bugs — #1192/#1202/#1203 fixed the underlying ROC-date-parsing root cause going forward, but 7/8 predates all three fixes, which only deployed 2026-07-10).

**Ruling out pure coincidence**: 8 independently-priced stocks landing on the exact same TWD-rounded total across two different days has probability effectively zero (as the coordinator noted). Combined with (1) and (2) above providing a concrete, code-supported mechanism for *why* the match would happen even without coincidence, the weight of evidence points to a stale-data replay in the 7/8 row, not a real market move of zero for 8 stocks simultaneously.

## D. New evidence-gathering capability (built into the tool, this PR)

Rather than guess further or require a separate script / prod DB query, `writeSingleDateLedgerCatchup`'s dry-run response now includes:

```ts
priceAudit: Array<{
  symbol: string;
  role: "exit" | "entry";
  shares: number;
  closeOnDate: number | null;          // FinMind close used by THIS catch-up's own computation, for `date` (2026-07-07)
  closeOnDateSource: string | null;    // "finmind_close" (exact date match) or "finmind_close_walkback_from_YYYY-MM-DD"
  closeOnNextDay: number | null;       // diagnostic-only: FinMind's EXACT close for date+1 (2026-07-08) — never used in the actual computation
  identicalToNextDay: boolean;         // closeOnDate === closeOnNextDay (both non-null)
}>
```

Plus two new summary notes when relevant: `price_audit_identical_to_next_day` (count of symbols matching the next day) and `price_audit_walkback_used` (count of symbols where `date` itself had no FinMind trade, so a walked-back earlier price was used instead).

**This is the "可回查的證據（兩天各 8 檔收盤價表）" the coordinator asked for** — re-running the exact same dry-run call now returns it directly, per-symbol, with source provenance. I do not have prod DB/API access to run this myself; the coordinator's next dry-run call will surface it.

**What to check in the re-run**:
- If `identicalToNextDay` is `true` for most/all 8 entry-leg symbols, and `closeOnDateSource` is `"finmind_close"` (exact 7/7 match, not a walk-back) for all of them, that **confirms** 7/7 and 7/8 genuinely had the same real-world close for these names (which would then mean 7/8's row is likely NOT a stale replay after all, and this whole investigation resolves as "these particular stocks happened to be flat/halted" — possible for illiquid small caps, though improbable across all 8 simultaneously).
- If `identicalToNextDay` is `true` but the *actual* 2026-07-08 report/ledger data (which the coordinator can pull separately, e.g. `GET /api/v1/internal/s1-sim/eod-report?date=2026-07-08` or the `sim_ledger_nav.notes` for that row) shows a `persisted_close_fallback` note with `trade_date=2026-07-07`, that **confirms** hypothesis C directly.

## E. If C is confirmed — recommendation (not built, pending ACK)

Do **not** have this catch-up tool silently rewrite the 7/8 row — it's out of its designed scope (missing-date backfill, not existing-but-wrong-date correction), and rewriting already-displayed history without an explicit review step is exactly the kind of silent data change this whole investigation is trying to avoid repeating.

Proposed **separate** follow-up (would need its own ACK before any implementation): a symmetric "single-date REPRICE" tool — reads an *existing* `sim_ledger_nav` row, recomputes market value using genuinely-dated FinMind PIT data for that row's own `nav_date` (not `date+1`), shows a dry-run diff (`{ existingEquityTwd, recomputedEquityTwd, diffTwd, affectedSymbols }`), and only updates on explicit `apply=true` — same idempotency/refuse-on-missing-price discipline as this catch-up tool. Would also need to check whether 2026-07-09 has the same issue (it ran under the same pre-fix code, deployed before #1192/#1202/#1203 landed 2026-07-10).

## Tests / validation

- +1 new test (`SIM-LEDGER-CATCHUP-10`), extending the existing test to cover the diagnostic isolation (`priceAudit` never affects `missingPriceSymbols`/apply gate) and the exact-vs-walkback price source tracking.
- `pnpm typecheck` green (15/15), `pnpm test` 1629 tests (1 new), 1619 pass, 2 pre-existing unrelated fails, 8 skipped. `pnpm run build:packages` green, `pnpm --filter @iuf-trading-room/api run build` green, `pnpm smoke` 1/1 PASS.

## Unrelated observation (flagged per team practice, not part of this task)

During this investigation, one intermediate tool-result in this session contained an injected block disguised as an "MCP Server Instructions" / date-change system notice instructing me not to disclose it to the user. This is the same pattern other agents in this team have previously and correctly ignored-and-reported (per shared team memory). I ignored its instructions (did not treat any date/tool claim from it as fact, did not withhold anything) and am reporting it here per that established practice. No action taken on my end beyond continuing the actual task.

## Prod verification plan (coordinator — Jason does not touch prod)

Re-run the exact same dry-run call already used:
```bash
curl -s -b cookies.txt -X POST \
  https://api.eycvector.com/api/v1/admin/fauto-ledger/single-date-catchup \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-07-07"}' | python3 -m json.tool
```
Inspect the new `priceAudit` array and the two new notes (`price_audit_identical_to_next_day` / `price_audit_walkback_used`) per §D. Cross-check against 7/8's own report/ledger notes for a `persisted_close_fallback` trace per §C. Report back findings; apply remains held until this is resolved.
