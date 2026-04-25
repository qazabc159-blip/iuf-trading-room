# admin_install_service.ps1 — ADMIN-ONLY NSSM service install/start
# Prereq: prep_openalice.ps1 ran successfully in a non-admin shell.
# Surface here is minimal: tear down existing service, install fresh, start,
# health peek. No network calls other than (none).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File admin_install_service.ps1
#
# Idempotent: safe to re-run.

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

# --- Config (must match prep_openalice.ps1) ---
$SVC              = "openalice-runner"
$ROOT             = "C:\iuf\openalice-runner"
$SECRETS          = "C:\iuf\secrets"
$NSSM_EXE         = "C:\iuf\nssm\nssm.exe"
$LOG              = "$ROOT\logs"
$PY               = "$ROOT\.venv\Scripts\python.exe"
$APP              = "$ROOT\openalice_runner.py"
$API              = "https://api.eycvector.com"
$DEVICE_ID        = "oa-win-mvp-01"
$DEVICE_CREDS     = "$SECRETS\openalice_runner_creds.env"
$LLM_ENV_TARGET   = "$SECRETS\openalice_llm.env"

Write-Host ""
Write-Host "=== OpenAlice Runner — admin install ===" -ForegroundColor Cyan

# --- Sanity: prep must have run ---
foreach ($p in @($PY, $APP, $NSSM_EXE, $DEVICE_CREDS, $LLM_ENV_TARGET)) {
    if (-not (Test-Path $p)) { throw "Missing prereq: $p — run prep_openalice.ps1 first." }
}

# --- Tear down any existing service (idempotent) ---
$existing = Get-Service -Name $SVC -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[nssm] existing $SVC found — stop + remove" -ForegroundColor Yellow
    & $NSSM_EXE stop $SVC confirm 2>&1 | Out-Null
    & $NSSM_EXE remove $SVC confirm 2>&1 | Out-Null
}

# --- Determine LLM backend: openai if key present AND kill-switch off, else rule-template ---
$envLines = Get-Content $LLM_ENV_TARGET |
    Where-Object { $_ -match '^\s*[A-Z_]+=.+' } |
    Where-Object { $_ -notmatch '^\s*#' }

$hasKey    = $envLines | Where-Object { $_ -match '^\s*OPENAI_API_KEY=\S+' }
$killLine  = $envLines | Where-Object { $_ -match '^\s*OPENALICE_LLM_DISABLED=(1|true|yes)\s*$' }
$backend   = if ($hasKey -and -not $killLine) { "openai" } else { "rule-template" }
Write-Host "[cfg ] chosen --llm $backend (hasKey=$([bool]$hasKey) killSwitch=$([bool]$killLine))" -ForegroundColor DarkGray

# --- Install + configure ---
& $NSSM_EXE install $SVC $PY $APP run `
    --api $API `
    --device-id $DEVICE_ID `
    --creds $DEVICE_CREDS `
    --llm $backend `
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

# Inject env. NSSM accepts AppEnvironmentExtra as multiple "KEY=VALUE" args.
# Earlier `($envLines -join "`0")` passed a single string with embedded null
# bytes through PowerShell's `&` operator, which truncates at the first null
# at the cmdline boundary — the result was only the FIRST var being injected.
# Fix: splat each env line as a separate argument.
if ($envLines.Count -gt 0) {
    $nssmArgs = @("set", $SVC, "AppEnvironmentExtra") + $envLines
    & $NSSM_EXE @nssmArgs | Out-Null
    Write-Host "[nssm] injected $($envLines.Count) env vars from $LLM_ENV_TARGET (splat-args)" -ForegroundColor DarkGray
    # Verify injection landed correctly (defense-in-depth — earlier null-byte bug
    # silently dropped vars; without this check the service runs partially-configured).
    $verifyRaw = & $NSSM_EXE get $SVC AppEnvironmentExtra
    $verifyStr = if ($verifyRaw) { [string]::Join("`n", $verifyRaw) } else { "" }
    $injectedCount = ([regex]::Matches($verifyStr, "(?m)^[A-Z_][A-Z0-9_]*=")).Count
    if ($injectedCount -lt $envLines.Count) {
        Write-Host "[nssm] WARN — verify saw $injectedCount/$($envLines.Count) env vars; service may run with missing config" -ForegroundColor Yellow
    } else {
        Write-Host "[nssm] verify ok — $injectedCount env vars present in service environment" -ForegroundColor DarkGray
    }
} else {
    & $NSSM_EXE set $SVC AppEnvironmentExtra "PYTHONUNBUFFERED=1" | Out-Null
}

# --- Start + health peek ---
& $NSSM_EXE start $SVC | Out-Null
Start-Sleep -Seconds 5
$state = (Get-Service $SVC).Status
Write-Host ""
Write-Host "[status] $SVC = $state" -ForegroundColor Cyan
Write-Host "[logs  ] stdout  = $LOG\stdout.log" -ForegroundColor Gray
Write-Host "[logs  ] stderr  = $LOG\stderr.log" -ForegroundColor Gray

if (Test-Path "$LOG\stdout.log") {
    Write-Host ""
    Write-Host "--- first stdout lines ---" -ForegroundColor DarkGray
    Get-Content "$LOG\stdout.log" -Tail 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "=== NEXT ===" -ForegroundColor Cyan
Write-Host "A. Watch: Get-Content -Wait -Tail 20 `"$LOG\stdout.log`"" -ForegroundColor White
Write-Host "B. Flip to auto-start on boot after 2 min healthy window:" -ForegroundColor White
Write-Host "   & `"$NSSM_EXE`" set $SVC Start SERVICE_AUTO_START" -ForegroundColor Gray
Write-Host ""
Write-Host "ROLLBACK: & `"$NSSM_EXE`" stop $SVC ; & `"$NSSM_EXE`" remove $SVC confirm" -ForegroundColor DarkYellow
Write-Host ""
