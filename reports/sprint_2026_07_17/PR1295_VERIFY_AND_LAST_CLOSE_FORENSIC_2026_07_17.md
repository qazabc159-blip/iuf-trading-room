# PR #1295 post-deploy verify + quote_last_close historical pollution forensic (2026-07-17)

Verifier: Bruce. Prod deploy under test: `buildCommit=627f05311acb8eaec2f2f540918349f1acfd358e` (`/health`
confirmed `deploymentId=90f3a379-5bea-470f-850a-38854e45be76`, matches `origin/main` HEAD at time of test).
Owner session via `POST https://api.eycvector.com/auth/login`. Evidence files in
`reports/sprint_2026_07_17/pr1295_verify_evidence/`.

## Conclusion (top line)

- **A. PR #1295 fix**: 3/3 PASS. All 5 previously-corrupted heatmap tiles now show mathematically
  consistent, plausible ≥1,000 prices; `/realtime/snapshot` (the canonical endpoint) agrees exactly;
  the other 35 tiles are byte-identical to the pre-fix baseline (no collateral damage).
- **B. quote_last_close historical pollution**: **無污染且無 NAV 影響（結論一，非二/三選項）** — direct
  DB query across the full persisted history (31,270 rows, 2026-06-30→2026-07-17) found **zero**
  instances of the corruption signature, AND a structural argument closes the question definitively:
  every symbol F-AUTO/S1 SIM has ever held tops out at **577.00 TWD** (`sim_ledger_holdings` overall
  max entry/exit) — the comma-truncation bug requires a source price ≥1,000 to even manifest (TWSE
  formats `"2,470.0000"` only once ≥1,000; below that there is no comma to truncate at). The
  precondition for this bug never existed in this ledger's price range. NAV history (`sim_ledger_nav`,
  6/2→7/17) is continuous and sane throughout.

---

## A. PR #1295 fix — prod verification (3/3 PASS)

### A1. `GET /api/v1/market/heatmap/kgi-core` — 5 previously-corrupted tiles

| symbol | before (pre-fix, same-day baseline) | after (post-deploy) | check |
|---|---|---|---|
| 2330 | price:2, change:-180, changePct:null | price:**2290**, change:-180, changePct:**-7.29** | PASS — 2290+180=2470, -180/2470=-7.29% ✓ |
| 2454 | price:3, change:-330, changePct:null | price:**3370**, change:-330, changePct:**-8.92** | PASS — 3370+330=3700, -330/3700=-8.92% ✓ |
| 2308 | price:1, change:-165, changePct:null | price:**1740**, change:-165, changePct:**-8.66** | PASS — 1740+165=1905, -165/1905=-8.66% ✓ |
| 3008 | price:4, change:-250, changePct:null | price:**4010**, change:-250, changePct:**-5.87** | PASS — 4010+250=4260, -250/4260=-5.87% ✓ |
| 6669 | price:4, change:-495, changePct:null | price:**4620**, change:-495, changePct:**-9.68** | PASS — 4620+495=5115, -495/5115=-9.68% ✓ |

Before-baseline = `reports/sprint_2026_07_17/kgi_core_heatmap_anomaly_20260717.json` (captured pre-merge
same trading day). After = `pr1295_verify_evidence/heatmap_after_1295_kgi_core.json`. All 5 `price`
values are now internally consistent with their own `change`/`changePct` fields (arithmetic verified
above) — not just "looks big enough."

### A2. `GET /api/v1/realtime/snapshot` (canonical endpoint) — cross-check

`?symbols=2330,2454,2308,3008,6669,2317,2882` → HTTP 200. 2330: `last_price:2290, prev_close:2470,
change:-180, change_pct:-7.29` — **exact match** to the heatmap tile above (same underlying fix,
independent endpoint, consistent output). 2454/2308/3008/6669 all likewise match their heatmap values
exactly. PASS.

### A3. Other 35 tiles — no collateral damage

Programmatic diff of all 40 tiles, before vs after, excluding the 5 targets: **0 mismatches** on
`price` or `change` for the remaining 35 symbols — byte-identical to the pre-fix baseline. PASS.

**A verdict: 3/3 PASS. #1295 fix confirmed live in prod, collateral-damage-free.**

---

## B. quote_last_close historical pollution forensic

### Access

