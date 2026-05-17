# monitor-prod-schema-sync.ps1
# IUF Trading Room — Schema-sync probe monitoring script
# Author: Bruce (verifier / release engineer)
# Created: 2026-05-18
#
# USAGE
#   ./scripts/monitor-prod-schema-sync.ps1              # run once
#   ./scripts/monitor-prod-schema-sync.ps1 -Loop         # run every 5 min indefinitely
#   ./scripts/monitor-prod-schema-sync.ps1 -Loop -IntervalSec 30  # custom interval
#
# WHAT IT DOES
#   Polls GET https://api.eycvector.com/api/v1/admin/db/migration-status (Owner-only).
#   If sync=false OR connection fails → logs ALERT.
#   Exits 0 on SYNC_OK, exits 1 on SYNC_FAIL, exits 2 on connection error.
#
# NOTES
#   - Requires OWNER_COOKIE env var (set via Railway secret or local shell export)
#     e.g. $env:OWNER_COOKIE = "session=abc123..."
#   - When EXPECTED_MIGRATION_COUNT is set in Railway, the endpoint also checks count.
#   - Current state 2026-05-18: prod stuck at 0031 (0032-0038 not applied).
#     sync=false is EXPECTED until Yang/Jason unblock migration. Script will log
#     EXPECTED_BLOCKED alerts — do not page on these until migration is resolved.

param(
    [switch]$Loop,
    [int]$IntervalSec = 300
)

$API_URL = "https://api.eycvector.com/api/v1/admin/db/migration-status"
$HEALTH_URL = "https://api.eycvector.com/health"
$COOKIE = $env:OWNER_COOKIE

function Get-Timestamp {
    return (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " TST"
}

function Write-Alert {
    param([string]$Level, [string]$Msg)
    $ts = Get-Timestamp
    $prefix = switch ($Level) {
        "OK"    { "[OK   ]" }
        "WARN"  { "[WARN ]" }
        "ERROR" { "[ERROR]" }
        default { "[INFO ]" }
    }
    Write-Host "$ts $prefix $Msg"
}

function Invoke-SchemaProbe {
    # First check health (no auth needed)
    try {
        $healthRaw = Invoke-WebRequest -Uri $HEALTH_URL -Method GET -UseBasicParsing -TimeoutSec 10
        $health = $healthRaw.Content | ConvertFrom-Json
        $deploymentId = $health.build.deploymentId
        $startedAt = $health.build.startedAt
        Write-Alert "INFO" "health OK | deploymentId=$deploymentId | startedAt=$startedAt"
    } catch {
        Write-Alert "ERROR" "Health probe failed: $_"
        return 2
    }

    # Check migration-status (Owner auth required)
    if (-not $COOKIE) {
        Write-Alert "WARN" "OWNER_COOKIE not set. Cannot probe /admin/db/migration-status. Set `$env:OWNER_COOKIE."
        Write-Alert "INFO" "Health-only mode: deployment alive, migration state unknown."
        return 0
    }

    $headers = @{
        "Cookie"       = $COOKIE
        "Content-Type" = "application/json"
    }

    try {
        $resp = Invoke-WebRequest -Uri $API_URL -Method GET -Headers $headers -UseBasicParsing -TimeoutSec 15
        $data = $resp.Content | ConvertFrom-Json

        $sync        = $data.sync
        $last        = $data.lastApplied
        $count       = $data.appliedCount
        $expected    = $data.expectedCount
        $connection  = $data.connectionOk

        Write-Alert "INFO" "migration-status: sync=$sync | lastApplied=$last | applied=$count | expected=$expected | connectionOk=$connection"

        if ($connection -eq $false) {
            Write-Alert "ERROR" "ALERT: connectionOk=false — DB connection broken. Escalate to Jason immediately."
            return 1
        }

        if ($sync -eq $false) {
            Write-Alert "WARN" "ALERT: sync=false — migrations applied ($count) != expected ($expected). Last applied: $last."
            Write-Alert "WARN" "If prod is stuck at 0031, this is EXPECTED_BLOCKED until Jason applies 0032-0038."
            return 1
        }

        if ($sync -eq $true) {
            Write-Alert "OK" "SYNC_OK: All $count migrations applied. Last: $last."
            return 0
        }

        Write-Alert "WARN" "Unexpected response shape: $($resp.Content)"
        return 1

    } catch {
        $status = $_.Exception.Response?.StatusCode?.value__
        if ($status -eq 403 -or $status -eq 401) {
            Write-Alert "WARN" "Auth failed (HTTP $status). OWNER_COOKIE may be expired. Re-login and update OWNER_COOKIE."
        } else {
            Write-Alert "ERROR" "Connection error probing /admin/db/migration-status: $_ (HTTP $status)"
        }
        return 2
    }
}

# --- BASELINE RUN ---
Write-Alert "INFO" "=== IUF Schema-Sync Monitor START ==="
Write-Alert "INFO" "Target: $API_URL"
Write-Alert "INFO" "Loop: $Loop | Interval: ${IntervalSec}s"
Write-Alert "INFO" "Note: prod currently stuck at 0031 — sync=false is EXPECTED until Yang 14:00 migration unblock"

$exitCode = Invoke-SchemaProbe

if (-not $Loop) {
    Write-Alert "INFO" "=== One-shot complete. ExitCode=$exitCode ==="
    exit $exitCode
}

# --- CONTINUOUS LOOP ---
while ($true) {
    Write-Host ""
    $exitCode = Invoke-SchemaProbe
    Write-Alert "INFO" "Next probe in ${IntervalSec}s. Ctrl+C to stop."
    Start-Sleep -Seconds $IntervalSec
}
