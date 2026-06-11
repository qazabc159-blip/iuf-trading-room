param(
  [int]$MinVolumeSizeMB = 5000,
  [int]$MaxUsagePercent = 85,
  [string]$ServiceName = "pg",
  [string]$VolumeName = "pg-volume",
  [string]$MountPath = "/var/lib/postgresql/data"
)

$ErrorActionPreference = "Stop"

function Write-ErrorLine([string]$Message) {
  Write-Host "::error::$Message"
}

function Write-WarningLine([string]$Message) {
  Write-Host "::warning::$Message"
}

function Invoke-RailwayJson([string[]]$Arguments) {
  $raw = & railway @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "railway $($Arguments -join ' ') failed with exit code $exitCode. Output: $raw"
  }

  try {
    return $raw | ConvertFrom-Json
  } catch {
    throw "railway $($Arguments -join ' ') did not return valid JSON. Output: $raw"
  }
}

if ([string]::IsNullOrWhiteSpace($env:RAILWAY_TOKEN) -and $env:GITHUB_ACTIONS -eq "true") {
  Write-ErrorLine "RAILWAY_TOKEN is required for production Postgres preflight."
  exit 1
} elseif ([string]::IsNullOrWhiteSpace($env:RAILWAY_TOKEN)) {
  Write-WarningLine "RAILWAY_TOKEN is not set; using the local Railway CLI session for preflight."
}

$volumesPayload = Invoke-RailwayJson @("volume", "list", "--json")
$volumes = @($volumesPayload.volumes)
$pgVolume = $volumes |
  Where-Object {
    $_.name -eq $VolumeName -or
    ($_.serviceName -eq $ServiceName -and $_.mountPath -eq $MountPath)
  } |
  Select-Object -First 1

if ($null -eq $pgVolume) {
  Write-ErrorLine "Production Postgres volume was not found. Expected volume '$VolumeName' mounted at '$MountPath'."
  exit 1
}

$sizeMB = [double]$pgVolume.sizeMB
$currentSizeMB = [double]$pgVolume.currentSizeMB
$usagePercent = if ($sizeMB -gt 0) { [math]::Round(($currentSizeMB / $sizeMB) * 100, 2) } else { 100 }

Write-Host "::notice::Postgres volume '$($pgVolume.name)' service=$($pgVolume.serviceName) mount=$($pgVolume.mountPath) sizeMB=$sizeMB currentSizeMB=$currentSizeMB usagePercent=$usagePercent"

if ($sizeMB -lt $MinVolumeSizeMB) {
  Write-ErrorLine "Postgres volume '$($pgVolume.name)' is only ${sizeMB}MB. Resize it to at least ${MinVolumeSizeMB}MB (recommended 10000MB) before deploying API."
  Write-ErrorLine "Railway path: pg service -> Volumes -> pg-volume -> Live Resize."
  exit 1
}

if ($usagePercent -ge $MaxUsagePercent) {
  Write-ErrorLine "Postgres volume '$($pgVolume.name)' is ${usagePercent}% full, above the ${MaxUsagePercent}% safety ceiling. Clean up/archive data or resize before deploying API."
  exit 1
}

$statusPayload = Invoke-RailwayJson @("status", "--json")
$environment = @($statusPayload.environments.edges)[0].node
$services = @($environment.serviceInstances.edges)
$pgService = $services |
  ForEach-Object { $_.node } |
  Where-Object { $_.serviceName -eq $ServiceName } |
  Select-Object -First 1

if ($null -eq $pgService) {
  Write-ErrorLine "Railway service '$ServiceName' was not found in the linked environment."
  exit 1
}

$pgStatus = [string]$pgService.latestDeployment.status
Write-Host "::notice::Postgres service '$ServiceName' latest deployment status: $pgStatus"

if ($pgStatus -ne "SUCCESS") {
  Write-ErrorLine "Postgres service '$ServiceName' is $pgStatus, not SUCCESS. API deploy is blocked because DB-backed product pages would be broken."
  Write-ErrorLine "Check Railway pg logs; if volume is full, live resize pg-volume first, then wait until Postgres accepts connections."
  exit 1
}

Write-Host "::notice::Production Postgres preflight passed."
