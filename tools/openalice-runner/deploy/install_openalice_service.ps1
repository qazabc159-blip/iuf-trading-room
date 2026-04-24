# install_openalice_service.ps1 — one-shot NSSM install for openalice-runner
# Phase 1: daemonize runner with --llm rule-template (zero LLM cost).
# Phase 2 (later, after Elva ships Anthropic adapter): switch_to_anthropic.ps1
#
# Requires: admin PowerShell. Run once.
# Idempotent: safe to re-run — stops+removes existing service, re-registers device only if creds missing.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

# --- Config (edit only if paths differ) ---
$SVC          = "openalice-runner"
$ROOT         = "C:\iuf\openalice-runner"
$SECRETS      = "C:\iuf\secrets"
$NSSM_DIR     = "C:\iuf\nssm"
$NSSM_EXE     = "$NSSM_DIR\nssm.exe"
$LOG          = "$ROOT\logs"
$VENV         = "$ROOT\.venv"
$PY           = "$VENV\Scripts\python.exe"
$APP          = "$ROOT\openalice_runner.py"

$API          = "https://api.eycvector.com"
$DEVICE_ID    = "oa-win-mvp-01"
$DEVICE_NAME  = "OA Win MVP 01"
$WORKSPACE    = "primary-desk"
$OWNER_CREDS  = "C:\tmp\iuf_owner_creds.env"
$DEVICE_CREDS = "$SECRETS\openalice_runner_creds.env"
$LLM_ENV_TARGET = "$SECRETS\openalice_llm.env"

$REPO_RUNNER  = "C:\Users\User\Desktop\小楊機密\交易\IUF_TRADING_ROOM_APP\tools\openalice-runner"
$LLM_ENV_TEMPLATE = "$REPO_RUNNER\deploy\openalice_llm.env.template"

$PY_SYSTEM    = "C:\Users\User\AppData\Local\Programs\Python\Python311\python.exe"

Write-Host ""
Write-Host "=== OpenAlice Runner — NSSM install (P0.6 Phase 1, rule-template) ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. Pre-checks ---
if (-not (Test-Path $OWNER_CREDS))   { throw "Owner creds missing: $OWNER_CREDS" }
if (-not (Test-Path $PY_SYSTEM))     { throw "Python 3.11 missing: $PY_SYSTEM" }
if (-not (Test-Path $REPO_RUNNER))   { throw "Repo runner missing: $REPO_RUNNER" }
if (-not (Test-Path $LLM_ENV_TEMPLATE)) { throw "Env template missing: $LLM_ENV_TEMPLATE" }

# --- 2. Layout ---
New-Item -ItemType Directory -Force -Path $ROOT, $SECRETS, $NSSM_DIR, $LOG | Out-Null
Write-Host "[fs] ensured $ROOT / $SECRETS / $NSSM_DIR / $LOG" -ForegroundColor DarkGray

