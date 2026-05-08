<#
.SYNOPSIS
    Dry-run validation suite for all KGI Gateway EC2 deploy scripts.
    No real changes are made.

.NOTES
    Can run on any machine — makes no changes.
    No AWS credentials needed. No KGI credentials needed.
#>

[CmdletBinding()]
param(
    [string]$OutputDir = "C:\kgi-gateway-logs",
    [string]$ScriptDir = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$ts        = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
$evidPath  = "$OutputDir\dry_run_evidence.json"
$results   = @{}

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

function Run-Script {
    param([string]$Name, [string]$Script)
    Write-Host ""
    Write-Host "=== DRY-RUN: $Name ==="
    if (-not (Test-Path $Script)) {
        Write-Warning "SKIP: $Script not found"
        return @{ output = "SKIP: not found"; exit_code = -1 }
    }
    $out = powershell.exe -NonInteractive -ExecutionPolicy Bypass -File $Script -DryRun 2>&1 | Out-String
    $exit = $LASTEXITCODE
    Write-Host $out
    Write-Host "Exit code: $exit"
    return @{ output = $out; exit_code = $exit }
}

# ---------------------------------------------------------------------------
# 1. install.ps1
# ---------------------------------------------------------------------------
$results["install"] = Run-Script "install.ps1" (Join-Path $ScriptDir "install.ps1")

# ---------------------------------------------------------------------------
# 2. nssm_install.ps1
# ---------------------------------------------------------------------------
$results["nssm_install"] = Run-Script "nssm_install.ps1" (Join-Path $ScriptDir "nssm_install.ps1")

# ---------------------------------------------------------------------------
# 3. watchdog.ps1
# ---------------------------------------------------------------------------
$results["watchdog"] = Run-Script "watchdog.ps1" (Join-Path $ScriptDir "watchdog.ps1")

# ---------------------------------------------------------------------------
# 4. Credential leak check
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Credential leak check ==="
$credLeakFound = $false
$deployFiles = Get-ChildItem -Path $ScriptDir -Include "*.ps1","*.sh","*.md" -Recurse

# Patterns that must never appear hard-coded
$dangerPatterns = @(
    'AKIA[0-9A-Z]{16}',
    'aws_secret_access_key\s*=\s*[A-Za-z0-9+/]{40}'
)

foreach ($file in $deployFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    foreach ($pattern in $dangerPatterns) {
        if ($content -match $pattern) {
            Write-Warning "CREDENTIAL LEAK DETECTED in $($file.Name): matched pattern"
            $credLeakFound = $true
        }
    }
}

if (-not $credLeakFound) {
    Write-Host "No credential leaks detected in deploy scripts."
}

$results["credential_leak_check"] = @{
    files_checked = ($deployFiles | ForEach-Object { $_.Name })
    leak_found    = $credLeakFound
}

# ---------------------------------------------------------------------------
# 5. Write evidence JSON
# ---------------------------------------------------------------------------
$installExit  = [int]$results["install"]["exit_code"]
$nssmExit     = [int]$results["nssm_install"]["exit_code"]
$watchdogExit = [int]$results["watchdog"]["exit_code"]
$noLeak       = -not $credLeakFound
$allPass      = ($installExit -eq 0) -and ($nssmExit -eq 0) -and ($watchdogExit -eq 0) -and $noLeak

$evidence = [ordered]@{
    dry_run_at   = $ts
    script_dir   = $ScriptDir
    summary      = [ordered]@{
        install_exit  = $installExit
        nssm_exit     = $nssmExit
        watchdog_exit = $watchdogExit
        no_cred_leak  = $noLeak
        all_pass      = $allPass
    }
    results = $results
}

$evidence | ConvertTo-Json -Depth 10 | Set-Content -Path $evidPath -Encoding UTF8
Write-Host ""
Write-Host "Dry-run evidence written to: $evidPath"

if ($allPass) {
    Write-Host "=== SUMMARY: ALL PASS ==="
    exit 0
} else {
    Write-Host "=== SUMMARY: FAILURES DETECTED ==="
    exit 1
}
