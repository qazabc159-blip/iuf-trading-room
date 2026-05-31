<#
.SYNOPSIS
    KGI Gateway health watchdog — restarts NSSM service after 3 consecutive /health failures.

.DESCRIPTION
    Designed to run as a Windows Scheduled Task every 1 minute.
    On 3 consecutive /health failures:
      - Logs the incident
      - Restarts the KGIGateway NSSM service
      - If SENTRY_DSN is set, sends a capture event via Sentry HTTP API
      - Resets failure counter after successful restart

    State file: C:\kgi-gateway-logs\watchdog_state.json
    Log file:   C:\kgi-gateway-logs\watchdog.log

.PARAMETER ServiceName
    NSSM service name. Default: KGIGateway

.PARAMETER HealthUrl
    Health endpoint to probe. Default: http://127.0.0.1:8787/health

.PARAMETER MaxFails
    Consecutive failures before restart. Default: 3

.PARAMETER DryRun
    Log actions without restarting service or posting to Sentry.

.NOTES
    Install as Scheduled Task:
      schtasks /create /tn "KGIGatewayWatchdog" /tr "powershell.exe -NonInteractive -File C:\kgi-gateway\deploy\watchdog.ps1" /sc MINUTE /mo 1 /ru SYSTEM
    (Run as SYSTEM so it can restart services without user session.)
#>

