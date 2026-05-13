<#
.SYNOPSIS
    Diagnose KGI Taipei EC2 Windows runtime context without submitting orders.

.DESCRIPTION
    This probe is designed for AWS SSM on the Taipei Windows EC2 KGI gateway.
    It checks only runtime prerequisites:
      - Windows/service context
      - KGIGateway/NSSM configuration
      - Python/kgisuperpy import and bridge files
      - ServiSign files/processes/COM registration
      - KGI SIM host TCP reachability
      - local gateway /health

    It does NOT call /order/create and does NOT submit any order.
    It does NOT print credentials or environment secret values.

.PARAMETER OutDir
    Directory where JSON/text probe outputs are written.

.PARAMETER GatewayBaseUrl
    Local gateway URL. Default http://127.0.0.1:8787.

.PARAMETER ServiceName
    Windows service name. Default KGIGateway.
#>

[CmdletBinding()]
param(
    [string]$OutDir = "C:\iuf-kgi-runtime-probe",
    [string]$GatewayBaseUrl = "http://127.0.0.1:8787",
    [string]$ServiceName = "KGIGateway"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

function New-ProbeResult {
    param(
        [string]$Name,
        [string]$Status,
        [object]$Detail = $null
    )
    [ordered]@{
        name = $Name
        status = $Status
        detail = $Detail
    }
}

function Redact-EnvValue {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $Value }
    if ($Value.Length -le 4) { return "***" }
    return ($Value.Substring(0, 2) + "***" + $Value.Substring($Value.Length - 2))
}

function Clean-NssmText {
    param([object]$Value)
    if ($null -eq $Value) { return $null }
    return (($Value -join "`n") -replace "`0", "").Trim()
}

function Test-Tcp {
    param([string]$HostName, [int]$Port)
    try {
        $result = Test-NetConnection -ComputerName $HostName -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
        return [ordered]@{ host = $HostName; port = $Port; tcpOk = [bool]$result }
    } catch {
        return [ordered]@{ host = $HostName; port = $Port; tcpOk = $false; error = $_.Exception.GetType().Name }
    }
}

function Test-ComProgId {
    param([string]$ProgId)
    $type = $null
    try {
        $type = [type]::GetTypeFromProgID($ProgId)
    } catch {}
    $created = $false
    $createError = $null
    if ($null -ne $type) {
        try {
            $obj = [Activator]::CreateInstance($type)
            $created = $null -ne $obj
            if ($obj -is [System.__ComObject]) {
                [System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) | Out-Null
            }
        } catch {
            $createError = $_.Exception.GetType().Name + ": " + $_.Exception.Message
        }
    }
    return [ordered]@{
        progId = $ProgId
        typeFound = $null -ne $type
        createInstanceOk = $created
        createError = $createError
    }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$startedAt = (Get-Date).ToString("o")
$results = New-Object System.Collections.Generic.List[object]

# 1. Host/user context
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $sessionInfo = [ordered]@{
        computerName = $env:COMPUTERNAME
        user = $identity.Name
        isAdmin = $isAdmin
        sessionName = $env:SESSIONNAME
        cwd = (Get-Location).Path
        os = (Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)
        startedAt = $startedAt
    }
    $results.Add((New-ProbeResult "host_context" "PASS" $sessionInfo))
} catch {
    $results.Add((New-ProbeResult "host_context" "FAIL" $_.Exception.Message))
}

# 2. Service/NSSM context
try {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
    $nssmExe = "C:\nssm\nssm.exe"
    $nssm = [ordered]@{}
    if (Test-Path $nssmExe) {
        foreach ($key in @("Application", "AppDirectory", "AppParameters", "AppStdout", "AppStderr", "ObjectName")) {
            try {
                $value = Clean-NssmText (& $nssmExe get $ServiceName $key 2>$null)
                if ($key -eq "AppEnvironmentExtra") { $value = "[REDACTED]" }
                $nssm[$key] = $value
            } catch {
                $nssm[$key] = "[probe_failed]"
            }
        }
    }
    $results.Add((New-ProbeResult "service_context" "PASS" ([ordered]@{
        name = $svc.Name
        state = $svc.State
        startMode = $svc.StartMode
        startName = $svc.StartName
        processId = $svc.ProcessId
        pathName = $svc.PathName
        nssm = $nssm
    })))
} catch {
    $results.Add((New-ProbeResult "service_context" "FAIL" $_.Exception.Message))
}

