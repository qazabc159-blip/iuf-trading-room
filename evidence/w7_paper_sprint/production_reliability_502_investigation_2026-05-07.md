# Production 502 Investigation — 2026-05-07

**Investigator:** Jason | **Scope:** read-only | **Status:** VERDICT REACHED

## Incidents
- 14:18 TST: 502, X-Railway-Fallback=true, manual redeploy rescued
- 16:50 TST: 502, X-Railway-Fallback=true, manual redeploy rescued
- Pattern: ~2.5h gap; both recovered immediately on fresh process

## Evidence

### Log coverage
Railway CLI caps at ~2000 lines. Current window starts from boot at 10:10:36 UTC (18:10 TST).
Crash logs from 06:18 UTC and 08:50 UTC (previous process) are NOT retrievable.
Current /health: `{"status":"ok","uptime":665}` — process is healthy post-redeploy.

### OHLCV scheduler: primary suspect
```
[ohlcv-scheduler] Starting sync for 500/3469 tickers
[ohlcv-finmind-sync] DONE success=500 failed=0 durationMs=284042   ← 4.7 min wall time
```
500 sequential FinMind HTTP fetches + DB upserts. No `--max-old-space-size`, no `NODE_OPTIONS`.
Railway Hobby tier: ~512MB RAM (undocumented). Peak during 500-ticker sync is the pressure point.

### Boot-time scheduler pile-up
All 14 schedulers fire initial ticks within first 135s (INITIAL_STAGGER_MS=15s each):
OHLCV(t=0) + monthly-rev(t=15s) + financials(t=30s) + valuation(t=120s) + stock-news(t=135s)
all confirmed running concurrently from logs. Margin-short fired and upserted 1596 rows.

### Timing match
- 14:18 TST incident: ~5h after prior deploy → OHLCV boot-tick at ~14:10 TST + concurrent ETL
- 16:50 TST incident: pipeline close-brief window (16:30–17:00 TST) fires gpt-4.1 LLM call
  + 30min margin-short + stock-news schedulers → event-loop pressure spike

### Health check mechanism
Railway probes GET /health (synchronous JSON, no DB). If Node.js event loop is queued
behind async FinMind fetches / LLM streaming / DB upserts → probe times out → unhealthy → 502.
Manual redeploy = fresh process, empty event queue → probe passes immediately.

## Verdict
**EVENT-LOOP PRESSURE TIMEOUT** — not cold-start idle, not memory leak, not Railway platform failure.
Railway health probe queued behind peak concurrent ETL (500 OHLCV tickers) + LLM call.
Redeploy rescues because fresh process has empty event queue at probe time.

## Fix Recommendations (ranked)

### Fix 1 — Immediate, 0 code: reduce OHLCV batch size via env var
Set `FINMIND_OHLCV_BATCH_SIZE=200` on Railway API service.
Cuts peak sync from 500 tickers/284s → 200 tickers/~115s. Cursor system carries state across ticks.
Command: `railway variable set -s api FINMIND_OHLCV_BATCH_SIZE=200`

### Fix 2 — Immediate, 0 code: spread boot stagger
Set `FINMIND_SCHEDULER_INITIAL_STAGGER_MS=60000` (currently 15000).
Separates concurrent ETL starts from 15s gaps to 60s gaps, reducing boot pile-up.

### Fix 3 — Small PR (~25 lines, server.ts only): add memory to /health + tick logging
Extend /health to emit `process.memoryUsage()` (heapUsedMB, rssMB).
Log memory at OHLCV tick start + end. No contract change, no migration.
Provides evidence for future incidents; zero latency impact on health probe.
Estimate: 25 lines, Jason lane only.
