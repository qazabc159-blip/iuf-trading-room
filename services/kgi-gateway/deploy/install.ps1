<#
.SYNOPSIS
    KGI Gateway EC2 install script — installs Python, gateway source, deps, env vars.

.DESCRIPTION
    Runs on Windows Server 2022 EC2 (i-0b02f62220f422349 / 54.249.139.28).
    Steps:
      1. Check / install Python 3.11 via winget MSI
      2. Verify pip is available
      3. Install Visual C++ Runtime if missing (Win Server 2022 occasionally lacks it)
      4. Create C:\kgi-gateway\ and copy service files
      5. pip install -r requirements.txt + kgisuperpy
      6. Load env vars from SSM Parameter Store (preferred) or prompt
      7. Smoke-test: python app.py --dry-run  (one HTTP GET /health, then exit)
      8. Write install_evidence.json

.PARAMETER DryRun
    When -DryRun is specified the script prints every action but does NOT:
      - install software
      - write registry env vars
      - call SSM
      - run app.py
    Useful for offline review / CI plan checks.

.PARAMETER SourceDir
    Path to the services/kgi-gateway source directory to deploy.
    Default: script's parent directory (.\.. relative to deploy\).

.PARAMETER GatewayInstallDir
    Target directory on EC2 where gateway will live.
    Default: C:\kgi-gateway

.PARAMETER UseSSM
    When $true (default), credentials are read from AWS SSM Parameter Store.
    When $false, script prompts for credentials interactively (fallback).

.PARAMETER KgiSimulation
    When $true (default), the gateway is configured for KGI SIM/SUPERPY.
    SIM mode reads `/iuf/kgi/sim_person_id` and `/iuf/kgi/sim_person_pwd` by default.

.PARAMETER KgiPersonIdSsmPath
    Optional override for the SSM SecureString that stores the person ID.
    Leave blank to use the SIM/live default based on -KgiSimulation.

.PARAMETER KgiPersonPwdSsmPath
    Optional override for the SSM SecureString that stores the password.
    Leave blank to use the SIM/live default based on -KgiSimulation.

.PARAMETER AutoLogin
    When $true (default), the gateway logs in on service startup using the env vars
    written by this install script. Read-only mode remains enabled.

.NOTES
    - NEVER hard-code KGI_PERSON_ID / KGI_PERSON_PWD in this file.
    - Assumes AWS CLI is configured with IAM role (instance profile preferred).
    - Run as Administrator.
    - Log file: C:\kgi-gateway-logs\install.log
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$DryRun,
    [string]$SourceDir    = "",
    [string]$GatewayInstallDir = "C:\kgi-gateway",
    [switch]$UseSSM = $true,
    [bool]$KgiSimulation = $true,
    [string]$KgiPersonIdSsmPath = "",
    [string]$KgiPersonPwdSsmPath = "",
    [bool]$AutoLogin = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
$LogDir  = "C:\kgi-gateway-logs"
$LogFile = "$LogDir\install.log"

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts  = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
    $line = "[$ts] [$Level] $Message"
    Write-Host $line
    if (-not $DryRun) {
        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line
    }
}

function Write-Info  { param([string]$m) Write-Log "INFO " $m }
function Write-Warn  { param([string]$m) Write-Log "WARN " $m }
function Write-Err   { param([string]$m) Write-Log "ERROR" $m }

function Convert-BoolToEnv {
    param([bool]$Value)
    if ($Value) { return "true" }
    return "false"
}

if (-not $KgiPersonIdSsmPath) {
    $KgiPersonIdSsmPath = if ($KgiSimulation) { "/iuf/kgi/sim_person_id" } else { "/iuf/kgi/person_id" }
}
if (-not $KgiPersonPwdSsmPath) {
    $KgiPersonPwdSsmPath = if ($KgiSimulation) { "/iuf/kgi/sim_person_pwd" } else { "/iuf/kgi/person_pwd" }
}

if (-not $SourceDir) {
    $SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} elseif (Test-Path $SourceDir) {
    $SourceDir = (Resolve-Path $SourceDir).Path
}

# ---------------------------------------------------------------------------
# Dry-run wrapper
# ---------------------------------------------------------------------------
function Invoke-Action {
    param([string]$Description, [scriptblock]$Action)
    if ($DryRun) {
        Write-Info "[DRY-RUN] SKIP: $Description"
    } else {
        Write-Info "EXEC: $Description"
        & $Action
    }
}