# 3. Python/kgisuperpy and bridge files
try {
    $pythonCommand = @(Get-Command python -ErrorAction SilentlyContinue | Select-Object -First 1)
    $pythonPath = if ($pythonCommand.Count -gt 0) {
        if ($pythonCommand[0].PSObject.Properties.Name -contains "Source") { $pythonCommand[0].Source }
        elseif ($pythonCommand[0].PSObject.Properties.Name -contains "Path") { $pythonCommand[0].Path }
        else { "python" }
    } else {
        $candidates = @(
            "C:\Python311\python.exe",
            "C:\Program Files\Python311\python.exe",
            "C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe"
        )
        $found = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($found) { $found } else { "python" }
    }
    $pyProbe = @"
import json, os, sys
out = {"python": sys.executable, "version": sys.version, "kgisuperpy_import_ok": False}
try:
    import kgisuperpy
    out["kgisuperpy_import_ok"] = True
    out["kgisuperpy_file"] = getattr(kgisuperpy, "__file__", None)
    push = os.path.join(os.path.dirname(kgisuperpy.__file__), "pushClient")
    out["pushClient"] = push
    out["bridge_files"] = [f for f in os.listdir(push) if "bridge" in f.lower() or f.lower().endswith((".dll", ".ini"))][:50]
except Exception as exc:
    out["error_type"] = type(exc).__name__
    out["error"] = str(exc)
print(json.dumps(out))
"@
$pyJson = (& $pythonPath -c $pyProbe 2>$null) | Select-Object -First 1
    $pyObj = $pyJson | ConvertFrom-Json
    $results.Add((New-ProbeResult "python_kgisuperpy" ($(if ($pyObj.kgisuperpy_import_ok) {"PASS"} else {"FAIL"})) $pyObj))
} catch {
    $results.Add((New-ProbeResult "python_kgisuperpy" "FAIL" $_.Exception.Message))
}

# 4. ServiSign files/processes/registry/COM
try {
    $serviRoot = "C:\Program Files (x86)\KGI\KGIServiSign"
    $files = @()
    if (Test-Path $serviRoot) {
        $files = Get-ChildItem -Path $serviRoot -Recurse -File -ErrorAction SilentlyContinue |
            Select-Object FullName, Length |
            ForEach-Object { [ordered]@{ path = $_.FullName; length = $_.Length } }
    }
    $processes = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match "KGI|Servi|CGC" } |
        Select-Object ProcessName, Id, Path |
        ForEach-Object { [ordered]@{ processName = $_.ProcessName; id = $_.Id; path = $_.Path } }
    $com = @()
    foreach ($progId in @(
        "KGICGCAPIATLSVI.KGICGCAPISVI",
        "KGICGCAPIATLSVI.KGICGCAPISVI.1",
        "CGEnvDetectATL.CGEnvDetect"
    )) {
        $com += Test-ComProgId -ProgId $progId
    }
    $results.Add((New-ProbeResult "servisign_com" "PASS" ([ordered]@{
        installRootExists = (Test-Path $serviRoot)
        files = $files
        processes = $processes
        com = $com
    })))
} catch {
    $results.Add((New-ProbeResult "servisign_com" "FAIL" $_.Exception.Message))
}

# 5. KGI SIM host TCP
$tcpResults = @()
foreach ($hostName in @("itradetest.kgi.com.tw", "iquotetest.kgi.com.tw")) {
    foreach ($port in @(443, 8000)) {
        $tcpResults += Test-Tcp $hostName $port
    }
}
$tcpFailures = @($tcpResults | Where-Object { -not $_.tcpOk })
$tcpStatus = if ($tcpFailures.Count -eq 0) { "PASS" } else { "FAIL" }
$results.Add((New-ProbeResult "kgi_sim_tcp" $tcpStatus $tcpResults))

# 6. Gateway health
try {
    $health = Invoke-WebRequest -Uri "$GatewayBaseUrl/health" -UseBasicParsing -TimeoutSec 15
    $content = $health.Content
    $results.Add((New-ProbeResult "gateway_health" "PASS" ([ordered]@{
        statusCode = $health.StatusCode
        content = $content
    })))
} catch {
    $results.Add((New-ProbeResult "gateway_health" "FAIL" $_.Exception.Message))
}

# 7. Safe environment presence only, values redacted
try {
    $envNames = @("KGI_PERSON_ID", "KGI_PERSON_PWD", "KGI_SIMULATION", "KGI_READ_ONLY_MODE", "GATEWAY_HOST", "GATEWAY_PORT")
    $envStatus = [ordered]@{}
    foreach ($name in $envNames) {
        $value = [System.Environment]::GetEnvironmentVariable($name, "Machine")
        $envStatus[$name] = [ordered]@{
            present = -not [string]::IsNullOrEmpty($value)
            value = if ($name -match "PWD") { "[REDACTED]" } elseif ($name -match "PERSON") { Redact-EnvValue $value } else { $value }
        }
    }
    $results.Add((New-ProbeResult "machine_env_presence" "PASS" $envStatus))
} catch {
    $results.Add((New-ProbeResult "machine_env_presence" "FAIL" $_.Exception.Message))
}

$summary = [ordered]@{
    schemaVersion = "kgi_taipei_runtime_probe_v1"
    generatedAt = (Get-Date).ToString("o")
    hardLines = [ordered]@{
        submitsOrder = $false
        callsOrderCreate = $false
        printsSecrets = $false
    }
    results = $results
}

$jsonPath = Join-Path $OutDir "kgi_taipei_runtime_probe.json"
$txtPath = Join-Path $OutDir "kgi_taipei_runtime_probe.txt"
$summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("KGI Taipei Runtime Probe")
$lines.Add("GeneratedAt=$($summary.generatedAt)")
$lines.Add("HardLines: no order submit, no /order/create, no secret print")
foreach ($r in $results) {
    $lines.Add(("{0}: {1}" -f $r.name, $r.status))
}
$lines | Set-Content -LiteralPath $txtPath -Encoding UTF8

Write-Output "ProbeJson=$jsonPath"
Write-Output "ProbeText=$txtPath"
foreach ($r in $results) {
    Write-Output ("{0}={1}" -f $r.name, $r.status)
}
