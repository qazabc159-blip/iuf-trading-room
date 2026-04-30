# Jason PR-H3: Market Agent Windows Service Skeleton Evidence
**Branch**: `jason/market-agent-skeleton-2026-04-30`
**Date**: 2026-04-30
**Status**: DRAFT — NO KGI SDK wired — skeleton only

## Files Changed
- `services/market-agent/src/agent/__init__.py` (NEW)
- `services/market-agent/src/agent/main.py` (NEW) — FastAPI app with /health + /source/status
- `services/market-agent/src/agent/ingest_pusher.py` (NEW) — HMAC sign + retry + queue
- `services/market-agent/src/agent/heartbeat.py` (NEW) — 30s heartbeat loop
- `services/market-agent/src/agent/redis_snapshot.py` (NEW) — Redis read path
- `services/market-agent/src/agent/source_status.py` (NEW) — per-symbol timestamp tracking
- `services/market-agent/tests/test_main.py` (NEW) — 3 tests
- `services/market-agent/tests/test_ingest_pusher.py` (NEW) — 3 tests
- `services/market-agent/pyproject.toml` (MODIFIED) — added fastapi/uvicorn/redis deps

## Test Count
6 tests total (T1-T6):
- T1: /health returns 200 with correct shape
- T2: kgi_logged_in is always false (skeleton constraint)
- T3: /source/status returns 200 with symbols list
- T4: HMAC sig matches canonical TypeScript format
- T5: Retry on 5xx (3 calls to succeed)
- T6: Queue depth enqueue/drain

## Stop-line Check
| Line | Status |
|---|---|
| No KGI SDK import | PASS — skeleton only, TODO(libCGCrypt) markers |
| MARKET_AGENT_HMAC_SECRET never logged | PASS |
| No /order/create | PASS |
| No kill-switch toggle | PASS |
| kgi_logged_in = false | PASS |
| Cloud ingest route already exists at /internal/market/ingest | PASS (W7 L1 D1) |

## Architecture
```
services/market-agent/src/agent/
  main.py           — FastAPI: /health, /source/status
  ingest_pusher.py  — HMAC sign, in-memory queue(10k), retry, drain
  heartbeat.py      — 30s POST to /internal/market/heartbeat
  redis_snapshot.py — Redis read: quote/bidask/kbar snapshots
  source_status.py  — per-symbol last event timestamps

Cloud side (already in apps/api/src/):
  market-ingest.ts    — HMAC verify, seq tracker, Redis write
  server.ts           — POST /internal/market/ingest (W7 L1 D1)
```

## Next Step for KGI Wire (W7 D5+)
1. EC2 Windows smoke test PASS (U1: SDK on Server 2022, U2: KGI single-host license)
2. Install kgisuperpy>=2.0.3 on EC2
3. Wire real KGI callbacks in main.py _mock_* functions (see TODO(libCGCrypt) markers)
4. Run ingest pusher against real cloud API