# ---------------------------------------------------------------------------
# 0. Preflight
# ---------------------------------------------------------------------------
Write-Info "========================================"
Write-Info "KGI Gateway EC2 Install Script"
Write-Info "DryRun=$DryRun  SourceDir=$SourceDir  InstallDir=$GatewayInstallDir"
Write-Info "KgiSimulation=$KgiSimulation  AutoLogin=$AutoLogin  UseSSM=$UseSSM"
if ($UseSSM) {
    Write-Info "Credential SSM paths: person_id=$KgiPersonIdSsmPath person_pwd=$KgiPersonPwdSsmPath"
}
Write-Info "========================================"

if (-not $DryRun) {
    $currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    $isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Err "Script must run as Administrator. Re-launch with elevated PowerShell."
        exit 1
    }
}

# Verify SourceDir contains app.py (skipped in dry-run — SourceDir may not exist on local machine)
if (-not $DryRun) {
    if (-not (Test-Path "$SourceDir\app.py")) {
        Write-Err "SourceDir '$SourceDir' does not contain app.py. Check -SourceDir parameter."
        exit 1
    }
} else {
    if (-not (Test-Path "$SourceDir\app.py")) {
        Write-Info "[DRY-RUN] Note: SourceDir '$SourceDir' does not contain app.py — ok in dry-run (pass -SourceDir on EC2)"
    }
}

# ---------------------------------------------------------------------------
# 1. Python 3.11 install / verify
# ---------------------------------------------------------------------------
Write-Info "--- Step 1: Python 3.11 ---"

$pythonExe = $null
$pythonCandidates = @(
    "C:\Python311\python.exe",
    "C:\Program Files\Python311\python.exe",
    "C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe"
)

foreach ($candidate in $pythonCandidates) {
    if (Test-Path $candidate) { $pythonExe = $candidate; break }
}
if ($null -eq $pythonExe) {
    $tryPy = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $tryPy) {
        $ver = & python --version 2>&1
        if ($ver -match "3\.11") { $pythonExe = $tryPy.Source }
    }
}

if ($null -ne $pythonExe) {
    Write-Info "Python 3.11 found: $pythonExe"
} else {
    Write-Info "Python 3.11 not found — installing via winget..."
    Invoke-Action "winget install Python 3.11" {
        # winget: package ID for Python 3.11 on Windows
        $result = winget install --id Python.Python.3.11 --silent --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "winget returned $LASTEXITCODE. Falling back to direct MSI download..."
            $msiUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
            $msiPath = "$env:TEMP\python-3.11.9-amd64.exe"
            Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
            Start-Process -Wait -FilePath $msiPath -ArgumentList "/quiet", "PrependPath=1", "Include_test=0"
            Remove-Item $msiPath -Force
        }
    }
    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $pyCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $pyCmd) { $pythonExe = $pyCmd.Source }
    if ($null -eq $pythonExe) {
        Write-Err "Python install failed — python.exe not found after install."
        exit 1
    }
    Write-Info "Python installed: $pythonExe"
}

# ---------------------------------------------------------------------------
# 2. pip verify
# ---------------------------------------------------------------------------
Write-Info "--- Step 2: pip verify ---"
Invoke-Action "python -m pip --version" {
    $pipVer = & $pythonExe -m pip --version 2>&1
    Write-Info "pip: $pipVer"
}

# ---------------------------------------------------------------------------
# 3. Visual C++ Runtime (Win Server 2022 sometimes missing)
# ---------------------------------------------------------------------------
Write-Info "--- Step 3: Visual C++ Runtime ---"

$vcInstalled = Get-ItemProperty HKLM:\SOFTWARE\Microsoft\VisualStudio\*\VC\Runtimes\x64 -ErrorAction SilentlyContinue |
               Where-Object { $_.Version -ge "14.0" }
if ($vcInstalled) {
    Write-Info "Visual C++ Runtime 2015-2022 already present."
} else {
    Write-Info "Visual C++ Runtime not detected — installing..."
    Invoke-Action "Install VC++ Runtime" {
        $vcUrl  = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
        $vcPath = "$env:TEMP\vc_redist.x64.exe"
        Invoke-WebRequest -Uri $vcUrl -OutFile $vcPath -UseBasicParsing
        Start-Process -Wait -FilePath $vcPath -ArgumentList "/quiet", "/norestart"
        Remove-Item $vcPath -Force
    }
}