Prod DB reachable via `railway ssh` (private `pg.railway.internal` hostname; no public DB endpoint,
confirming PR #1295's RCA note that Jason/Pete's sandbox genuinely could not reach it). Remote
container has no `psql`; queried via `node` + the API's own `postgres` npm client, per existing
`memory_railway_ssh_local_key_setup_20260713` pattern (SSH key + `~/.ssh/config` `railway-api` alias
already provisioned from a prior session). Query scripts + raw JSON output are committed in
`pr1295_verify_evidence/` for reproducibility.

### Query 1 — the exact 5 corrupted-in-heatmap symbols, all historical quote_last_close rows

`db_forensic_1_out.json` → `five_symbols` (30 rows, 2330/2454/2308/3008/6669, 2026-07-09→07-17, all
`source=twse_eod`): every single row is a clean, plausible ≥1,000-range value with day-over-day price
continuity (e.g. 2330: 2415→2440→2420→2440→2470→2290). **Zero corrupted rows for these 5 symbols,
ever.** Why: these rows were written by the server.ts full-universe TWSE-EOD-QUOTE-CRON, whose own
parser (`parseEodNum`, comma-safe, `s.replace(/,/g,"")`) was never affected by this bug — not by the
buggy `s1-sim-runner.ts` mark-to-market write path. Confirmed by `holdings_overlap_5` = `[]`: F-AUTO/S1
SIM has never held any of these 5 symbols, so the buggy write path never touched them at all.

### Query 2 — self-referential corruption signature, whole table

`db_forensic_1_out.json` → `self_ref_corruption`: for every symbol that has EVER shown a close_price
≥1,000 under `source IN ('twse_eod','tpex_eod')`, check whether that same symbol ALSO has a
suspiciously small (<15) whole-number row elsewhere. **0 rows returned** — no symbol in the entire
31,270-row table exhibits this pattern.

`db_forensic_2_out.json` → broadened to all whole-number close_price values in [1,9] and [1,99]
(`integer_1to9`: 243 rows, `integer_1to99`: capped at 300). Manually spot-checked: these are legitimate
low-priced instruments (penny stocks like 1447/5907/6264, and 6-digit `70xxxx`-prefix covered-warrant
codes, which genuinely trade at single-digit TWD) — none of them appear anywhere else in the table with
a ≥1,000 price, so none are truncation artifacts of a real high-price stock.

### Query 3 — F-AUTO/S1 held-basket price ceiling (structural closure of the question)

`db_forensic_3_out.json` → `sim_ledger_holdings` (the actual F-AUTO/S1 SIM basket ledger, 49 distinct
symbols ever held, 2026-06-02→present): `overall_max_entry = 577.0000`, `overall_max_exit = 565.0000`.
**No symbol F-AUTO has ever held has traded anywhere near the ≥1,000 threshold** that causes TWSE to
emit a thousands-comma in `ClosingPrice`/`Change` (e.g. `"2,470.0000"`). Below 1,000 there is nothing
for `parseFloat()` to truncate at — the bug's precondition never existed for this specific ledger's
universe, independent of whether the buggy code path ever ran. `holdings_vs_qlc_anomaly` (join against
quote_last_close, `close_price < entry_price_twd * 0.15`) also returned **0 rows**.

### Query 4 — TPEX EOD persist block: checked, not a live bug

Noted while reading the diff: `server.ts`'s TWSE-EOD-QUOTE-CRON TPEX persist block (~line 19681,
`const close = parseFloat(r.Close ?? "")`) still uses a bare `parseFloat` and was **not** among the 5
sites PR #1295 fixed. Flagged this as a possible 6th unpatched site and checked it directly: live TPEX
`tpex_mainboard_daily_close_quotes` API returns `Close` as e.g. `"12950.00"` — **no thousands-comma**,
confirmed against a live curl of the real endpoint for 5274 (信驊, ~13,000 TWD, the highest-priced OTC
stock in the persisted data — `db_forensic_4_tpex_check.json`: `tpex_eod_max=13905.00`, top-20 shows a
clean continuous 13905/13900/13665/12985/12950 sequence). TWSE STOCK_DAY_ALL is the only affected source (it alone
formats with thousands-commas); TPEX's own API was never vulnerable to this bug class. **Not a
finding — checked and cleared, no action needed.**

### NAV sanity

`db_forensic_3_out.json` → `nav_all`: `sim_ledger_nav` 2026-06-02→2026-07-17, continuous day-over-day,
no discontinuous jumps. 7/16 = 10,306,750 (+3.07%) confirmed as the real persisted value (matches what
was referenced in dispatch). 7/17 (today, post-fix) = 10,014,550 (+0.15%).

### B verdict

**污染不存在（結論一）**：quote_last_close 從未被這個 bug 寫入過任何損壞值 — 不是「衝擊有限」，是這個
bug 的前提條件（真實股價 ≥1,000 元）在 F-AUTO/S1 SIM 曾持有過的整個標的池（49 檔，史上最高 577 元）
裡從未出現過，結構性不可能觸發；直接查表（243 筆低價行、自我對照掃描全表）也 0 筆命中損壞特徵。NAV
history 全程連續無斷點。

---

## Verification commands (reproducible)

```bash
# A — auth + endpoint checks
curl -s -c cookies.txt -X POST https://api.eycvector.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"qazabc159@gmail.com","password":"[REDACTED-OWNER-PW]"}'
curl -s -b cookies.txt https://api.eycvector.com/api/v1/market/heatmap/kgi-core
curl -s -b cookies.txt "https://api.eycvector.com/api/v1/realtime/snapshot?symbols=2330,2454,2308,3008,6669"

# B — prod DB via railway ssh (key + config already provisioned, see
# memory_railway_ssh_local_key_setup_20260713)
ssh -i ~/.ssh/id_ed25519 railway-api -- "node /tmp/forensic.js"   # see pr1295_verify_evidence/query_*.js
```

## Files

- `pr1295_verify_evidence/heatmap_after_1295_kgi_core.json` — post-fix heatmap response (40 tiles)
- `pr1295_verify_evidence/snapshot_after_1295_realtime.json` — post-fix `/realtime/snapshot` response
- `pr1295_verify_evidence/db_forensic_1_out.json` — 5-symbol history, self-ref corruption scan, holdings overlap
- `pr1295_verify_evidence/db_forensic_2_out.json` — whole-table integer-value scan
- `pr1295_verify_evidence/db_forensic_3_out.json` — holdings price ceiling + NAV history
- `pr1295_verify_evidence/db_forensic_4_tpex_check.json` — TPEX source format check (5274/6223/3131/7734)
- `pr1295_verify_evidence/query_1_symbols_and_selfref.js` / `query_2_integer_scan.js` /
  `query_3_holdings_price_range_and_nav.js` / `query_4_tpex_source_check.js` — exact queries run (reproducible)
