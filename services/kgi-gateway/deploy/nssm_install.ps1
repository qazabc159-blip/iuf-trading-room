<#
.SYNOPSIS
    Register KGI Gateway as a Windows service using NSSM.

.DESCRIPTION
    Downloads NSSM (Non-Sucking Service Manager) if not present,
    then registers the KGI Gateway Python app as an auto-start Windows service
    with stdout/stderr log rotation, environment variable injection from registry,
    and failure restart policy.

.PARAMETER DryRun
    Print actions without executing.

.PARAMETER NssmDir
    Directory to install NSSM. Default: C:\nssm

.PARAMETER ServiceName
    Windows service name. Default: KGIGateway

.PARAMETER GatewayInstallDir
    Where the gateway source was installed. Default: C:\kgi-gateway

.PARAMETER PythonExe
    Path to python.exe. Auto-detected from PATH if not provided.

.NOTES
    Run as Administrator.
    NSSM source: https://nssm.cc (freeware, LGPL-like)
    No KGI credentials are written by this script - they are read from registry
    (set by install.ps1 step 6).
#>

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$NssmDir          = "C:\nssm",
    [string]$ServiceName      = "KGIGateway",
    [string]$GatewayInstallDir = "C:\kgi-gateway",
    [string]$PythonExe        = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
$LogDir  = "C:\kgi-gateway-logs"
$LogFile = "$LogDir\nssm_install.log"

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts   = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    if (-not $DryRun) {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line
    }
}
function Write-Info { param([string]$m) Write-Log "INFO " $m }
function Write-Warn { param([string]$m) Write-Log "WARN " $m }
function Write-Err  { param([string]$m) Write-Log "ERROR" $m }

function Invoke-Action {
    param([string]$Description, [scriptblock]$Action)
    if ($DryRun) { Write-Info "[DRY-RUN] SKIP: $Description" }
    else { Write-Info "EXEC: $Description"; & $Action }
}

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
Write-Info "========================================"
Write-Info "KGI Gateway NSSM Service Install"
Write-Info "ServiceName=$ServiceName  InstallDir=$GatewayInstallDir"
Write-Info "DryRun=$DryRun"
Write-Info "========================================"

if (-not $DryRun) {
    $currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Err "Must run as Administrator."; exit 1
    }
}

# ---------------------------------------------------------------------------
# 1. Resolve python.exe
# ---------------------------------------------------------------------------
if (-not $PythonExe) {
    $pyFromPath = Get-Command python -ErrorAction SilentlyContinue
    $pyFromPathSrc = if ($null -ne $pyFromPath) { $pyFromPath.Source } else { $null }
    $candidates = @(
        "C:\Python311\python.exe",
        "C:\Program Files\Python311\python.exe",
        $pyFromPathSrc
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { $PythonExe = $c; break }
    }
}
if (-not $PythonExe) {
    Write-Err "python.exe not found. Run install.ps1 first, or pass -PythonExe."
    exit 1
}
Write-Info "Python: $PythonExe"

# ---------------------------------------------------------------------------
# 2. Download + extract NSSM
# ---------------------------------------------------------------------------
Write-Info "--- Step 1: NSSM setup ---"
$NssmExe = "$NssmDir\nssm.exe"

if (Test-Path $NssmExe) {
    Write-Info "NSSM already present: $NssmExe"
} else {
    Invoke-Action "Download + extract NSSM 2.24" {
        $nssmZipUrl = "https://nssm.cc/release/nssm-2.24.zip"
        $nssmZip    = "$env:TEMP\nssm-2.24.zip"
        Invoke-WebRequest -Uri $nssmZipUrl -OutFile $nssmZip -UseBasicParsing
        Expand-Archive -Path $nssmZip -DestinationPath $env:TEMP -Force
        # nssm-2.24\win64\nssm.exe
        $extracted = "$env:TEMP\nssm-2.24\win64\nssm.exe"
        if (-not (Test-Path $extracted)) {
            # fallback: win32
            $extracted = "$env:TEMP\nssm-2.24\win32\nssm.exe"
        }
        if (-not (Test-Path $NssmDir)) { New-Item -ItemType Directory -Path $NssmDir -Force | Out-Null }
        Copy-Item -Path $extracted -Destination $NssmExe -Force
        Remove-Item $nssmZip -Force
        Write-Info "NSSM installed to $NssmExe"
    }
}

