# Bruce PowerShell Smoke Harness — 2026-05-05

**Script:** `scripts\verify\Invoke-ProductionSmoke.ps1`
**Version:** 1.0.0
**Authored:** Bruce (verifier-release-bruce), 2026-05-05 TST
**Motivation:** K-line incident root cause — ETL dead 6-10 days, Bash-dead Bruce had 0 detection capability.
**Status:** READY_TO_RUN — operator must execute (Bash dead, 21st+ session)

---

## How to Run (one command from repo root)

```powershell
# Baseline run (expected FAIL on items 4/5/6/8/9 — K-line incident state)
.\scripts\verify\Invoke-ProductionSmoke.ps1

# Watch mode — run every 60s, append to evidence file (use while Jason deploys F1-F4)
.\scripts\verify\Invoke-ProductionSmoke.ps1 -Watch
```

Evidence files auto-written to:
- `evidence\w7_paper_sprint\bruce_smoke_run_<yyyyMMdd-HHmm>.md` (per-run)
- This file updated with run history when harness first runs

---

## 12 Test Items

| # | Endpoint | Key assertion | K-line incident relevance |
|---|---|---|---|
| 1 | POST /auth/login | Cookie present, len>0, value REDACTED | auth baseline |
| 2 | GET /health | status==ok, uptime parseable | process alive |
| 3 | GET /api/v1/companies/2330 | data.id present | DB read baseline |
| 4 | GET /api/v1/companies/2330/kbar?freq=1d | state==LIVE AND rows>0 AND date>=today-2 | **DIRECT — kbar ETL frozen at 2026-04-29** |
| 5 | GET /api/v1/companies/2330/ohlcv | no entry has source==mock | **DIRECT — OHLCV_SOURCE=mock env violation** |
| 6 | GET /api/v1/diagnostics/finmind | requestCount>0 AND ohlcvSource!=mock | **DIRECT — requestCount=0 = ETL never called FinMind** |
| 7 | GET /api/v1/data-sources/finmind/status | state==LIVE_READY | token present indicator |
| 8 | GET /api/v1/briefs | data[0].date >= today-2 | **DIRECT — last brief 2026-04-25 (10d stale)** |
| 9 | GET /api/v1/openalice/observability | workerStatus==healthy AND NOT (queuedJobs==0 AND terminalJobs>100) | **DIRECT — dispatcher dead heuristic** |
| 10 | GET /api/v1/paper/fills | HTTP 200 | paper sprint gate |
| 11 | GET /api/v1/paper/portfolio | HTTP 200 | paper sprint gate |
| 12 | GET /api/v1/paper/orders | HTTP 200 | paper sprint gate |

---

## 14 Stop-Lines

| SL | Pattern | Trigger |
|---|---|---|
| SL-01 | `broker_token` in any 200 body | Security: KGI credential leak |
| SL-02 | `api_key` in any 200 body | Security: API credential leak |
| SL-03 | `kgi_session` in any 200 body | Security: session token leak |
| SL-04 | `Railway` in any 200 body | Security: env var / infra info leak |
| SL-05 | `password` in any 200 body | Security: password leak |
| SL-06 | `secret` in any 200 body | Security: secret leak |
| SL-07 | `source==mock` in prod | Data integrity: mock pretending live |
| SL-08 | POST /order/create returns 200 | KGI FROZEN gate: must be 409 NOT_ENABLED |
| SL-09/10 | Cookie value printed to stdout | Enforced by script design — value NEVER printed, only length |
| SL-11 | kbar state!=LIVE | ETL not in live mode |
| SL-12 | kbar rows.length==0 | ETL not writing rows |
| SL-13 | kbar date stale >2 days | ETL frozen / cache not refreshed |
| SL-14 | briefs date stale >2 days | OpenAlice scheduler dead |

---

## Acceptance Criteria

| State | Expected result |
|---|---|
| **Baseline (pre-fix, K-line incident active)** | FAIL — items 4/5/6/8/9 FAIL minimum; stop-lines SL-07/SL-11/SL-12/SL-13/SL-14 triggered |
| **Post-fix (Jason F1-F4 deployed)** | 12/12 PASS, 0 stop-lines triggered |

Required fixes from kline_incident_root_cause_2026-05-05.md:
- F1 Jason: Set Railway env `OHLCV_SOURCE=finmind`
- F2 Jason: Restart kbar ETL cron (frozen since 4/29)
- F3 Jason: Restart OpenAlice daily_brief dispatcher (frozen since 4/25)
- F4 Jason: Wire `recordFinMindRequest()` into `finmind-client.ts`

---

## Run History

(populated on first execution)

---

## Design Notes

### Why items 4/5/6/8/9 are ETL-freshness checks, not just HTTP 200

The K-line incident (2026-05-05) showed that `/health` and `/openalice/observability` both return 200/healthy
while the entire data pipeline was dead for 6-10 days. Previous smoke (Bash dead) never reached these
endpoints authenticated. This harness is designed to fail-loudly on ETL death, not just process death.

### Dispatcher-dead heuristic (item-9)

`queuedJobs==0 AND terminalJobs>100` is the exact pattern seen in the K-line incident:
- workerStatus=healthy (heartbeat alive)
- queuedJobs=0 (no new work dispatched)
- terminalJobs=531 (all historical from 4/22-4/25 P0E test era)

Heartbeat measures process liveness. Queue depth measures scheduler health. Both needed.

### Cookie handling

Uses `Microsoft.PowerShell.Commands.WebRequestSession` with `-WebSession` parameter.
Cookie value is NEVER printed (SL-09/10). Only `$cookie.Value.Length` is logged.

### Watch mode use case

Run `.\scripts\verify\Invoke-ProductionSmoke.ps1 -Watch` while Jason deploys F1-F4.
The moment kbar ETL comes back online, item-4 flips from FAIL to PASS in real time.
All results append to the same run evidence file.
