# BRUCE EC2 KGI GATEWAY DEPLOY READINESS AUDIT
Date: 2026-05-08
Author: Bruce (verifier/release)
Scope: read-only static audit — no EC2 RDP / no gateway start / no production code change

---

## A. EC2 ACCESS STATE

| Item            | Value                                   | Status |
|-----------------|-----------------------------------------|--------|
| Instance ID     | i-0b02f62220f422349                     | running |
| Region          | ap-northeast-1 (Tokyo)                  | OK |
| Type            | t3.large (2 vCPU / 8 GB RAM)            | SUFFICIENT |
| Platform        | Windows Server 2022                     | CONFIRMED |
| Public IP       | 54.249.139.28                           | STATIC (Elastic IP assumed) |
| Key pair        | iuf-market-agent (RSA, created 2026-04-30) | EXISTS |
| Root disk       | vol-0de42188da7a24ef3 gp3 50 GB         | SUFFICIENT |
| RDP port 3389   | OPEN — inbound CIDR 61.218.159.149/32 only | OK (楊董 home IP) |
| SSH port 22     | NOT in inbound rules                    | N/A (Windows; use RDP) |
| Port 8787       | NOT in inbound rules                    | BLOCKED — must add Railway egress CIDRs |
| Outbound        | 0.0.0.0/0 all                           | OK |

DISK NOTE: t3.large (50 GB) accommodates Python 3.11 + kgisuperpy 2.0.3 + all deps (~2 GB).
Estimated free after install: ~43 GB. Sufficient.

---

## B. SOFTWARE DEPENDENCY LIST

### kgisuperpy 2.0.3 (楊董機器已驗通版本)
- Install: `pip install kgisuperpy==2.0.3`
- Python requirement: 3.11 (匹配楊董本機路徑 Python311)
- Runtime deps (from pip show):
  cryptography, dash, diskcache, IPython, kaleido, matplotlib,
  numba, pandas, paramiko, plotly, requests, seaborn, tqdm, websocket-client
- Total estimated install size: ~1.5 GB (numba + scipy chain)

### TradeCom DLL
- Bundle location in kgisuperpy package: `<site-packages>/kgisuperpy/pushClient/`
- Files to verify present after pip install:
  - `tradecom_windows_bridge64.dll` (Windows 64-bit, auto-loaded on import)
  - `PushClient_Win.dll`
  - `pyTradeCom.py`
- Visual C++ Runtime: kgisuperpy DLL chain requires **MSVC 2015-2022 Redistributable (x64)**.
  Win Server 2022 may ship a version; must verify and install if missing.
  Download: https://aka.ms/vs/17/release/vc_redist.x64.exe

### errMsg.ini
- NOT in .gitignore-excluded path in repo; already present in `services/kgi-gateway/errMsg.ini`
- Must be copied to the working directory alongside app.py on EC2.
- Source: copy from repo checkout or scp from 楊董 local after RDP login.
- Path at runtime: `services/kgi-gateway/errMsg.ini` (same dir as app.py).

### Gateway Python deps (services/kgi-gateway)
- fastapi, uvicorn[standard], pydantic — standard pip install
- No requirements.txt currently in services/kgi-gateway (Jason deliverable: add one)

---

## C. NETWORK SECURITY PLAN

### Security Group Changes Required (sg-02f30bdc64bd0105c)
Current: port 3389 open to 61.218.159.149/32 only. Port 8787 CLOSED.

Required inbound rule to add:
```
Protocol: TCP
Port: 8787
Source: Railway static egress IPs
```

