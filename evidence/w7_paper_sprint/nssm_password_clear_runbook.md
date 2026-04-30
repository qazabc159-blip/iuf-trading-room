---
title: NSSM KGI Gateway — Clear OLD Password from Service Command Line
date: 2026-04-30
author: Bruce (verifier-release)
context: A1/A2 credential rotation — old KGI password was rotated 2026-04-30.
         This runbook clears the old password from any existing NSSM service config
         on the operator's Windows Market Agent Host.
security: DO NOT add the new password to this runbook. New password is stored in
          Windows Credential Manager / DPAPI / local KGI_PERSON_PWD env var only.
---

# NSSM KGI Gateway — Clear OLD Password Runbook

## Context

During W1 (2026-04-23), the KGI gateway NSSM service may have been configured with
`AppEnvironmentExtra` containing `KGI_PERSON_PWD=<old-value>`. The old password was
rotated on 2026-04-30 (A1). This runbook shows how to clear that stale value and
reconfigure the service to read the new password from a safe local source.

**Hard rule: The new password NEVER goes into this runbook, into any NSSM command
visible in a terminal log, or into any repo file.**

---

## Step 1 — Check if NSSM service exists

Open an **Administrator** PowerShell or CMD window, then run:

```powershell
nssm status kgi-gateway
```

If the output is `SERVICE_STOPPED`, `SERVICE_RUNNING`, or similar — the service exists.
If you get "The specified service does not exist" — skip to Step 5 (re-create from scratch).

---

## Step 2 — Stop the service if running

```powershell
nssm stop kgi-gateway
```

Wait for confirmation: `kgi-gateway: STOP: The operation completed successfully.`

---

## Step 3 — Remove the old AppEnvironmentExtra (clears old password)

```powershell
nssm remove kgi-gateway confirm
```

This removes the entire service. We will re-create it in Step 4 without the password
in the command line.

---

## Step 4 — Re-create the service with NEW password from Windows Credential Manager

**Option A: Using Windows Credential Manager (recommended)**

Store the new password in Windows Credential Manager via PowerShell:

```powershell
# Store new password — operator types it interactively (never echoed to screen)
$cred = Get-Credential -UserName "KGI_PERSON_ID" -Message "Enter new KGI password"
$cred.Password | ConvertFrom-SecureString | Out-File "$env:LOCALAPPDATA\kgi_pwd.dat"
```

Then configure the gateway startup script to load it:

```powershell
# In your gateway startup .ps1 wrapper:
$pwd_secure = Get-Content "$env:LOCALAPPDATA\kgi_pwd.dat" | ConvertTo-SecureString
$pwd_plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwd_secure))
$env:KGI_PERSON_PWD = $pwd_plain
```

Then install NSSM pointing to the wrapper script (not passing credentials on the command line):

```powershell
nssm install kgi-gateway powershell.exe "-ExecutionPolicy Bypass -File C:\kgi-gateway\start.ps1"
nssm set kgi-gateway AppDirectory "C:\kgi-gateway"
nssm set kgi-gateway AppStdout "C:\kgi-gateway\logs\stdout.log"
nssm set kgi-gateway AppStderr "C:\kgi-gateway\logs\stderr.log"
nssm start kgi-gateway
```

**Option B: Using local environment variable (KGI_PERSON_PWD)**

If Windows Credential Manager is unavailable, set the env var at the system level
(not in NSSM AppEnvironmentExtra, where it appears in `sc qc` output):

1. Open System Properties -> Environment Variables -> System Variables
2. Add `KGI_PERSON_ID` and `KGI_PERSON_PWD` as system env vars
3. Install NSSM WITHOUT those values in AppEnvironmentExtra:

```powershell
nssm install kgi-gateway "C:\Python311\python.exe" "-m uvicorn app:app --host 127.0.0.1 --port 8787"
nssm set kgi-gateway AppDirectory "C:\kgi-gateway"
# Do NOT use: nssm set kgi-gateway AppEnvironmentExtra "KGI_PERSON_PWD=..."
nssm start kgi-gateway
```

The gateway's `config.py` reads `os.environ["KGI_PERSON_PWD"]` at startup — it will
pick up the system env var automatically.

---

## Step 5 — Verify gateway is clean (no credential in NSSM config)

```powershell
nssm get kgi-gateway AppEnvironmentExtra
```

Expected output: empty string or `1 parameter(s) retrieved.` with no password visible.

```powershell
sc qc kgi-gateway
```

Scan the output for `BINARY_PATH_NAME` — it should NOT contain any password literal.

---

## Step 6 — Verify gateway starts with new credentials

```powershell
nssm start kgi-gateway
Start-Sleep -Seconds 5
curl http://127.0.0.1:8787/health
```

Expected: `{"status":"ok","kgi_logged_in":false,"account_set":false}`

Then perform manual login via the operator window:

```powershell
$body = '{"person_id":"YOUR_PERSON_ID","person_pwd":"<new-password-local-only>","simulation":false}'
# Note: new password is entered locally here, never in a repo file or runbook
Invoke-RestMethod -Method POST -Uri http://127.0.0.1:8787/session/login `
  -ContentType application/json -Body $body
```

Expected: `{"ok":true,"accounts":[...]}`

---

## History Exposure Note

The old password appeared in `evidence_content_sprint_2026-04-23/bruce_b1_w1_runtime_verify.md`
line 235 in an NSSM startup command example. That line has been redacted (2026-04-30 A2) to
`<REDACTED:KGI_PASSWORD_OLD_ROTATED>`.

**However**, the original value remains in past git commit history on `origin`. See
`evidence/w7_paper_sprint/history_exposure_note.md` for the exposure assessment and
the rotate-only vs history-rewrite options.

Current recommendation: **rotate-only** (A1 done). History rewrite via BFG/git-filter-repo
is deferred — see the note document for details.

---

## Hard Lines

- New KGI password MUST NOT appear in:
  - Any repo file (committed or untracked)
  - Any NSSM AppEnvironmentExtra parameter visible in `sc qc` output
  - Any CI/CD pipeline config
  - Any chat transcript
- New password MUST be stored in:
  - Windows Credential Manager / DPAPI (preferred)
  - OR local system environment variable (not passed via NSSM command line)
  - OR operator's local `.env.local` file (gitignored)
