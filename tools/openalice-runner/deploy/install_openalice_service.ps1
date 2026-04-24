# install_openalice_service.ps1 — thin shim, redirects to the new split.
#
# P0.6 split:
#   prep_openalice.ps1        non-admin: layout / venv / register / env / nssm dl
#   admin_install_service.ps1 admin:     nssm install + configure + start
#
# Rationale: Claude Code runs in a non-elevated shell; this split lets all the
# non-admin steps (filesystem, venv, register, nssm staging) run autonomously,
# and keeps the admin surface minimal (one UAC prompt, one script).
#
# Calling this file with admin rights will run both in order. Non-admin → only prep.

$ErrorActionPreference = "Stop"
$DEPLOY = Split-Path -Parent $PSCommandPath

Write-Host "[shim] P0.6: install script split into prep_openalice + admin_install_service" -ForegroundColor Yellow

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

# Prep runs either way.
powershell -ExecutionPolicy Bypass -File "$DEPLOY\prep_openalice.ps1"
if ($LASTEXITCODE -ne 0) { throw "prep failed (exit=$LASTEXITCODE)" }

if ($isAdmin) {
    Write-Host "[shim] admin detected — running admin_install_service.ps1" -ForegroundColor Cyan
    powershell -ExecutionPolicy Bypass -File "$DEPLOY\admin_install_service.ps1"
    if ($LASTEXITCODE -ne 0) { throw "admin install failed (exit=$LASTEXITCODE)" }
} else {
    Write-Host ""
    Write-Host "[shim] prep complete — re-open PowerShell as Administrator and run:" -ForegroundColor Cyan
    Write-Host "       powershell -ExecutionPolicy Bypass -File `"$DEPLOY\admin_install_service.ps1`"" -ForegroundColor White
    Write-Host ""
}