[CmdletBinding()]
param(
    [string]$ServiceName = "KGIGateway",
    [string]$HealthUrl   = "http://127.0.0.1:8787/health",
    [int]$MaxFails       = 3,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"   # watchdog must not crash on errors

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
$LogDir    = "C:\kgi-gateway-logs"
$LogFile   = "$LogDir\watchdog.log"
$StateFile = "$LogDir\watchdog_state.json"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
function Write-Log {
    param([string]$Level, [string]$Message)
    $ts   = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}
function Write-Info { param([string]$m) Write-Log "INFO " $m }
function Write-Warn { param([string]$m) Write-Log "WARN " $m }

# ---------------------------------------------------------------------------
# State: load / save consecutive failure count
# ---------------------------------------------------------------------------
function Get-WatchdogState {
    if (Test-Path $StateFile) {
        try {
            return (Get-Content $StateFile -Raw | ConvertFrom-Json)
        } catch {
            return @{ consecutive_fails = 0; last_restart = $null; total_restarts = 0 }
        }
    }
    return @{ consecutive_fails = 0; last_restart = $null; total_restarts = 0 }
}

function Save-WatchdogState {
    param([hashtable]$State)
    $State | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
}

# ---------------------------------------------------------------------------
# Sentry capture (optional — only if SENTRY_DSN env var is set)
# ---------------------------------------------------------------------------
function Send-SentryEvent {
    param([string]$Message)
    $dsn = [System.Environment]::GetEnvironmentVariable("SENTRY_DSN", "Machine")
    if (-not $dsn) {
        Write-Info "SENTRY_DSN not set — skipping Sentry notification."
        return
    }
    try {
        # Parse DSN: https://<key>@<host>/<project_id>
        # POST to https://<host>/api/<project_id>/store/
        if ($dsn -match "https://([^@]+)@([^/]+)/(.+)") {
            $key       = $Matches[1]
            $host_part = $Matches[2]
            $project   = $Matches[3]
            $storeUrl  = "https://$host_part/api/$project/store/"
            $eventId   = ([Guid]::NewGuid().ToString("N"))
            $ts        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss")
            $body = @{
                event_id   = $eventId
                timestamp  = $ts
                level      = "error"
                logger     = "kgi_gateway.watchdog"
                message    = $Message
                tags       = @{ service = $ServiceName; host = $env:COMPUTERNAME }
            } | ConvertTo-Json -Depth 5
            $headers = @{
                "X-Sentry-Auth" = "Sentry sentry_version=7, sentry_key=$key"
                "Content-Type"  = "application/json"
            }
            Invoke-RestMethod -Uri $storeUrl -Method Post -Body $body -Headers $headers -TimeoutSec 10 | Out-Null
            Write-Info "Sentry event sent: $eventId"
        } else {
            Write-Warn "SENTRY_DSN format not recognized — skipping."
        }
    } catch {
        Write-Warn "Sentry send failed: $_"
    }
}

# ---------------------------------------------------------------------------
# KGI SIM re-login (when process is up but session dropped)
# Reads SIM credentials from SSM Parameter Store (region ap-east-2), POSTs
# /session/login (simulation=true), then /session/set-account if needed.
# The gateway login path has its own FIsLogon poll-wait, so this is retriable.
# ---------------------------------------------------------------------------
function Invoke-KgiRelogin {
    try {
        $pid_ = (& aws ssm get-parameter --region ap-east-2 --name /iuf/kgi/sim_person_id --with-decryption --query Parameter.Value --output text)
        $pwd_ = (& aws ssm get-parameter --region ap-east-2 --name /iuf/kgi/sim_person_pwd --with-decryption --query Parameter.Value --output text)
        if (-not $pid_ -or -not $pwd_) { Write-Warn "Re-login skipped: SIM creds unavailable from SSM"; return }
        $loginUrl = ($HealthUrl -replace "/health$", "/session/login")
        $acctUrl  = ($HealthUrl -replace "/health$", "/session/set-account")
        $body = @{ person_id = $pid_; person_pwd = $pwd_; simulation = $true } | ConvertTo-Json -Compress
        Invoke-WebRequest -Uri $loginUrl -Method Post -Body $body -ContentType "application/json" -TimeoutSec 40 -UseBasicParsing | Out-Null
        Start-Sleep -Seconds 2
        $h2 = (Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 8).Content | ConvertFrom-Json
        if ($h2.kgi_logged_in) {
            if (-not $h2.account_set) {
                $ab = @{ account = "0012826" } | ConvertTo-Json -Compress
                Invoke-WebRequest -Uri $acctUrl -Method Post -Body $ab -ContentType "application/json" -TimeoutSec 15 -UseBasicParsing | Out-Null
            }
            Write-Info "Re-login OK kgi_logged_in=true account_set=$($h2.account_set)"
        } else {
            Write-Warn "Re-login POST returned but kgi_logged_in still false (will retry next tick)"
        }
    } catch {
        Write-Warn "Re-login error: $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# Main watchdog logic
# ---------------------------------------------------------------------------
$state = Get-WatchdogState

Write-Info "Watchdog tick — probing $HealthUrl  (consecutive_fails=$($state.consecutive_fails))"

# Probe /health
$healthy = $false
$loggedIn = $false
try {
    $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 10
    if ($resp.StatusCode -eq 200) {
        $healthy = $true
        try { $loggedIn = [bool](($resp.Content | ConvertFrom-Json).kgi_logged_in) } catch { $loggedIn = $false }
        Write-Info "/health OK 200 kgi_logged_in=$loggedIn"
    } else {
        Write-Warn "/health returned $($resp.StatusCode)"
    }
} catch {
    Write-Warn "/health unreachable: $($_.Exception.Message)"
}

if ($healthy) {
    # Process is up. If the KGI SIM session has dropped, re-login in place before
    # treating this tick as healthy (watchdog must not silently leave us logged out —
    # that is the failure mode that caused the 5/20-5/28 dark window).
    if (-not $loggedIn) {
        Write-Warn "Process up but kgi_logged_in=false — attempting in-place re-login"
        if (-not $DryRun) { Invoke-KgiRelogin }
    }
    # Reset failure counter on success
    if ($state.consecutive_fails -gt 0) {
        Write-Info "Service recovered — resetting failure counter (was $($state.consecutive_fails))"
    }
    $state["consecutive_fails"] = 0
    Save-WatchdogState $state
    exit 0
}

# Increment failure counter
$state["consecutive_fails"] = [int]$state.consecutive_fails + 1
Write-Warn "Failure $($state.consecutive_fails) / $MaxFails"
Save-WatchdogState $state

if ($state.consecutive_fails -lt $MaxFails) {
    Write-Info "Below threshold — waiting for next tick."
    exit 0
}

# ---------------------------------------------------------------------------
# Threshold reached: restart service
# ---------------------------------------------------------------------------
$msg = "KGI Gateway /health failed $($state.consecutive_fails) consecutive times — restarting service '$ServiceName'"
Write-Warn $msg

if ($DryRun) {
    Write-Info "[DRY-RUN] Would restart $ServiceName and send Sentry event"
    $state["consecutive_fails"] = 0
    Save-WatchdogState $state
    exit 0
}

# Send Sentry alert before restart (so we capture the event even if restart fails)
Send-SentryEvent $msg

# Restart NSSM service
try {
    $restartResult = & sc.exe stop $ServiceName 2>&1
    Start-Sleep -Seconds 5
    $startResult = & sc.exe start $ServiceName 2>&1
    Write-Info "Service restart issued: stop=$restartResult  start=$startResult"
    $state["consecutive_fails"] = 0
    $state["last_restart"]      = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
    $state["total_restarts"]    = [int]$state.total_restarts + 1
    Save-WatchdogState $state
    Write-Info "Watchdog restart #$($state.total_restarts) complete."
} catch {
    Write-Warn "Restart attempt failed: $_"
}
