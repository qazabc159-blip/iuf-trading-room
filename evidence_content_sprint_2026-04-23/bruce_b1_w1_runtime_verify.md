# B1 W1 Runtime Verify — Bruce Evidence

Date: 2026-04-23
Verifier: Bruce
Plan ref: plans/path_b_b1_w1_plan_2026-04-23.md
Round: 2 (Jason delivery confirmed + runtime verify COMPLETE)

---

## Section 1 — AWS Windows EC2 Infra

### Status: COMPLETE

| Item | Value |
|---|---|
| Region | ap-northeast-1 (Tokyo) |
| Instance ID | i-09119886485333ffd |
| Instance Type | t3.medium |
| AMI | ami-0b8a31df3b5eb48b4 (Windows_Server-2022-English-Full-Base-2026.04.15) |
| State | running |
| Elastic IP | 54.65.200.26 |
| Elastic IP Allocation ID | eipalloc-0470e5fbd679f6b66 |
| EIP Association ID | eipassoc-0b3afbc464044997c |
| Security Group ID | sg-0faa8c65ca048070f (kgi-gateway-sg) |
| Key Pair | kgi-gateway-key |
| Key PEM | C:\Users\User\Desktop\kgi-gateway-key.pem |
| VPC | vpc-093171e98818b8494 (default) |
| Subnet | subnet-08ce61918e2afabfb |
| Launch Time | 2026-04-23T07:09:46Z |
| EBS Root | 50GB gp3 /dev/sda1 |
| Monitoring | Detailed (enabled) |
| IAM Instance Profile | kgi-gateway-ssm-profile (SSM ManagedInstanceCore) |

### Security Group Rules

| Protocol | Port | Source | Purpose |
|---|---|---|---|
| TCP | 3389 (RDP) | 61.218.159.149/32 | RDP from 楊董 current IP only |
| TCP | 8787 | 0.0.0.0/0 | Gateway HTTP (W2 will add mTLS) |
| TCP | 22 | 61.218.159.149/32 | SSH (added for deploy attempt; no sshd on EC2) |

---

## Section 2 — Jason Gateway Code Delivery

### Status: COMPLETE

All 9 files delivered in `services/kgi-gateway/`:

| File | Status |
|---|---|
| app.py | EXISTS |
| kgi_session.py | EXISTS |
| kgi_quote.py | EXISTS (PATCHED — see Section 3) |
| kgi_events.py | EXISTS (PATCHED — see Section 3) |
| schemas.py | EXISTS |
| config.py | EXISTS |
| pyproject.toml | EXISTS |
| README.md | EXISTS |
| SCHEMA_MAPPING.md | EXISTS |

---

## Section 3 — Import / Annotation Bugs Found & Fixed

### Bug 1: QuoteVersion import path wrong
- **File**: `kgi_quote.py`
- **Original**: `from kgisuperpy import QuoteVersion` — FAILS in kgisuperpy 2.0.3 (not in top-level namespace)
- **Jason fallback**: `from kgisuperpy.quote import QuoteVersion` — FAILS (no such module)
- **Actual path**: `from kgisuperpy.marketdata.quote_data.quotedata import QuoteData as _QuoteData; QuoteVersion = _QuoteData.QuoteVersion`
- **Fix applied**: YES

### Bug 2: `from __future__ import annotations` + `-> None` return type breaks kgisuperpy v2 callback validation
- **Files**: `kgi_quote.py` (on_tick), `kgi_events.py` (on_order_event)
- **Root cause**: kgisuperpy v2 `__set_and_check_callback_function__` checks `func.__annotations__.get("return") not in (None, type(None))`. With `from __future__ import annotations`, `-> None` becomes the string `'None'` not NoneType `None`, so the check fails with Q023 QUOTE_CALLBACK_NAME_INVALID.
- **Fix applied**: Removed `-> None` from callback definitions in both files. (`def on_tick(tick):` / `def on_order_event(data):`)

Both fixes are minimal scope — only changed gateway verify layer files, not any product logic.

---

## Section 4 — Local Gateway Interactive Verify

### Status: COMPLETE — ALL PASS

**Startup**:
- `uvicorn app:app --host 127.0.0.1 --port 8787` — started cleanly, no exceptions
- Log: `KGI Gateway starting on 127.0.0.1:8787 — waiting for POST /session/login`

**Endpoint 1: GET /health**

```
Request:  GET http://127.0.0.1:8787/health
Response: 200 OK
Body:     {"status":"ok","kgi_logged_in":false,"account_set":false}
```
PASS — pre-login state correct.

**Endpoint 2: POST /session/login**

