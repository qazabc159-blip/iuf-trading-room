# Operator Retest Runbook — PR #13 (`/order/create` 409 short-circuit)

**Trigger**: 楊董 明示「operator window ready for PR13 retest」
**Owner during run**: 楊董 (operator)
**Scope**: live verification that `main` HEAD `f9d3b46` enforces `/order/create` 409 NOT_ENABLED_IN_W1 across all payload shapes, with the rest of the read-side surface unchanged.

---

## Pre-flight (one-time per session)

1. Open PowerShell on Windows operator host.
2. Confirm working tree on `main`:
   ```powershell
   cd C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP
   git fetch origin main
   git checkout main
   git pull --ff-only origin main
   git log -1 --oneline   # Expect: f9d3b46 feat(w5b-a3-a4): /order/create 422->409 short-circuit ...
   ```
3. Start the gateway with stdout teed:
   ```powershell
   $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
   $logPath = "evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29/gateway_pr13_retest_$stamp.log"
   python services/kgi-gateway/app.py 2>&1 | Tee-Object -FilePath $logPath
   ```
   Wait until you see `Uvicorn running on http://0.0.0.0:8787` (or the configured port).

> **STOP-LINE**: do NOT proceed with the test calls until `/health` returns 200 AND a single W1.5 endpoint (e.g. `/quote/snapshot/2330`) returns 200 with non-stale data. A `/health`-only confirmation has been ruled insufficient (see `feedback_gateway_preflight_must_probe_w1_5.md`).

---

## Test Calls (5 payloads, all expect 409)

Run each in a SECOND PowerShell window. Save responses for evidence.

```powershell
$base = "http://127.0.0.1:8787"
$out  = "evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29"

# T1 — empty body
curl.exe -s -o "$out/pr13_T1_empty.json"   -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json" -d "{}"

# T2 — null body (no payload)
curl.exe -s -o "$out/pr13_T2_null.json"    -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json"

# T3 — valid-shape body (full create-order schema)
curl.exe -s -o "$out/pr13_T3_valid.json"   -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json" -d '{"symbol":"2330","side":"buy","qty":1,"price":600,"order_type":"limit"}'

# T4 — partial body (missing fields)
curl.exe -s -o "$out/pr13_T4_partial.json" -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json" -d '{"symbol":"2330"}'

# T5 — over-large body (> 1MB)
$big = '{"junk":"' + ('x' * 1100000) + '"}'
$big | Out-File -Encoding ascii "$out/pr13_T5_big.json.req"
curl.exe -s -o "$out/pr13_T5_big.json"     -w "%{http_code}`n" -X POST "$base/order/create" -H "Content-Type: application/json" --data-binary "@$out/pr13_T5_big.json.req"
```

### Expected results (every case)

- HTTP status: **409**
- Body shape (Pydantic ErrorEnvelope):
  ```json
  { "error": { "code": "NOT_ENABLED_IN_W1", "message": "..." } }
  ```
- Latency: < 200ms (no gateway → SDK call should occur)

---

## Sanity sweep (read-side unchanged)

```powershell
curl.exe -s -o "$out/pr13_health.json"   -w "%{http_code}`n" "$base/health"            # expect 200
curl.exe -s -o "$out/pr13_snap2330.json" -w "%{http_code}`n" "$base/quote/snapshot/2330" # expect 200, non-stale
curl.exe -s -o "$out/pr13_kbar2330.json" -w "%{http_code}`n" "$base/quote/kbar/2330?interval=1m&count=10" # expect 200
curl.exe -s -o "$out/pr13_status.json"   -w "%{http_code}`n" "$base/quote/status"      # expect 200
curl.exe -s -o "$out/pr13_position.json" -w "%{http_code}`n" "$base/position"          # expect 503 (Candidate F circuit breaker still active when POSITION_DISABLED=1)
```

---

## Acceptance Criteria

ALL of:
- T1–T5 → 409 NOT_ENABLED_IN_W1, body matches envelope
- `/health` → 200
- `/quote/snapshot/2330` → 200 with `freshness != STALE`
- `/quote/kbar/2330` → 200, `count=10` k-bars
- `/quote/status` → 200
- `/position` → 503 (POSITION_DISABLED active) OR 200 if 楊董 has explicitly cleared the env flag (rare)
- Gateway log shows no `Traceback` / no native crash / no `api.Order.create_order(` call

If any T1–T5 returns 200 / 422 / 500: **STOP**, capture the response body, and surface to Elva immediately. Do NOT retry; do NOT change env vars. The route handler must short-circuit BEFORE Pydantic validation.

---

## Tear-down

```powershell
# Ctrl-C the gateway window, then:
git status   # expect: only the .json/.log evidence files newly added
```

Add the evidence files to git (no commit — Elva will batch them into the W5c closeout):
```powershell
git add evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29/pr13_*.json
git add evidence/path_b_w3_read_only_2026-04-27/operator_window_2026-04-29/gateway_pr13_retest_*.log
```

---

## Time budget

- Gateway start + preflight: ~3 min
- 5 test calls + 5 sanity calls: ~2 min
- Tear-down + evidence stage: ~1 min
- **Total**: ~6 min operator-window time