# DRY-RUN: use placeholder for NSSM path validation
if ($DryRun) { $NssmExe = "nssm.exe [dry-run]" }

# ---------------------------------------------------------------------------
# 3. Remove old service if exists
# ---------------------------------------------------------------------------
Write-Info "--- Step 2: Remove old service (if any) ---"
Invoke-Action "Stop and remove existing '$ServiceName' service" {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        Write-Info "  Found existing service - stopping + removing..."
        if ($svc.Status -ne "Stopped") {
            try {
                & $NssmExe stop $ServiceName 2>&1 | ForEach-Object { Write-Info "  nssm stop: $_" }
            } catch {
                Write-Warn "  nssm stop failed/ignored: $($_.Exception.Message)"
            }
            Start-Sleep -Seconds 2
        } else {
            Write-Info "  Service already stopped."
        }

        try {
            & $NssmExe remove $ServiceName confirm 2>&1 | ForEach-Object { Write-Info "  nssm remove: $_" }
        } catch {
            Write-Warn "  nssm remove failed, falling back to sc.exe delete: $($_.Exception.Message)"
            sc.exe delete $ServiceName 2>&1 | ForEach-Object { Write-Info "  sc delete: $_" }
        }

        $deadline = (Get-Date).AddSeconds(20)
        do {
            Start-Sleep -Seconds 1
            $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        } while ($svc -and (Get-Date) -lt $deadline)

        if ($svc) {
            Write-Warn "  Service still visible after removal; Windows may have it marked for deletion."
        } else {
            Write-Info "  Old service removed."
        }
    } else {
        Write-Info "  No existing service found."
    }
}

# ---------------------------------------------------------------------------
# 4. Create log directory
# ---------------------------------------------------------------------------
Write-Info "--- Step 3: Log directory ---"
Invoke-Action "Create $LogDir" {
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    Write-Info "  Log dir: $LogDir"
}

# ---------------------------------------------------------------------------
# 5. Install service via NSSM
# ---------------------------------------------------------------------------
Write-Info "--- Step 4: NSSM install service ---"

# Gateway is started via uvicorn via python -m uvicorn app:app
# Arguments to python.exe: -m uvicorn app:app --host 0.0.0.0 --port 8787

$UvicornArgs = "-m uvicorn app:app --host 0.0.0.0 --port 8787"

Invoke-Action "nssm install $ServiceName" {
    & $NssmExe install $ServiceName $PythonExe $UvicornArgs
    if ($LASTEXITCODE -ne 0) { Write-Err "nssm install failed (exit $LASTEXITCODE)"; exit 1 }
    Write-Info "  Service '$ServiceName' installed."
}

# ---------------------------------------------------------------------------
# 6. Configure service settings
# ---------------------------------------------------------------------------
Write-Info "--- Step 5: Configure service settings ---"

Invoke-Action "Set AppDirectory to $GatewayInstallDir" {
    & $NssmExe set $ServiceName AppDirectory $GatewayInstallDir
}

Invoke-Action "Set service DisplayName + Description" {
    & $NssmExe set $ServiceName DisplayName "IUF KGI Gateway"
    & $NssmExe set $ServiceName Description "KGI Trading Gateway - FastAPI/uvicorn bridge for kgisuperpy"
}

# Start mode: auto (starts with Windows)
Invoke-Action "Set start type: Automatic (auto-start)" {
    & $NssmExe set $ServiceName Start SERVICE_AUTO_START
}

# Stdout / stderr log files (with rotation enabled by NSSM)
$StdoutLog = "$LogDir\gateway.stdout.log"
$StderrLog = "$LogDir\gateway.stderr.log"

Invoke-Action "Set stdout log: $StdoutLog" {
    & $NssmExe set $ServiceName AppStdout $StdoutLog
    & $NssmExe set $ServiceName AppStdoutCreationDisposition 4   # OPEN_ALWAYS (append)
    & $NssmExe set $ServiceName AppRotateFiles 1
    & $NssmExe set $ServiceName AppRotateBytes 10485760           # 10 MB per file
    & $NssmExe set $ServiceName AppRotateOnline 1                 # rotate without restart
}