# ---------------------------------------------------------------------------
# 4. Copy gateway source to install dir
# ---------------------------------------------------------------------------
Write-Info "--- Step 4: Copy gateway source ---"
Invoke-Action "Create install dir + copy files" {
    if (-not (Test-Path $GatewayInstallDir)) {
        New-Item -ItemType Directory -Path $GatewayInstallDir -Force | Out-Null
    }
    # Copy all .py files, schemas, config, errMsg.ini — no tests/deploy/scripts
    $filesToCopy = @(
        "app.py", "config.py", "kgi_session.py", "kgi_quote.py",
        "kgi_kbar.py", "kgi_events.py", "read_only_guard.py",
        "schemas.py", "errMsg.ini"
    )
    foreach ($f in $filesToCopy) {
        $src = Join-Path $SourceDir $f
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination $GatewayInstallDir -Force
            Write-Info "  Copied: $f"
        } else {
            Write-Warn "  Missing expected file: $f"
        }
    }
    # requirements.txt (may live in SourceDir root)
    $reqSrc = Join-Path $SourceDir "requirements.txt"
    if (Test-Path $reqSrc) {
        Copy-Item -Path $reqSrc -Destination $GatewayInstallDir -Force
        Write-Info "  Copied: requirements.txt"
    } else {
        Write-Warn "  requirements.txt not found in SourceDir — will install known packages directly"
    }
}

# ---------------------------------------------------------------------------
# 5. pip install
# ---------------------------------------------------------------------------
Write-Info "--- Step 5: pip install ---"
Invoke-Action "pip install gateway dependencies" {
    $reqFile = Join-Path $GatewayInstallDir "requirements.txt"
    if (Test-Path $reqFile) {
        & $pythonExe -m pip install -r $reqFile --upgrade
        if ($LASTEXITCODE -ne 0) { Write-Err "pip install -r requirements.txt failed"; exit 1 }
    } else {
        # Fallback: install known direct dependencies
        $pkgs = @("fastapi", "uvicorn[standard]", "pydantic", "websockets", "pandas")
        foreach ($pkg in $pkgs) {
            & $pythonExe -m pip install $pkg --upgrade
        }
    }
    # kgisuperpy: KGI-provided SDK
    # Install from local wheel if available, otherwise attempt PyPI
    $wheelPath = Join-Path $SourceDir "kgisuperpy*.whl"
    $wheel = Get-Item $wheelPath -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($wheel) {
        Write-Info "  Installing kgisuperpy from wheel: $($wheel.FullName)"
        & $pythonExe -m pip install $wheel.FullName --upgrade
    } else {
        Write-Info "  Installing kgisuperpy from PyPI (if available)..."
        # kgisuperpy is a proprietary KGI SDK — PyPI availability not guaranteed.
        # If this fails the operator must copy the wheel manually to $SourceDir.
        & $pythonExe -m pip install kgisuperpy --upgrade
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "  kgisuperpy not found on PyPI. Copy the KGI-provided wheel to:"
            Write-Warn "  $SourceDir\kgisuperpy*.whl  then re-run install.ps1"
        }
    }
}

# ---------------------------------------------------------------------------
# 6. Environment variables — SSM or interactive prompt
# ---------------------------------------------------------------------------
Write-Info "--- Step 6: Environment variables ---"

function Get-SsmParam {
    param([string]$Name)
    $val = & aws ssm get-parameter --name $Name --with-decryption --query "Parameter.Value" --output text 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "SSM get-parameter failed for '$Name': $val"
        return $null
    }
    return $val.Trim()
}

$envVars = @{}