# --- 3. Copy runner source (pinned; not symlinked — avoids git checkout swapping prod) ---
Copy-Item -Force "$REPO_RUNNER\openalice_runner.py" "$ROOT\"
Copy-Item -Force "$REPO_RUNNER\requirements.txt"    "$ROOT\"
Write-Host "[src] copied runner source into $ROOT" -ForegroundColor DarkGray

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
    Write-Host "[register] calling /api/v1/openalice/register ..." -ForegroundColor Yellow
    & $PY $APP register `
        --api $API `
        --device-id $DEVICE_ID `
        --device-name $DEVICE_NAME `
        --workspace $WORKSPACE `
        --capabilities theme_summary company_note `
        --owner-creds $OWNER_CREDS `
        --out-creds $DEVICE_CREDS
    if ($LASTEXITCODE -ne 0) { throw "register failed (exit=$LASTEXITCODE)" }
    Write-Host "[register] device token written to $DEVICE_CREDS" -ForegroundColor Green
} else {
    Write-Host "[register] existing creds at $DEVICE_CREDS — skip" -ForegroundColor DarkGray
}

# --- 6. LLM env file (template on first install, preserve user edits after) ---
if (-not (Test-Path $LLM_ENV_TARGET)) {
    Copy-Item -Force $LLM_ENV_TEMPLATE $LLM_ENV_TARGET
    Write-Host "[env] wrote LLM env template to $LLM_ENV_TARGET (empty values)" -ForegroundColor Yellow
} else {
    Write-Host "[env] $LLM_ENV_TARGET already exists — preserve user edits" -ForegroundColor DarkGray
}

# --- 7. Lock secret files (owner + SYSTEM read only, break inheritance) ---
foreach ($f in @($DEVICE_CREDS, $LLM_ENV_TARGET)) {
    if (Test-Path $f) {
        icacls $f /inheritance:r | Out-Null
        icacls $f /grant:r "${env:USERNAME}:(R,W)" | Out-Null
        icacls $f /grant:r "SYSTEM:(R)" | Out-Null
        Write-Host "[acl] locked $f" -ForegroundColor DarkGray
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
    Write-Host "[nssm] installed at $NSSM_EXE" -ForegroundColor Green
}

# --- 9. Tear down any existing service (idempotent) ---
$existing = Get-Service -Name $SVC -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[nssm] existing $SVC found — stop + remove" -ForegroundColor Yellow
    & $NSSM_EXE stop $SVC confirm 2>&1 | Out-Null
    & $NSSM_EXE remove $SVC confirm 2>&1 | Out-Null
}

# --- 10. Install + configure (Phase 1: rule-template backend, 5 jobs max) ---
& $NSSM_EXE install $SVC $PY $APP run `
    --api $API `
    --device-id $DEVICE_ID `
    --creds $DEVICE_CREDS `
    --llm rule-template `
    --poll-seconds 10 `
    --max-jobs 5 | Out-Null

& $NSSM_EXE set $SVC AppDirectory      $ROOT              | Out-Null
& $NSSM_EXE set $SVC AppStdout         "$LOG\stdout.log"  | Out-Null
& $NSSM_EXE set $SVC AppStderr         "$LOG\stderr.log"  | Out-Null
& $NSSM_EXE set $SVC AppRotateFiles    1                  | Out-Null
& $NSSM_EXE set $SVC AppRotateOnline   1                  | Out-Null
& $NSSM_EXE set $SVC AppRotateBytes    10485760           | Out-Null
& $NSSM_EXE set $SVC AppRotateSeconds  0                  | Out-Null
& $NSSM_EXE set $SVC AppExit Default   Restart            | Out-Null
& $NSSM_EXE set $SVC AppRestartDelay   5000               | Out-Null
& $NSSM_EXE set $SVC AppThrottle       10000              | Out-Null
& $NSSM_EXE set $SVC Start             SERVICE_DEMAND_START | Out-Null
& $NSSM_EXE set $SVC Description       "IUF OpenAlice Runner — content-only draft producer (P0.6)" | Out-Null

# Env from LLM env file, null-separated (NSSM AppEnvironmentExtra convention)
$envLines = Get-Content $LLM_ENV_TARGET |
    Where-Object { $_ -match '^\s*[A-Z_]+=.+' } |
    Where-Object { $_ -notmatch '^\s*#' }
if ($envLines.Count -gt 0) {
    $flat = ($envLines -join "`0")
    & $NSSM_EXE set $SVC AppEnvironmentExtra $flat | Out-Null
    Write-Host "[nssm] injected $($envLines.Count) env vars from $LLM_ENV_TARGET" -ForegroundColor DarkGray
} else {
    & $NSSM_EXE set $SVC AppEnvironmentExtra "PYTHONUNBUFFERED=1" | Out-Null
}

# --- 11. Start + health peek ---
& $NSSM_EXE start $SVC | Out-Null
Start-Sleep -Seconds 5
$state = (Get-Service $SVC).Status
Write-Host ""
Write-Host "[status] $SVC = $state" -ForegroundColor Cyan
Write-Host "[logs  ] stdout  = $LOG\stdout.log" -ForegroundColor Gray
Write-Host "[logs  ] stderr  = $LOG\stderr.log" -ForegroundColor Gray

# Tail first few lines of stdout for immediate sanity
if (Test-Path "$LOG\stdout.log") {
    Write-Host ""
    Write-Host "--- first stdout lines ---" -ForegroundColor DarkGray
    Get-Content "$LOG\stdout.log" -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "=== NEXT STEPS ===" -ForegroundColor Cyan
Write-Host "A. Watch stdout for 2 min: Get-Content -Wait -Tail 20 `"$LOG\stdout.log`"" -ForegroundColor White
Write-Host "   You should see: [runner] polling ... (every 10s) and claim/submit cycles." -ForegroundColor Gray
Write-Host ""
Write-Host "B. If healthy, flip to auto-start on boot:" -ForegroundColor White
Write-Host "   & `"$NSSM_EXE`" set $SVC Start SERVICE_AUTO_START" -ForegroundColor Gray
Write-Host ""
Write-Host "C. Wait for Elva to ship Anthropic adapter (separate handoff) before filling ANTHROPIC_API_KEY." -ForegroundColor White
Write-Host ""
Write-Host "=== ROLLBACK (if something goes wrong) ===" -ForegroundColor DarkYellow
Write-Host "   & `"$NSSM_EXE`" stop $SVC ; & `"$NSSM_EXE`" remove $SVC confirm" -ForegroundColor Gray
Write-Host ""