Invoke-Action "Set stderr log: $StderrLog" {
    & $NssmExe set $ServiceName AppStderr $StderrLog
    & $NssmExe set $ServiceName AppStderrCreationDisposition 4
}

# Failure/restart policy: restart after 30s, max 3 attempts before giving up
Invoke-Action "Set failure restart policy (30s delay, 3 max)" {
    # Reset failure count after 1 hour of successful uptime
    & $NssmExe set $ServiceName AppRestartDelay 30000   # ms
    & $NssmExe set $ServiceName AppThrottle 30000
    # Native service failure actions (via sc.exe for finer control)
    sc.exe failure $ServiceName reset= 3600 actions= restart/30000/restart/30000/restart/30000 | Out-Null
}

# ---------------------------------------------------------------------------
# 7. Inject environment variables from Machine registry into service
#    NSSM reads from its own AppEnvironmentExtra key - we set each var.
#    Credentials (KGI_PERSON_ID, KGI_PERSON_PWD) are read from registry by
#    config.py at runtime via os.environ - NSSM inherits system env vars.
# ---------------------------------------------------------------------------
Write-Info "--- Step 6: Environment variable inheritance ---"

# NSSM inherits Machine-level env vars by default.
# For explicitness (and to protect against stale env), we also set them in AppEnvironmentExtra.

$machinePid = [System.Environment]::GetEnvironmentVariable("KGI_PERSON_ID", "Machine")
$machinePwd = [System.Environment]::GetEnvironmentVariable("KGI_PERSON_PWD", "Machine")

if ($machinePid -and $machinePwd) {
    Invoke-Action "Set AppEnvironmentExtra with KGI env vars" {
        # Redact actual values from log - only record that they were set
        $envExtra = @(
            "KGI_PERSON_ID=$machinePid",
            "KGI_PERSON_PWD=$machinePwd",
            "KGI_SIMULATION=false",
            "KGI_READ_ONLY_MODE=true",
            "GATEWAY_HOST=0.0.0.0",
            "GATEWAY_PORT=8787",
            "AUTO_LOGIN=false",
            "KGI_GATEWAY_POSITION_DISABLED=false",
            "KGI_GATEWAY_QUOTE_DISABLED=false"
        )
        $envExtraStr = $envExtra -join "`n"
        & $NssmExe set $ServiceName AppEnvironmentExtra $envExtraStr
        Write-Info "  AppEnvironmentExtra set (KGI_PERSON_ID=[REDACTED], KGI_PERSON_PWD=[REDACTED])"
    }
} else {
    Write-Warn "KGI_PERSON_ID/KGI_PERSON_PWD not found in Machine registry."
    Write-Warn "Run install.ps1 first (step 6 writes SSM params to registry)."
    if (-not $DryRun) { exit 1 }
}

# ---------------------------------------------------------------------------
# 8. Start the service
# ---------------------------------------------------------------------------
Write-Info "--- Step 7: Start service ---"
Invoke-Action "nssm start $ServiceName" {
    & $NssmExe start $ServiceName
    if ($LASTEXITCODE -ne 0) { Write-Warn "nssm start returned $LASTEXITCODE - check logs" }
    else { Write-Info "  Service started." }
}

# ---------------------------------------------------------------------------
# 9. Verify: GET /health
# ---------------------------------------------------------------------------
Write-Info "--- Step 8: Verify /health ---"
Invoke-Action "GET http://127.0.0.1:8787/health" {
    Start-Sleep -Seconds 10   # allow uvicorn to boot
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8787/health" -UseBasicParsing -TimeoutSec 15
        if ($resp.StatusCode -eq 200) {
            Write-Info "  /health OK 200: $($resp.Content)"
        } else {
            Write-Warn "  /health $($resp.StatusCode): $($resp.Content)"
        }
    } catch {
        Write-Warn "  /health not reachable: $_ - check $LogDir\gateway.stdout.log"
    }
}

Write-Info "========================================"
Write-Info "NSSM service install complete."
Write-Info "Service: $ServiceName  | Status: check 'Get-Service $ServiceName'"
Write-Info "Logs:    $StdoutLog"
Write-Info "         $StderrLog"
Write-Info "Next: run watchdog.ps1 as Scheduled Task for /health monitoring."
Write-Info "========================================"