Railway static egress IPs (public docs as of 2026-05):
  - 34.90.197.131/32
  - 34.141.29.175/32
  - 34.147.87.4/32
  - 34.76.147.184/32
  (Verify current list at https://docs.railway.app/reference/static-outbound-ips before applying)

RECOMMENDATION: Do NOT open 8787 to 0.0.0.0/0. Railway-IP-only is the minimum viable allow.

### mTLS Status
- `read_only_guard.py` and `config.py` have no mTLS cert loading implemented yet.
- `kgi-gateway-client.ts` has `useMtls` config stub but implementation deferred.
- For read-only EC2 deployment: mTLS can remain deferred; rely on SG IP allowlist + secret header.
- Recommendation: add `X-Gateway-Secret` bearer header check in app.py (Jason scope, 30min).
  Store value in SSM Parameter Store as `KGI_GATEWAY_SECRET`.

---

## D. DAEMON INSTALL SPEC (NSSM)

### NSSM (Non-Sucking Service Manager)
- Download: https://nssm.cc/download (nssm 2.24, stable)
- Install path on EC2: `C:\nssm\nssm.exe`

### Service registration command (run once in Administrator PowerShell after RDP):
```powershell
nssm install kgi-gateway "C:\Python311\python.exe"
nssm set kgi-gateway AppParameters "-m uvicorn app:app --host 0.0.0.0 --port 8787 --no-access-log"
nssm set kgi-gateway AppDirectory "C:\iuf\services\kgi-gateway"
nssm set kgi-gateway AppEnvironmentExtra `
    "KGI_PERSON_ID=[from SSM]" `
    "KGI_PERSON_PWD=[from SSM]" `
    "KGI_READ_ONLY_MODE=true" `
    "GATEWAY_HOST=0.0.0.0" `
    "GATEWAY_PORT=8787" `
    "KGI_GATEWAY_POSITION_DISABLED=true" `
    "KGI_GATEWAY_QUOTE_DISABLED=false"
nssm set kgi-gateway Start SERVICE_AUTO_START
nssm set kgi-gateway AppStdout "C:\iuf\logs\kgi-gateway-out.log"
nssm set kgi-gateway AppStderr "C:\iuf\logs\kgi-gateway-err.log"
nssm set kgi-gateway AppRotateFiles 1
nssm set kgi-gateway AppRotateSeconds 86400
nssm start kgi-gateway
```

HARD LINE: `KGI_READ_ONLY_MODE=true` must be set as env var in service registration.
This ensures read_only_guard.py blocks all mutation endpoints even if app code is not updated.

---

## E. MIGRATION PLAYBOOK (本機 → EC2)

Step-by-step. Estimated total: 90 min first time, 20 min for subsequent redeploys.

```
1. RDP into 54.249.139.28 (楊董 home IP already whitelisted on port 3389)
2. Install Python 3.11 if not present:
   - Download from python.org/ftp/python/3.11.x/python-3.11.x-amd64.exe
   - Install to C:\Python311, check "Add to PATH"
3. Install Visual C++ Redistributable x64 (if not present on Win Server 2022)
4. Clone repo (or robocopy from楊董 machine):
   git clone https://github.com/<org>/iuf-trading-room-app C:\iuf
   cd C:\iuf\services\kgi-gateway
5. Install Python deps:
   pip install kgisuperpy==2.0.3 fastapi "uvicorn[standard]" pydantic
6. Verify DLL loaded:
   python -c "import kgisuperpy; print('DLL OK')"
   (should print: Load[...tradecom_windows_bridge64.dll])
7. Store KGI creds in AWS SSM Parameter Store:
   - /iuf/kgi/person_id (SecureString)
   - /iuf/kgi/person_pwd (SecureString)
   Pull at service start via startup script (NOT hardcoded in nssm env).
8. Set up NSSM service per Section D above
9. Add SG inbound rule: TCP 8787 from Railway IPs (Section C)
10. Smoke test from Railway:
    curl http://54.249.139.28:8787/health → expect {"status":"ok","kgi_logged_in":false,...}
    curl http://54.249.139.28:8787/session/show-account → expect 401 NOT_LOGGED_IN
11. Login via Railway API → POST /session/login (simulation=false, live read-only)
12. Subscribe tick → POST /quote/subscribe/tick {"symbol":"2330"}
13. Poll ticks → GET /quote/ticks?symbol=2330 → confirm live quote flowing
14. Stop 楊董 local gateway (Ctrl+C or stop service)
15. Update Railway env: KGI_GATEWAY_URL=http://54.249.139.28:8787
16. Redeploy Railway API service
```

---

## F. RISK + ROLLBACK MATRIX

| Risk | Guard | Rollback |
|------|-------|----------|
| KGI_READ_ONLY_MODE not set | NSSM env hardcode + smoke test step 10 | Set env, restart NSSM service |
| /order/create live path | Returns 409 unconditionally (W1 hard-line in app.py) | No rollback needed; code never executes order |
| EC2 crash / unreachable | Railway API falls back to error (no auto-reconnect) | Restart 楊董 local gateway; set KGI_GATEWAY_URL back to localhost |
| DLL crash (crash containment) | KGI_GATEWAY_POSITION_DISABLED=true on startup (default) | Already set in NSSM env |
| KGI creds in plaintext | SSM Parameter Store SecureString; NOT in nssm env literal | Rotate via SSM console |
| Port 8787 exposed publicly | SG IP allowlist to Railway egress only | Restrict SG back to 0 CIDRs |
| Log leaks person_id/pwd | app.py + kgi_session.py redact; log class only on exception | Review .runtime/*.log after first login |
| Auto-login on startup | AUTO_LOGIN=false (default) in config.py | Remove env var to revert to safe default |

4-LAYER RISK GATE: PR #296 (187/187 PASS) live on Railway. EC2 gateway is read-side only.
Write path (L1 kill switch / L2 max position / L3 daily loss / L4 concentration) enforced by
Railway API before any /order/create call reaches gateway. EC2 gateway adds KGI_READ_ONLY_MODE
as second layer.

---

## G. ESTIMATED TOTAL DEPLOYMENT TIME + JASON SCOPE

| Phase | Estimate | Owner |
|-------|----------|-------|
| Python + deps install on EC2 | 20 min | 楊董 (RDP) |
| DLL verify + errMsg.ini copy | 5 min | 楊董 (RDP) |
| NSSM service setup | 10 min | 楊董 (RDP) |
| SG rule add (Railway IPs) | 5 min | 楊董 (AWS console) or Bruce |
| SSM creds setup | 10 min | 楊董 (AWS console) |
| Smoke test + login e2e | 15 min | 楊董 + Bruce verify |
| KGI_GATEWAY_URL update in Railway | 5 min | 楊董 / Elva |
| **Total first deploy** | **~70 min** | |

### Jason deliverables before deploy (not blocking smoke, blocking production hand-off):
1. `services/kgi-gateway/requirements.txt` — pin versions for reproducible EC2 install (30 min)
2. `X-Gateway-Secret` header auth in app.py — reject requests missing shared secret (30 min)
3. SSM-pull startup script for NSSM env vars (optional; manual copy acceptable for first deploy)

### Pre-deploy gate checklist (Bruce sign-off required):
- [ ] GET /health → `{"status":"ok","kgi_logged_in":false}` from Railway
- [ ] POST /session/login simulation=false → 200 ok (TradeCom 元件권限 must be enabled first)
- [ ] GET /quote/ticks?symbol=2330 after subscribe → at least 1 tick present
- [ ] POST /order/create {} → 409 NOT_ENABLED_IN_W1 (must still be true on EC2)
- [ ] KGI_READ_ONLY_MODE=true confirmed in /health or diagnostic endpoint

### BLOCKER (must resolve before any of the above):
KGI RtnCode 78 — TradeCom 元件使用権限 not enabled (sim). Live (simulation=false) may work.
楊董 must confirm with KGI 業務員 per session_handoff.md 5/8 action item.

---

RESULT: PARTIAL — EC2 hardware ready, code ready, network gap (port 8787 SG rule missing),
TradeCom 元件権限 unresolved. Deploy can proceed to smoke step immediately after:
(a) SG rule added and (b) KGI 業務員 enables TradeCom permission.
