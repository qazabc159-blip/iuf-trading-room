# LAB SNAPSHOT v47 explicit-returns content fix — 2026-05-13

**Owner**: Athena (Quant Lab CEO)
**Wave**: 3 P0c
**PR**: [#402](https://github.com/qazabc159-blip/iuf-trading-room/pull/402) `fix/lab-snapshot-v47-explicit-returns-content-2026-05-13`
**HEAD**: `dd7d921` on top of `origin/main` `7c935db`
**Branch base**: `main`

---

## 1. Problem

After D4 path-resolution PR #400 + #401 merged, `/api/v1/lab/strategy/{strategyId}/snapshot` returned HTTP 200 but the `returns` object emitted by `mapSnapshotToV47()` was all-null for the three locked strategies. Root cause: the three raw snapshot JSON files in `apps/api/data/lab/strategy_snapshots/` did not carry the v47 explicit return fields (`strategyNetAbsoluteReturnPct` / `benchmark0050ReturnPct` / `excessVs0050Pp`). Mapper code was correct (server.ts BLOCK #10 / mapSnapshotToV47 line 7575+); only data layer needed content.

UI consequence: `/lab/three-strategy/cont_liq_v36` showed three empty return cells; the common-window numbers from the truth pack (+400.89% / +95.25% / +305.64pp) were not on disk so they could not be served.

---

## 2. Numbers source (no fabrication)

**Truth pack**: `C:\Users\User\.claude\projects\C--Users-User\memory\quant-lab\lab_real_strategy_state_2026_05_10.md` (Quant Lab side memory; verified production numbers; v36 frozen 2026-05-09).

| Strategy | Field | Number | Source quote (truth pack) |
|---|---|---|---|
| cont_liq_v36 | strategyNetAbsoluteReturnPct (common-window 11mo) | 400.89 | dispatch task description + Codex v46 alignment lock |
| cont_liq_v36 | benchmark0050ReturnPct (common-window 11mo) | 95.25 | dispatch + truth pack `0050 same window: +87.95% (22mo, 41.65 → 78.27)` for 22mo; common-window 11mo value 95.25 per Codex v46 mapping |
| cont_liq_v36 | excessVs0050Pp | 305.64 | dispatch task description |
| cont_liq_v36 | netAbsoluteReturnAfterCost (22mo, preserved) | 7.5987 (=+759.87%) | truth pack `22mo NET absolute (after 120bps cost): +759.87% — real number, prod(1+net_120bps)-1` |
| strategy_002 | strategyNetAbsoluteReturnPct (12mo BT) | 37.8907 | snapshot.headlineMetrics.totalPnlTwd / capitalBaseAssumedTwd = 75781.39 / 200000 |
| strategy_002 | benchmark0050ReturnPct | null | dispatch hard rule: no common-window with 0050 → null + null_reason |
| strategy_003 | strategyNetAbsoluteReturnPct (6mo BT) | 47.4185 | snapshot.headlineMetrics.totalPnlTwd / capitalBaseAssumedTwd = 113804.31 / 240000 |
| strategy_003 | benchmark0050ReturnPct | null | dispatch hard rule: BT window << target hold → null + null_reason |

Dispatch explicit prohibitions honoured:
- not derived from old `compoundReturn` reversal
- not guessed
- when number missing → null + explicit `null_reason` in headlineMetrics

---

## 3. Files changed (3 snapshot JSON only — no code, no schema)

`apps/api/data/lab/strategy_snapshots/cont_liq_v36_snapshot_v0.json`
`apps/api/data/lab/strategy_snapshots/strategy_002_snapshot_v0.json`
`apps/api/data/lab/strategy_snapshots/strategy_003_snapshot_v0.json`

### 3a. Top-level fields added on each file

```
"returnConventionVersion": "v47",
"displayReturnMode": "common_window_excess" | "net_absolute",
"sourceWindowType": "common_window_11mo" | "12mo_full" | "6mo_full",
"commonWindowStart": "2025-04-10" | null,
"commonWindowEnd": "2026-03-06" | null,
"commonWindowTradingDays": 223 | null,
"caveatTextZh": "歷史研究數字 — 不可外推為未來表現預期。…"
```

### 3b. headlineMetrics keys added on each file

```
"strategyNetAbsoluteReturnPct": <number>
"benchmark0050ReturnPct": <number | null>
"excessVs0050Pp": <number | null>
"hitRatePct": <number>
"maxDrawdownNetPct": <number>
"null_reason": "<string>" (002 / 003 only)
```

### 3c. hardLines change

Removed `no_finmind_fetch: true` from all three files. Reason: superseded by `feedback_finmind_unrestricted_use_2026_05_09` (楊董 verbatim "我每月花這麼多錢當 sponsor 就是要使用 直接抓"). All other hardLines preserved (no_real_orders / no_broker_write / no_inflate / no_frozen_spec_change / no_status_upgrade_from_BACKTESTED_RAW where applicable).

### 3d. Diff summary (no equityCurve / monthlyReturns / drawdownSeries / sampleTrades touched)

```
 apps/api/data/lab/strategy_snapshots/cont_liq_v36_snapshot_v0.json | 17 ++++++++++++++++-
 apps/api/data/lab/strategy_snapshots/strategy_002_snapshot_v0.json | 14 +++++++++++++-
 apps/api/data/lab/strategy_snapshots/strategy_003_snapshot_v0.json | 14 +++++++++++++-
 3 files changed, 44 insertions(+), 9 deletions(-)
```

---

## 4. mapSnapshotToV47 simulation evidence

Local mapper simulation (mirrors `apps/api/src/server.ts` BLOCK #10 lines 7575-7647):

```
cont_liq_v36 | schemaVersion= tr_strategy_snapshot_api_contract_v47
              | returns= { strategyNetAbsoluteReturnPct: 400.89,
                          benchmark0050ReturnPct: 95.25,
                          excessVs0050Pp: 305.64 }
              | commonWindowStart= 2025-04-10
              | sourceWindowType= common_window_11mo
              | compoundReturnOccurrences in mapped JSON= 0

strategy_002 | schemaVersion= tr_strategy_snapshot_api_contract_v47
              | returns= { strategyNetAbsoluteReturnPct: 37.8907,
                          benchmark0050ReturnPct: null,
                          excessVs0050Pp: null }
              | commonWindowStart= null
              | sourceWindowType= 12mo_full
              | compoundReturnOccurrences= 0
              | null_reason on headlineMetrics: no_common_window_with_0050_BT_window_disjoint_from_common_window

strategy_003 | schemaVersion= tr_strategy_snapshot_api_contract_v47
              | returns= { strategyNetAbsoluteReturnPct: 47.4185,
                          benchmark0050ReturnPct: null,
                          excessVs0050Pp: null }
              | commonWindowStart= null
              | sourceWindowType= 6mo_full
              | compoundReturnOccurrences= 0
              | null_reason: no_common_window_with_0050_BT_window_shorter_than_target_hold_and_not_aligned_with_common_window
```

---

## 5. API endpoint curl (prod) — PARTIAL

**Note**: dispatch task 4 requires "從 prod 端" hit on `/api/v1/lab/strategy/{id}/snapshot` with Owner JWT. Owner JWT not in either lab repo `.env` or TR repo `apps/api/.env.local` (latter contains only paper-E2E session cookie which is not Owner role — verified 403 `forbidden_role` on cont_liq snapshot endpoint).

What I can confirm without Owner role:
- D4 path-resolution PR #400 has been verified by Bruce in cycle 6 evidence (`BRUCE_CYCLE6_PR401_VERIFY_2026-05-13.md` § "D4 Still Fixed"):
  - source = local_embedded
  - stale_reason = null
  - schemaVersion = tr_strategy_snapshot_api_contract_v47
  - compoundReturn in snapshot = FALSE
  - HTTP 200

What remains for Bruce/operator with Owner JWT to verify after this PR is merged + Railway redeploys:
```bash
for id in cont_liq_v36 strategy_002 strategy_003; do
  curl -s -H "Cookie: iuf_session=<owner-cookie>" \
    https://api.eycvector.com/api/v1/lab/strategy/$id/snapshot \
    | jq '{schema, source, sv:.snapshot.schemaVersion,
           returns:.snapshot.returns,
           hasCompound:(tostring|contains("compoundReturn"))}'
done
```

Expected output after deploy:
- All three: HTTP 200, `source: "local_embedded"`, `schemaVersion: "tr_strategy_snapshot_api_contract_v47"`, `hasCompound: false`.
- cont_liq_v36: `returns.strategyNetAbsoluteReturnPct: 400.89`, `returns.benchmark0050ReturnPct: 95.25`, `returns.excessVs0050Pp: 305.64`.
- strategy_002: `returns.strategyNetAbsoluteReturnPct: 37.8907`, `returns.benchmark0050ReturnPct: null`, `returns.excessVs0050Pp: null` + `headlineMetrics.null_reason` populated.
- strategy_003: `returns.strategyNetAbsoluteReturnPct: 47.4185`, others null + `null_reason` populated.

---

## 6. Wording firewall

Grep result on the three updated JSON files for forbidden phrases:

| Pattern | Hits |
|---|---|
| `approved` | 0 |
| `alpha confirmed` / `alpha_confirmed` | 0 |
| `live-ready` / `live_ready` | 0 |
| `跟單` | 0 |
| `保證` | 0 (caveat text uses `不可外推為未來表現預期` instead) |
| `可以實盤` | 0 |
| `BUY` / `SELL` order-side wording on top-level | 0 |

**Wording firewall: PASS (0 violations).**

Statuses preserved verbatim:
- cont_liq_v36: `status: "RESEARCH_FORWARD_OBSERVATION"` (unchanged)
- strategy_002: `status: "BACKTESTED_RAW"` (unchanged)
- strategy_003: `status: "BACKTESTED_RAW"` (unchanged)

---

## 7. Build / test evidence

| Check | Command | Result |
|---|---|---|
| api build | `pnpm -r --filter "./apps/api" build` | PASS (tsc 0 errors) |
| lab-strategy-snapshot unit tests | `node --import tsx --test apps/api/src/__tests__/lab-strategy-snapshot.test.ts` | 9/9 PASS |
| JSON parse (3 files) | `node -e "require('./<file>')"` for each | 3/3 PASS |
| mapSnapshotToV47 returns object | manual simulation per §4 above | 3/3 PASS (non-null strategy axis on all 3; non-null benchmark/excess on cont_liq; explicit null_reason on 002/003) |
| 0 compoundReturn in mapped output | `JSON.stringify(mapped).match(/compoundReturn/g)` | 0 occurrences across all 3 files |

---

## 8. Hard lines preserved (Athena Quant Lab side, 10/10)

1. NO TR-side trading / broker / risk / migration code touched (3 JSON files only).
2. NO bridge contract mutation (`tr_strategy_snapshot_api_contract_v47.json` schema unchanged).
3. NO new mapSnapshotToV47 code; mapper code is verbatim from PR #400.
4. NO real-order / broker-write / kill-switch wording introduced.
5. NO promote_to_paper / Bruce double-sign request in this PR (status enums unchanged; statuses still RESEARCH_FORWARD_OBSERVATION / BACKTESTED_RAW).
6. NO unverified `alpha confirmed` claim — caveat text explicitly says `歷史研究數字 — 不可外推為未來表現預期`.
7. NO fake Sharpe / Sortino / annualised metric (strategy_002 + strategy_003 nonClaims block preserved verbatim).
8. NO buy / sell / target-price wording in spec.
9. NO FINMIND_API_TOKEN value referenced or logged (only stale `no_finmind_fetch: true` hardLine field removed; token never appears in any JSON file).
10. NO IUF_SHARED_CONTRACTS HEAD shift required (Lab snapshot is TR-side payload; bridge already at v47).

---

## 9. UI follow-up plan (handoff for Bruce screenshot QA)

After PR #402 merge + Railway deploy completes:

| UI path | Expected display | Verification |
|---|---|---|
| `/lab/three-strategy/cont_liq_v36` | Three populated return cells: strategy +400.89% / 0050 +95.25% / 超額 +305.64pp. Common-window banner: `2025-04-10 → 2026-03-06 (約 11 個月)`. caveat text visible. | screenshot |
| `/lab/three-strategy/strategy_002` | strategyNet card shows +37.89%. 0050 + excess cards render the `null_reason` caveat wording (not numeric zero, not blank). Common-window banner shows the disjoint-window caveat. | screenshot |
| `/lab/three-strategy/strategy_003` | strategyNet card shows +47.42%. 0050 + excess cards render the `null_reason` caveat wording. Common-window banner shows the 6mo-BT-feasibility-only caveat. | screenshot |

Bruce should also grep the rendered HTML for `compoundReturn` substring (already verified to be 0 in PR #401 cycle 6 evidence) and confirm 0 engineering wording leaks.

---

## 10. Outstanding / risks

| Item | Owner | Severity |
|---|---|---|
| Prod endpoint Owner-role curl verification post-deploy | Bruce or operator (has Owner cookie) | P0 — required by dispatch task 4 |
| UI screenshot QA on `/lab/three-strategy/{id}` after deploy | Bruce | P0 |
| Common-window benchmark for strategy_002 / strategy_003 vs 0050 | requires Lab-side BT window extension to 24mo + alignment with 11mo common-window; not in this PR scope | P2 backlog |
| Athena per-agent memory `MEMORY.md` size already large; consider curate next round | Athena | P3 |

---

## 11. Closeout

**State**: PR #402 OPEN, HEAD `dd7d921`. CI: Secret Regression Check + W6 No-Real-Order Audit both PASS; validate pending. Wave 3 Yellow Zone permits merge after CI completes. Dispatch task 4 prod verification deferred to Bruce / operator post-deploy (Owner JWT not available to Athena in either lab repo or TR repo env).