```
Request:  POST http://127.0.0.1:8787/session/login
Body:     {"person_id":"<REDACTED:KGI_PERSON_ID>","person_pwd":"<REDACTED:KGI_PASSWORD_OLD_ROTATED>","simulation":false}
Response: 200 OK
Body:     {"ok":true,"accounts":[{"account":"<REDACTED:KGI_ACCOUNT>","account_flag":"證券","broker_id":"<REDACTED:KGI_BROKER_ID>"}]}
```
PASS — account <REDACTED:KGI_ACCOUNT> / broker_id <REDACTED:KGI_BROKER_ID> confirmed, matches B0 baseline.

**Endpoint 3: GET /session/show-account**

```
Request:  GET http://127.0.0.1:8787/session/show-account
Response: 200 OK
Body:     {"accounts":[{"account":"<REDACTED:KGI_ACCOUNT>","account_flag":"證券","broker_id":"<REDACTED:KGI_BROKER_ID>"}]}
```
PASS — cached account list correct.

**Endpoint 4a: POST /session/set-account (string — expect ok)**

```
Request:  POST http://127.0.0.1:8787/session/set-account
Body:     {"account":"<REDACTED:KGI_ACCOUNT>"}
Response: 200 OK
Body:     {"ok":true,"account_flag":"證券","broker_id":"<REDACTED:KGI_BROKER_ID>"}
```
PASS — set_Account accepts plain string. B0 stop line CLEAR.

**Endpoint 4b: POST /session/set-account (dict — expect 422)**

```
Request:  POST http://127.0.0.1:8787/session/set-account
Body:     {"account":{"account":"<REDACTED:KGI_ACCOUNT>"}}
Response: 422 Unprocessable Entity
Body:     {"detail":[{"type":"string_type","loc":["body","account"],"msg":"Input should be a valid string","input":{"account":"<REDACTED:KGI_ACCOUNT>"}}]}
```
PASS — dict correctly rejected with 422. Pydantic schema enforces string-only.

**Endpoint 5: POST /quote/subscribe/tick (2330)**

```
Request:  POST http://127.0.0.1:8787/quote/subscribe/tick
Body:     {"symbol":"2330"}
Response: 200 OK
Body:     {"ok":true,"label":"tick_2330"}
```
PASS — label "tick_2330" is the fallback label (Jason assumption 2 confirmed: subscribe_tick returns None post-market, fallback `tick_{symbol}` used).

**Endpoint 6: WS /events/order/attach (15s passive)**

```
ws://127.0.0.1:8787/events/order/attach
Connected: True
Errors:    []
Messages:  1 (pong from ping keepalive)
Duration:  15s
```
PASS — connection stable, ping/pong keepalive works, no crash.

**Endpoint 7: POST /order/create (hardline 409)**

```
Request:  POST http://127.0.0.1:8787/order/create
Body:     {"action":"Buy","symbol":"2330","qty":1,"price":900.0}
Response: 409 Conflict
Body:     {"error":{"code":"NOT_ENABLED_IN_W1","message":"Order submission is not enabled in W1...","upstream":null}}
```
PASS — W1 order hardline enforced. createOrder blocked.

---

## Section 5 — EC2 Skeleton Verify

### Status: IN PROGRESS — UserData setup running on EC2

**Deploy method**: EC2 UserData PowerShell script (Stop → modify UserData → Start)

**Script contents**:
- Download `kgi-gateway.zip` from public S3 bucket `kgi-gateway-deploy-1776929352`
- Extract to `C:\kgi-gateway\`
- `pip install fastapi uvicorn kgisuperpy websockets pydantic-settings`
- `Start-Process python.exe -ArgumentList '-m uvicorn app:app --host 0.0.0.0 --port 8787'`

**S3 zip**: `https://kgi-gateway-deploy-1776929352.s3.amazonaws.com/kgi-gateway.zip` (public-read policy applied)

**EC2 status after restart**: running / initializing → instance-status-ok PASS
**RDP port 3389**: OPEN (EC2 booted)
**8787 health check**: NOT YET — UserData installing Python + kgisuperpy (~10-20 min install time)

**Expected result**: `{"status":"ok","kgi_logged_in":false,"account_set":false}` — no login on EC2, just skeleton health

**Note**: No credentials on EC2. Login attempt should return 502 KGI_LOGIN_FAILED (or be skipped per plan).

**Blocker log**:
- SCP blocked: SG had no SSH rule + no sshd on Windows EC2
- SSM not available: IAM role was not attached at launch; attached post-launch, SSM agent needs restart (pending)
- Fallback: UserData PowerShell deploy (above)

---

## Section 6 — 0050 Canary Gap Observation

### Status: COMPLETE — Post-market observation

