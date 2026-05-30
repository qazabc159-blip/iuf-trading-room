# Migration Runbook: KGI Gateway — Local → EC2

**Target:** EC2 `i-0b02f62220f422349` / `54.249.139.28` (ap-northeast-1, Win Server 2022)  
**Approved:** 楊董 2026-05-08 (5/12 廢除 + GO Option A)  
**Purpose:** Free 楊董本機; 24/7 gateway daemon; unblock LIVE quote (Product North Star #8)

---

## Prerequisites (before you touch EC2)

| # | Check | Expected |
|---|---|---|
| 1 | KGI business approval | TradeCom 元件權限 enabled (RtnCode ≠ 78) |
| 2 | Security group updated | Port 8787 open from Railway egress IP(s) only — see `security_group.sh` |
| 3 | SSM parameters written | SIM: `/iuf/kgi/sim_person_id` + `/iuf/kgi/sim_person_pwd` stored in AWS SSM. Live mode uses `/iuf/kgi/person_id` + `/iuf/kgi/person_pwd`. |
| 4 | AWS CLI on EC2 | `aws --version` works; instance profile has `ssm:GetParameter` permission |
| 5 | Gateway source available | Either repo clone or ZIP copied to EC2 |

---

## Step 1 — RDP into EC2

```
Host:      54.249.139.28
Port:      3389
User:      Administrator
Password:  [from AWS EC2 console → Get Windows Password, using key pair]
```

Recommended: use `mstsc.exe` or AWS SSM Session Manager (no open RDP port needed if you prefer tunnel).

---

## Step 2 — Copy gateway source to EC2

**Option A — Git clone (preferred if repo is accessible from EC2):**

```powershell
cd C:\
git clone https://github.com/<your-org>/IUF_TRADING_ROOM_APP.git
# Source will be at: C:\IUF_TRADING_ROOM_APP\services\kgi-gateway\
```

**Option B — Copy via RDP clipboard / file transfer:**

1. On local machine, zip `services/kgi-gateway/` (exclude `tests/`, `deploy/`, `__pycache__/`)
2. RDP → paste zip to `C:\kgi-gateway-src.zip`
3. Expand: `Expand-Archive C:\kgi-gateway-src.zip C:\kgi-gateway-src -Force`

---

## Step 3 — Write SSM parameters (once, from local machine or EC2 with IAM access)

```bash
# Run from a machine with AWS CLI + credentials for account 027903151493
aws ssm put-parameter \
  --name "/iuf/kgi/sim_person_id" \
  --value "YOUR_PERSON_ID_UPPERCASE" \
  --type "SecureString" \
  --overwrite \
  --region ap-northeast-1

aws ssm put-parameter \
  --name "/iuf/kgi/sim_person_pwd" \
  --value "YOUR_ELECTRONIC_TRADING_PASSWORD" \
  --type "SecureString" \
  --overwrite \
  --region ap-northeast-1
```

**Important:** `person_pwd` = 電子下單密碼 (NOT 網站登入密碼).  
**Important:** `person_id` MUST be uppercase (known issue — `feedback_kgi_env_var_uppercase_rule.md`).

---

## Step 4 — Run install.ps1 on EC2

Open **PowerShell as Administrator** on EC2:

```powershell
cd C:\IUF_TRADING_ROOM_APP\services\kgi-gateway\deploy   # or wherever you copied deploy/

# Dry-run first (no changes):
.\install.ps1 -DryRun

# Real SIM install (reads /iuf/kgi/sim_person_* from SSM, installs Python, copies files, smoke tests):
.\install.ps1 -UseSSM

# Live-mode override, only when explicitly approved:
# .\install.ps1 -UseSSM -KgiSimulation:$false

# Check evidence:
Get-Content C:\kgi-gateway-logs\install_evidence.json
```

---

## Step 5 — Register NSSM service

```powershell
# Dry-run first:
.\nssm_install.ps1 -DryRun

# Real SIM service install:
.\nssm_install.ps1

# Live-mode override, only when explicitly approved:
# .\nssm_install.ps1 -KgiSimulation:$false

# Verify service state:
Get-Service KGIGateway
# Expected: Status = Running, StartType = Automatic
```

---

## Step 6 — Install watchdog as Scheduled Task

```powershell
# Register watchdog as 1-minute SYSTEM task:
schtasks /create `
  /tn "KGIGatewayWatchdog" `
  /tr "powershell.exe -NonInteractive -WindowStyle Hidden -File C:\kgi-gateway\deploy\watchdog.ps1" `
  /sc MINUTE /mo 1 `
  /ru SYSTEM `
  /f

# Verify:
schtasks /query /tn "KGIGatewayWatchdog" /fo LIST
```

---

## Step 7 — Update IUF API env var + redeploy

After gateway is confirmed healthy on EC2:

1. In Railway dashboard → IUF API service → Variables:
   ```
   KGI_GATEWAY_URL=http://54.249.139.28:8787
   ```
   (Replace any existing `KGI_GATEWAY_URL` pointing to localhost / 楊董本機)

2. Trigger Railway redeploy (or wait for next automatic deploy).

3. Verify prod API:
   ```bash
   curl https://api.eycvector.com/api/v1/quote/realtime?symbol=2330
   # Expected: source=LIVE (not MOCK / UNAVAILABLE)
   ```

---

## Verification Checklist

```
[ ] GET http://54.249.139.28:8787/health                    → 200 ok
[ ] POST /session/login (via IUF API proxy, not direct)     → { ok: true }
[ ] GET /session/show-account                               → accounts list
[ ] GET /quote/ticks?symbol=2330&limit=5                    → ticks array
[ ] GET https://api.eycvector.com/api/v1/quote/realtime?symbol=2330
      → source="LIVE" in response
[ ] Get-Service KGIGateway                                  → Running
[ ] schtasks /query /tn KGIGatewayWatchdog                  → Ready
```

---

## Rollback Path (EC2 fail → 楊董本機 fallback)

If EC2 is unreachable or gateway crashes unrecoverably:

1. Start gateway on 楊董本機:
   ```powershell
   cd C:\path\to\services\kgi-gateway
   python -m uvicorn app:app --host 0.0.0.0 --port 8787
   ```

2. Update Railway env var back to local IP (requires VPN/tunnel or ngrok):
   ```
   KGI_GATEWAY_URL=http://<楊董本機外網IP>:8787
   ```
   Or use ngrok:
   ```bash
   ngrok http 8787
   # Use the https://xxx.ngrok.io URL in KGI_GATEWAY_URL
   ```

3. Railway redeploy.

4. Diagnose EC2 issue:
   - Check `C:\kgi-gateway-logs\gateway.stdout.log` (via RDP or SSM Session Manager)
   - Check `C:\kgi-gateway-logs\watchdog.log`
   - If stuck in restart loop: `nssm set KGIGateway Start SERVICE_DEMAND_START` then debug manually

---

## Security Notes

- Port 8787 is NOT exposed to the public internet — see `security_group.sh` for the restricted inbound rule.
- Credentials are stored in SSM SecureString (KMS-encrypted), not in code or env files.
- `install.ps1` writes to Machine-level registry env; no plaintext credential files are created.
- `KGI_READ_ONLY_MODE=true` is enforced at gateway layer until 楊董 explicitly enables write mode.

---

## Owner / Contact

- Deploy owner: Jason (backend strategy lane)
- Gateway operator: 楊董 (final ack on any credential change or live mode toggle)
- Bruce: post-deploy regression verification