if ($UseSSM) {
    Write-Info "Reading credentials from SSM Parameter Store..."
    Invoke-Action "aws ssm get-parameter KGI credentials" {
        $personIdFromSsm = Get-SsmParam $KgiPersonIdSsmPath
        $personPwdFromSsm = Get-SsmParam $KgiPersonPwdSsmPath
        if (-not $personIdFromSsm -or -not $personPwdFromSsm) {
            Write-Err "Missing KGI credential from SSM. Check SSM paths and IAM permission."
            exit 1
        }
        $envVars["KGI_PERSON_ID"]  = $personIdFromSsm.Trim().ToUpper()
        $envVars["KGI_PERSON_PWD"] = $personPwdFromSsm.Trim()
    }
    if ($DryRun) {
        $envVars["KGI_PERSON_ID"]  = "DRY_RUN_PLACEHOLDER"
        $envVars["KGI_PERSON_PWD"] = "DRY_RUN_PLACEHOLDER"
    }
} else {
    Write-Info "SSM disabled — prompting for credentials interactively..."
    if (-not $DryRun) {
        $personId  = Read-Host "Enter KGI_PERSON_ID (uppercase, e.g. A123456789)"
        $personPwd = Read-Host "Enter KGI_PERSON_PWD (electronic trading password)" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($personPwd)
        try { $plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        $envVars["KGI_PERSON_ID"]  = $personId.Trim().ToUpper()
        $envVars["KGI_PERSON_PWD"] = $plainPwd
    } else {
        $envVars["KGI_PERSON_ID"]  = "DRY_RUN_PLACEHOLDER"
        $envVars["KGI_PERSON_PWD"] = "DRY_RUN_PLACEHOLDER"
    }
}

# Non-credential vars (safe to inline)
$envVars["KGI_SIMULATION"]                  = Convert-BoolToEnv $KgiSimulation
$envVars["KGI_READ_ONLY_MODE"]              = "true"
$envVars["GATEWAY_HOST"]                    = "0.0.0.0"
$envVars["GATEWAY_PORT"]                    = "8787"
$envVars["AUTO_LOGIN"]                      = Convert-BoolToEnv $AutoLogin
$envVars["KGI_GATEWAY_POSITION_DISABLED"]   = "false"
$envVars["KGI_GATEWAY_QUOTE_DISABLED"]      = "false"

Invoke-Action "Write env vars to Machine registry (system-wide)" {
    foreach ($kv in $envVars.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, "Machine")
        if ($kv.Key -in @("KGI_PERSON_ID","KGI_PERSON_PWD")) {
            Write-Info "  Set [Machine] $($kv.Key) = [REDACTED]"
        } else {
            Write-Info "  Set [Machine] $($kv.Key) = $($kv.Value)"
        }
    }
}

# ---------------------------------------------------------------------------
# 7. Smoke-test: start gateway, curl /health, stop
# ---------------------------------------------------------------------------
Write-Info "--- Step 7: Smoke test ---"
Invoke-Action "Run gateway smoke test (start → /health → stop)" {
    # Temporarily set env for this process
    foreach ($kv in $envVars.GetEnumerator()) {
        [System.Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, "Process")
    }

    $appPy   = Join-Path $GatewayInstallDir "app.py"
    $gwProc  = Start-Process -FilePath $pythonExe `
                             -ArgumentList "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8787" `
                             -WorkingDirectory $GatewayInstallDir `
                             -PassThru -WindowStyle Hidden
    Write-Info "  Gateway PID=$($gwProc.Id) — waiting 8s for startup..."
    Start-Sleep -Seconds 8

    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8787/health" -UseBasicParsing -TimeoutSec 10
        if ($resp.StatusCode -eq 200) {
            Write-Info "  /health OK 200: $($resp.Content)"
        } else {
            Write-Warn "  /health returned $($resp.StatusCode): $($resp.Content)"
        }
    } catch {
        Write-Warn "  /health failed: $_"
    } finally {
        Stop-Process -Id $gwProc.Id -Force -ErrorAction SilentlyContinue
        Write-Info "  Gateway process stopped."
    }
}

# ---------------------------------------------------------------------------
# 8. Write install_evidence.json
# ---------------------------------------------------------------------------
Write-Info "--- Step 8: Write evidence ---"
$evidenceDir  = $LogDir
$evidencePath = "$evidenceDir\install_evidence.json"

Invoke-Action "Write $evidencePath" {
    if (-not (Test-Path $evidenceDir)) { New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null }
    $pythonVersion = (& $pythonExe --version 2>&1).ToString().Trim()
    $evidence = @{
        script_version    = "1.0.0"
        timestamp         = (Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz")
        ec2_instance      = "i-0b02f62220f422349"
        public_ip         = "54.249.139.28"
        python_exe        = $pythonExe
        python_version    = $pythonVersion
        install_dir       = $GatewayInstallDir
        dry_run           = $DryRun.IsPresent
        ssm_used          = $UseSSM.IsPresent
        kgi_simulation    = $KgiSimulation
        auto_login        = $AutoLogin
        person_id_ssm_path = $KgiPersonIdSsmPath
        person_pwd_ssm_path = $KgiPersonPwdSsmPath
        env_vars_written  = ($envVars.Keys | Where-Object { $_ -notin @("KGI_PERSON_ID","KGI_PERSON_PWD") })
        smoke_test        = "see_log"
    }
    $evidence | ConvertTo-Json -Depth 5 | Set-Content -Path $evidencePath -Encoding UTF8
    Write-Info "  Evidence written: $evidencePath"
}

Write-Info "========================================"
Write-Info "Install script complete."
if ($DryRun) { Write-Info "DRY-RUN mode — no changes were made." }
Write-Info "Next step: run nssm_install.ps1 to register as Windows service."
Write-Info "========================================"
