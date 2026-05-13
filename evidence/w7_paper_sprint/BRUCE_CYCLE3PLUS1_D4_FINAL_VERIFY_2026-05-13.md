---
name: Bruce D4 Final Verify — PR #400 Path Resolution + Full JSON Content
date: 2026-05-13T17:09:00+08:00
deploymentId: 14bac8a4-9e43-4f86-880d-a142722ed98e
gha_ci_run: 25749399998 (ffc00e213fcb, success)
gha_deploy_run: 25749549235 (ffc00e213fcb, success)
---

# Bruce D4 Final Verify — PR #400

## Deploy Chain

| Stage | Run ID | SHA (12ch) | Status |
|-------|--------|-----------|--------|
| PR #400 merged | — | 2eba9b0cbeaf | MERGED 16:57:26Z |
| CI (merge commit to main) | 25749399998 | ffc00e213fcb | success |
| Deploy to Railway | 25749549235 | ffc00e213fcb | success |
| Railway restart | deploymentId 14bac8a4 | — | uptime=199s at probe time |

Previous deployed SHA: 2ce81bc3 (deploymentId 69f92ea6) — now superseded.

## Auth

```
POST /auth/login  →  200  role=Owner  id=c1753415
Cookie: iuf_session=[REDACTED]
```

## Snapshot Endpoint Results

| Strategy | HTTP | source | equityCurve.points | sampleTrades.entries | stale_reason |
|---|---|---|---|---|---|
| cont_liq_v36 | 200 | local_embedded | 13 | 8 | null |
| strategy_002 | 200 | local_embedded | 42 | 8 | null |
| strategy_003 | 200 | local_embedded | 59 | 8 | null |

All 3 match spec exactly.

## Data Integrity Check

### cont_liq_v36
- equityCurve.points = 13 (spec: >=13) — PASS
- sampleTrades.entries = 8 (spec: 8) — PASS
- source = local_embedded — PASS
- stale_reason = null — PASS

### strategy_002
- equityCurve.points = 42 (spec: 42) — PASS (daily_downsampled, 2025-05-02 → 2026-04-30)
- sampleTrades.entries = 8 (spec: 8) — PASS
- source = local_embedded — PASS

### strategy_003
- equityCurve.points = 59 (spec: 59) — PASS (daily_downsampled, 2025-11-03 → 2026-04-30)
- sampleTrades.entries = 8 (spec: 8) — PASS
- source = local_embedded — PASS

## v47 Fields (cont_liq_v36)

| Field | Expected | Observed | Result |
|---|---|---|---|
| schema (top-level) | tr_strategy_snapshot_api_contract_v47 | tr_strategy_snapshot_api_contract_v47 | PASS |
| schemaVersion (snapshot) | tr_strategy_snapshot_api_contract_v47 | tr_strategy_snapshot_api_contract_v47 | PASS |
| compoundReturn | ABSENT (removed) | NOT PRESENT | PASS |
| compoundReturnNetOfBenchmark | ABSENT (removed) | NOT PRESENT | PASS |
| returns object | { strategyNetAbsoluteReturnPct, benchmark0050ReturnPct, excessVs0050Pp } | PRESENT | PASS |
| netAbsoluteReturnAfterCost | 7.5987 (true net absolute) | 7.5987 | PASS |
| excessReturnOverBenchmark | 2.2202 (labeled correctly as excess) | 2.2202 | PASS |
| returnConventionVersion | explicit_absolute_vs_excess_v1 | explicit_absolute_vs_excess_v1 | PASS |
| _v47Mapped | true | true | PASS |
| cache_hit | false | false | PASS (cold embed read) |

v47 fields verified: ALL 9 PASS.

## UI Live Data Check

Page: https://app.eycvector.com/lab/three-strategy/cont_liq_v36
HTTP status: 200

Key UI render evidence:
- "B.1 策略原始證據窗" shows: "+759.87%" — this is netAbsoluteReturnAfterCost=7.5987 correctly displayed as percentage
- Old hardcoded "2.2202" NOT displayed as cumulative return metric — PASS
- excessReturn 2.2202 now appears as "excess return" label, NOT mislabeled as net return — PASS
- Data source note present: "數據來源：Codex v46 backtest output (2026-05-12)"

UI render live data: YES — reading from API, not hardcoded 2.2202 for net return metric.

## Stop-Line Audit

- No broker_token / api_key / KGI credentials in response — PASS
- No real order capability (brokerWriteAllowed=false, realOrderAllowed=false) — PASS
- displayMode=research_only across all 3 — PASS
- orderState=blocked across all 3 — PASS

## Final Output

```
== Bruce D4 Final Verify PR #400 ==
cont_liq_v36: status=200 source=local_embedded points=13 entries=8
strategy_002: status=200 source=local_embedded points=42 entries=8
strategy_003: status=200 source=local_embedded points=59 entries=8
v47 fields: schema/schemaVersion/returns-object/returnConventionVersion/_v47Mapped/no-compoundReturn/netAbsoluteReturnAfterCost=7.5987/excessReturn=2.2202-correctly-labeled
UI render live data: YES (shows +759.87% = 7.5987 net absolute, not hardcoded 2.2202)
D4 verdict: FIXED
```

## Notes

- PR #394 (v47 API closure) is still OPEN — schemaVersion and v47 fields verified here are from PR #400 local_embedded JSON embed, which already carries the correct v47 contract shape. PR #394 removes compoundReturn from the API layer and adds `returns` object. Both present in local_embedded. PR #394 deploy will add backend API-layer enforcement but UI reads local_embedded today.
- Railway process.cwd() path trap (noted in memory_lab_snapshot_railway_cwd_trap.md) is RESOLVED by PR #400 — source=local_embedded confirms embed-in-bundle approach works.
