# prep_openalice.ps1 — NON-ADMIN preparation for OpenAlice runner NSSM install
# Run this FIRST in a normal (non-elevated) PowerShell. It touches only
# C:\iuf\* and your own files — no SCM (service manager) access, no UAC.
#
# After this passes, run admin_install_service.ps1 in an Administrator shell.
#
# What this does (all reversible, all idempotent):
#   1. Pre-checks (python 3.11 / repo runner / owner creds / env template)
#   2. Layout: C:\iuf\openalice-runner, C:\iuf\secrets, C:\iuf\nssm, logs\
#   3. Copy runner source + requirements.txt + llm\ package + prompts\ into deploy folder
#   4. Create .venv + pip install
#   5. Register device (one-time, writes openalice_runner_creds.env)
#   6. Copy LLM env template to C:\iuf\secrets\openalice_llm.env (preserve existing edits)
#   7. Lock secret files to owner + SYSTEM
#   8. Download NSSM 2.24 to C:\iuf\nssm\
#
# Nothing in here starts or installs a service — that's Step 9+ in the admin script.

$ErrorActionPreference = "Stop"

# --- Config ---
$ROOT             = "C:\iuf\openalice-runner"
$SECRETS          = "C:\iuf\secrets"
$NSSM_DIR         = "C:\iuf\nssm"
$NSSM_EXE         = "$NSSM_DIR\nssm.exe"
$LOG              = "$ROOT\logs"
$VENV             = "$ROOT\.venv"
$PY               = "$VENV\Scripts\python.exe"
$APP              = "$ROOT\openalice_runner.py"

$API              = "https://api.eycvector.com"
$DEVICE_ID        = "oa-win-mvp-01"
$DEVICE_NAME      = "OA Win MVP 01"
$WORKSPACE        = "primary-desk"
$OWNER_CREDS      = "C:\tmp\iuf_owner_creds.env"
$DEVICE_CREDS     = "$SECRETS\openalice_runner_creds.env"
$LLM_ENV_TARGET   = "$SECRETS\openalice_llm.env"

$REPO_RUNNER      = "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\tools\openalice-runner"
$LLM_ENV_TEMPLATE = "$REPO_RUNNER\deploy\openalice_llm.env.template"
$PY_SYSTEM        = "C:\Users\User\AppData\Local\Programs\Python\Python311\python.exe"

Write-Host ""
Write-Host "=== OpenAlice Runner — prep (non-admin) ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. Pre-checks ---
if (-not (Test-Path $OWNER_CREDS))      { throw "Owner creds missing: $OWNER_CREDS" }
if (-not (Test-Path $PY_SYSTEM))        { throw "Python 3.11 missing: $PY_SYSTEM" }
if (-not (Test-Path $REPO_RUNNER))      { throw "Repo runner missing: $REPO_RUNNER" }
if (-not (Test-Path $LLM_ENV_TEMPLATE)) { throw "Env template missing: $LLM_ENV_TEMPLATE" }
Write-Host "[pre] owner creds / python / repo / env template OK" -ForegroundColor DarkGray

# --- 2. Layout ---
New-Item -ItemType Directory -Force -Path $ROOT, $SECRETS, $NSSM_DIR, $LOG | Out-Null
Write-Host "[fs ] ensured $ROOT / $SECRETS / $NSSM_DIR / $LOG" -ForegroundColor DarkGray

# --- 3. Copy runner source + llm package + prompts (pinned, not symlinked) ---
Copy-Item -Force "$REPO_RUNNER\openalice_runner.py" "$ROOT\"
Copy-Item -Force "$REPO_RUNNER\requirements.txt"    "$ROOT\"
New-Item -ItemType Directory -Force -Path "$ROOT\llm", "$ROOT\prompts" | Out-Null
Copy-Item -Force "$REPO_RUNNER\llm\*.py"            "$ROOT\llm\"
Copy-Item -Force "$REPO_RUNNER\prompts\*.md"        "$ROOT\prompts\"
Write-Host "[src] copied runner + llm package + prompts into $ROOT" -ForegroundColor DarkGray

# --- 4. venv + deps ---
if (-not (Test-Path $PY)) {
    Write-Host "[venv] creating $VENV" -ForegroundColor Yellow
    & $PY_SYSTEM -m venv $VENV
}
& $PY -m pip install --upgrade pip --quiet
& $PY -m pip install -r "$ROOT\requirements.txt" --quiet
Write-Host "[venv] deps installed" -ForegroundColor DarkGray

# --- 5. Register device (one-time) ---
if (-not (Test-Path $DEVICE_CREDS)) {
    Write-Host "[reg ] calling /api/v1/openalice/register ..." -ForegroundColor Yellow
    & $PY $APP register `
        --api $API `
        --device-id $DEVICE_ID `
        --device-name $DEVICE_NAME `
        --workspace $WORKSPACE `
        --capabilities theme_summary company_note `
        --owner-creds $OWNER_CREDS `
        --out-creds $DEVICE_CREDS
    if ($LASTEXITCODE -ne 0) { throw "register failed (exit=$LASTEXITCODE)" }
    Write-Host "[reg ] device token written to $DEVICE_CREDS" -ForegroundColor Green
} else {
    Write-Host "[reg ] existing creds at $DEVICE_CREDS — skip" -ForegroundColor DarkGray
}

# --- 6. LLM env file (template first install, preserve user edits) ---
if (-not (Test-Path $LLM_ENV_TARGET)) {
    Copy-Item -Force $LLM_ENV_TEMPLATE $LLM_ENV_TARGET
    Write-Host "[env ] wrote LLM env template to $LLM_ENV_TARGET (empty values — ok for Phase 1)" -ForegroundColor Yellow
} else {
    Write-Host "[env ] $LLM_ENV_TARGET already exists — preserve user edits" -ForegroundColor DarkGray
}

# --- 7. Lock secret files (owner + SYSTEM read only) ---
foreach ($f in @($DEVICE_CREDS, $LLM_ENV_TARGET)) {
    if (Test-Path $f) {
        icacls $f /inheritance:r | Out-Null
        icacls $f /grant:r "${env:USERNAME}:(R,W)" | Out-Null
        icacls $f /grant:r "SYSTEM:(R)" | Out-Null
        Write-Host "[acl ] locked $f" -ForegroundColor DarkGray
    }
}

# --- 8. NSSM binary ---
if (-not (Test-Path $NSSM_EXE)) {
    $ZIP = "$NSSM_DIR\nssm-2.24.zip"
    Write-Host "[nssm] downloading nssm 2.24 ..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $ZIP -UseBasicParsing
    Expand-Archive -Path $ZIP -DestinationPath $NSSM_DIR -Force
    Copy-Item "$NSSM_DIR\nssm-2.24\win64\nssm.exe" $NSSM_EXE
    Remove-Item $ZIP
    Write-Host "[nssm] staged at $NSSM_EXE" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== prep complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: open an **Administrator** PowerShell and run:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$REPO_RUNNER\deploy\admin_install_service.ps1`"" -ForegroundColor White
Write-Host ""