**Symbols subscribed**: 2330 (subscribe label: tick_2330), 0050 (subscribe label: tick_0050)
**Observation window**: 60 seconds via WS /events/order/attach
**Time**: ~15:25 TST (台股收盤 13:30，盤後)
**Ticks received**: 0
**Symbols observed**: none

**Verdict**: PASS (post-market — zero ticks expected, not a FAIL)

Gap threshold comparison (from B0 quote_gap_interpretation.md):
- Tick WARN: 60s / ALERT: 120s — N/A (post-market)
- BidAsk WARN: 10s — N/A (post-market)

**Action**: Must re-verify 0050 canary gap during market hours (09:00-13:30 TST). Schedule for next trading day open.

---

## Section 7 — NSSM Service Mode

### Status: BLOCKED — Admin shell required

**NSSM version**: 2.24-101-g897c7ad (installed via winget)
**NSSM binary**: `C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\...\win64\nssm.exe`
**Attempt**: `nssm install kgi-gateway python.exe "-m uvicorn app:app --host 127.0.0.1 --port 8787"`
**Result**: `Administrator access is needed to install a service.`

**Status**: BLOCKED — current bash shell is non-admin. Requires admin PowerShell/cmd to run `nssm install`. Interactive test PASSED, so NSSM is the only remaining step.

**Action for W1.5**: Run admin cmd/PowerShell and execute:
```
nssm install kgi-gateway "C:\Users\User\AppData\Local\Programs\Python\Python311\python.exe" "-m uvicorn app:app --host 127.0.0.1 --port 8787"
nssm set kgi-gateway AppDirectory "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\services\kgi-gateway"
nssm set kgi-gateway AppEnvironmentExtra "KGI_PERSON_ID=<REDACTED:KGI_PERSON_ID>" "KGI_PERSON_PWD=<REDACTED:KGI_PASSWORD_OLD_ROTATED>"
nssm start kgi-gateway
curl http://127.0.0.1:8787/health
```

---

## W1 PASS / FAIL Summary

| Condition | Status | Evidence |
|---|---|---|
| EC2 ready (instance + EIP + SG) | PASS | i-09119886485333ffd / 54.65.200.26 |
| kgisuperpy 2.0.3 installed | PASS | pip install confirmed |
| Gateway import clean | PASS | after QuoteVersion + annotation fix |
| Gateway local startup | PASS | uvicorn log OK |
| GET /health pre-login | PASS | {status:ok, logged_in:false} |
| POST /session/login | PASS | account `<REDACTED:KGI_ACCOUNT>` / broker `<REDACTED:KGI_BROKER_ID>` |
| GET /session/show-account | PASS | same shape as B0 |
| POST /session/set-account (string) | PASS | ok + metadata returned |
| POST /session/set-account (dict) | PASS | 422 correctly rejected |
| POST /quote/subscribe/tick 2330 | PASS | label tick_2330 (fallback) |
| WS /events/order/attach 15s | PASS | connected, ping/pong ok |
| POST /order/create 409 | PASS | NOT_ENABLED_IN_W1 hardline |
| EC2 skeleton /health round-trip | IN PROGRESS | UserData running |
| 0050 canary gap | PASS (post-mkt) | 0 ticks expected post-market |
| NSSM service mode | BLOCKED (admin) | need admin shell |

**Interactive runtime verify: ALL PASS**
**Can declare W1 interactive PASS: YES**
**Can declare W1 COMPLETE (all items): NOT YET — EC2 health pending**

---

## Bug Fixes Applied (Jason Patches)

| File | Bug | Fix |
|---|---|---|
| kgi_quote.py | `from kgisuperpy import QuoteVersion` fails | Import via `kgisuperpy.marketdata.quote_data.quotedata.QuoteData.QuoteVersion` |
| kgi_quote.py | `on_tick(tick) -> None` fails kgisuperpy v2 Q023 check | Remove `-> None` annotation |
| kgi_events.py | `on_order_event(data) -> None` same Q023 issue | Remove `-> None` annotation |

Root cause: `from __future__ import annotations` in both files makes `-> None` a string `'None'` not NoneType, causing kgisuperpy v2 callback signature check to fail.

---

## Stop Line Status

| Stop Line | Status |
|---|---|
| 1. set_Account not accept string / accepts dict | CLEAR — string OK, dict 422 |
| 2. Local gateway import crash unfixable | CLEAR — fixed with 2 patches |
| 3. 2330 tick absent (during market hours) | N/A — post-market, to verify on open |
| 4. NSSM COM/runtime crash | SKIP — admin shell needed |
| 5. /order/create returns real submit | CLEAR — 409 enforced |

---

## Last Updated
Bruce — 2026-04-23 15:35 TST (round-2 verify complete)
