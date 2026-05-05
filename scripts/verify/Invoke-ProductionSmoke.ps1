#Requires -Version 5.1
<#
.SYNOPSIS
    IUF Trading Room — Production Smoke Harness v1.0
    Bruce (verifier-release-bruce) | 2026-05-05

.DESCRIPTION
    12-item production smoke + 14 stop-line checks.
    Designed to catch ETL/data-freshness failures (K-line incident, 2026-05-05)
    not just HTTP 200/4xx. First baseline run EXPECTED to fail items 4/5/6/8/9.

.PARAMETER Watch
    If specified, loops every 60 seconds and appends results to the evidence file.
    Useful for monitoring Jason's F1-F4 fixes in real time.

.PARAMETER BaseUrl
    API base URL. Defaults to https://api.eycvector.com

.PARAMETER Email
    Login email. Defaults to qazabc159@gmail.com

.PARAMETER Password
    Login password. Defaults to qazabc159

.EXAMPLE
    .\scripts\verify\Invoke-ProductionSmoke.ps1
    .\scripts\verify\Invoke-ProductionSmoke.ps1 -Watch
    .\scripts\verify\Invoke-ProductionSmoke.ps1 -BaseUrl https://api.eycvector.com

.NOTES
    Stop-lines enforced:
        SL-01 broker_token not in any 200 body
        SL-02 api_key not in any 200 body
        SL-03 kgi_session not in any 200 body
        SL-04 "Railway" not in any 200 body (env var leak)
        SL-05 "password" not in any 200 body
        SL-06 "secret" not in any 200 body
        SL-07 source==mock in prod = VIOLATION
        SL-08 POST /order/create must not return 200 (KGI FROZEN, must 409)
        SL-09 iuf_session cookie value never printed to stdout
        SL-10 cookie length only — no full value
        SL-11 kbar state!=LIVE is FAIL
        SL-12 kbar rows.length==0 is FAIL
        SL-13 kbar date stale >2 days is FAIL
        SL-14 briefs date stale >2 days is FAIL
#>

[CmdletBinding()]
param(
    [switch]$Watch,
    [string]$BaseUrl = "https://api.eycvector.com",
    [string]$Email = $env:IUF_TEST_EMAIL,
    [string]$Password = $env:IUF_TEST_PASSWORD
)

if (-not $Email -or -not $Password) {
    Write-Error "Missing credentials. Set `$env:IUF_TEST_EMAIL and `$env:IUF_TEST_PASSWORD before running, or pass -Email and -Password explicitly. Hardcoding credentials in this script is forbidden by stop-line #14."
    exit 1
}

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Constants ────────────────────────────────────────────────────────────────
$SCRIPT_VERSION   = "1.0.0"
$TODAY            = (Get-Date).Date
$STALE_THRESHOLD  = $TODAY.AddDays(-2)
$EVIDENCE_DIR     = "evidence\w7_paper_sprint"
$HARNESS_DOC      = "$EVIDENCE_DIR\bruce_powershell_smoke_harness_2026-05-05.md"

# Stop-line sensitive string patterns (must NOT appear in any 200 response body)
$STOP_LINE_PATTERNS = @(
    "broker_token",
    "api_key",
    "kgi_session",
    "Railway",
    "password",
    "secret"
)

# ── State ────────────────────────────────────────────────────────────────────
$script:passCount      = 0
$script:failCount      = 0
$script:warnCount      = 0
$script:stopLinesHit   = 0
$script:lines          = [System.Collections.Generic.List[string]]::new()
$script:runTs          = Get-Date -Format "yyyyMMdd-HHmm"

# ── Helpers ──────────────────────────────────────────────────────────────────
function Out {
    param([string]$msg)
    Write-Host $msg
    $script:lines.Add($msg)
}

function Pass {
    param([string]$itemId, [string]$desc, [string]$extra = "")
    $line = "[PASS] $itemId $desc"
    if ($extra) { $line += " | $extra" }
    Out $line
    $script:passCount++
}

function Fail {
    param([string]$itemId, [string]$desc, [string]$extra = "")
    $line = "[FAIL] $itemId $desc"
    if ($extra) { $line += " | $extra" }
    Out $line
    $script:failCount++
}

function Warn {
    param([string]$itemId, [string]$desc, [string]$extra = "")
    $line = "[WARN] $itemId $desc"
    if ($extra) { $line += " | $extra" }
    Out $line
    $script:warnCount++
}

function StopLine {
    param([string]$slId, [string]$desc)
    $line = "[STOP-LINE] $slId $desc"
    Out $line
    $script:stopLinesHit++
    $script:failCount++
}

function CheckBody {
    param([string]$itemId, [string]$body)
    foreach ($pat in $STOP_LINE_PATTERNS) {
        if ($body -match $pat) {
            StopLine $itemId "body contains forbidden string '$pat'"
        }
    }
}

function SafeGet {
    param([string]$uri, [object]$webSession)
    try {
        if ($webSession) {
            return Invoke-WebRequest -Uri $uri -Method GET -WebSession $webSession -UseBasicParsing -ErrorAction Stop
        } else {
            return Invoke-WebRequest -Uri $uri -Method GET -UseBasicParsing -ErrorAction Stop
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        return [PSCustomObject]@{ StatusCode = $statusCode; Content = $null; Error = $_.ToString() }
    }
}

function SafePost {
    param([string]$uri, [string]$bodyJson, [object]$webSession)
    try {
        if ($webSession) {
            return Invoke-WebRequest -Uri $uri -Method POST -ContentType "application/json" -Body $bodyJson -WebSession $webSession -UseBasicParsing -ErrorAction Stop
        } else {
            return Invoke-WebRequest -Uri $uri -Method POST -ContentType "application/json" -Body $bodyJson -UseBasicParsing -ErrorAction Stop
        }
    } catch {
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        return [PSCustomObject]@{ StatusCode = $statusCode; Content = $null; Error = $_.ToString() }
    }
}

function ParseDate {
    param([string]$dateStr)
    if (-not $dateStr) { return $null }
    try {
        # Handle ISO 8601 and plain YYYY-MM-DD
        return [datetime]::Parse($dateStr.Substring(0, 10))
    } catch {
        return $null
    }
}

# ── Main smoke run ────────────────────────────────────────────────────────────
function Invoke-SmokeRun {
    $runStart = Get-Date
    $script:passCount    = 0
    $script:failCount    = 0
    $script:warnCount    = 0
    $script:stopLinesHit = 0
    $script:runTs        = Get-Date -Format "yyyyMMdd-HHmm"

    Out ""
    Out "================================================================"
    Out "IUF Production Smoke Harness v$SCRIPT_VERSION"
    Out "Run: $($runStart.ToString('yyyy-MM-dd HH:mm:ss')) TST"
    Out "Target: $BaseUrl"
    Out "Today threshold: $($TODAY.ToString('yyyy-MM-dd')) | Stale if before: $($STALE_THRESHOLD.ToString('yyyy-MM-dd'))"
    Out "================================================================"
    Out ""

    # ── Item 1: POST /auth/login — get session cookie ─────────────────────────
    Out "--- Item-1: POST /auth/login ---"
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $loginBody = "{`"email`":`"$Email`",`"password`":`"$Password`"}"
    $r1 = SafePost "$BaseUrl/auth/login" $loginBody $session

    if ($r1.StatusCode -eq 200) {
        # Check cookie (never print value — SL-09/10)
        $cookie = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "iuf_session" }
        if ($cookie) {
            Pass "item-1" "POST /auth/login" "HTTP 200 | cookie=iuf_session | len=$($cookie.Value.Length) [REDACTED]"
            # Stop-line body check on login response
            if ($r1.Content) { CheckBody "item-1" $r1.Content }
        } else {
            Fail "item-1" "POST /auth/login" "HTTP 200 but iuf_session cookie MISSING"
        }
    } else {
        Fail "item-1" "POST /auth/login" "HTTP $($r1.StatusCode) | $($r1.Error)"
    }
    Out ""

    # Abort remaining authenticated checks if no session
    $authed = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "iuf_session" }
    if (-not $authed) {
        Out "[FATAL] No iuf_session — skipping all authenticated items"
        Out ""
        $script:failCount += 11  # items 2-12 all fail
        Summarize $runStart
        return
    }

    # ── Item 2: GET /health ───────────────────────────────────────────────────
    Out "--- Item-2: GET /health ---"
    $r2 = SafeGet "$BaseUrl/health" $null
    if ($r2.StatusCode -eq 200 -and $r2.Content) {
        $j2 = $r2.Content | ConvertFrom-Json
        $status = $j2.status
        $uptime = $j2.uptime
        if ($status -eq "ok") {
            Pass "item-2" "GET /health" "status=$status | uptime=$uptime"
        } else {
            Fail "item-2" "GET /health" "status=$status (expected ok)"
        }
        CheckBody "item-2" $r2.Content
    } else {
        Fail "item-2" "GET /health" "HTTP $($r2.StatusCode) | $($r2.Error)"
    }
    Out ""

    # ── Item 3: GET /api/v1/companies/2330 ───────────────────────────────────
    Out "--- Item-3: GET /api/v1/companies/2330 ---"
    $r3 = SafeGet "$BaseUrl/api/v1/companies/2330" $session
    if ($r3.StatusCode -eq 200 -and $r3.Content) {
        $j3 = $r3.Content | ConvertFrom-Json
        $dataId = $j3.data.id
        if ($dataId) {
            Pass "item-3" "GET /api/v1/companies/2330" "data.id=$dataId"
        } else {
            Fail "item-3" "GET /api/v1/companies/2330" "data.id MISSING in response"
        }
        CheckBody "item-3" $r3.Content
    } else {
        Fail "item-3" "GET /api/v1/companies/2330" "HTTP $($r3.StatusCode) | $($r3.Error)"
    }
    Out ""

    # ── Item 4: GET /api/v1/companies/2330/kbar?freq=1d ─────────────────────
    # FAIL if: state!=LIVE OR rows.length==0 OR date < today-2
    Out "--- Item-4: GET /api/v1/companies/2330/kbar?freq=1d ---"
    $r4 = SafeGet "$BaseUrl/api/v1/companies/2330/kbar?freq=1d" $session
    if ($r4.StatusCode -eq 200 -and $r4.Content) {
        $j4 = $r4.Content | ConvertFrom-Json
        $kstate  = $j4.state
        $rows    = $j4.rows
        $kdate   = $j4.date
        $rowCount = if ($rows) { $rows.Count } else { 0 }
        $parsedDate = ParseDate $kdate

        $i4Fail = $false
        $reasons = @()

        if ($kstate -ne "LIVE") {
            $reasons += "state=$kstate (expected LIVE) [SL-11]"
            $i4Fail = $true
        }
        if ($rowCount -eq 0) {
            $reasons += "rows.length=0 [SL-12]"
            $i4Fail = $true
        }
        if ($parsedDate -and $parsedDate -lt $STALE_THRESHOLD) {
            $reasons += "date=$kdate stale (< $($STALE_THRESHOLD.ToString('yyyy-MM-dd'))) [SL-13]"
            $i4Fail = $true
        }
        if (-not $parsedDate) {
            $reasons += "date='$kdate' unparseable [SL-13]"
            $i4Fail = $true
        }

        if ($i4Fail) {
            Fail "item-4" "GET kbar?freq=1d" ($reasons -join " | ")
        } else {
            Pass "item-4" "GET kbar?freq=1d" "state=$kstate | rows=$rowCount | date=$kdate"
        }
        CheckBody "item-4" $r4.Content
    } else {
        Fail "item-4" "GET kbar?freq=1d" "HTTP $($r4.StatusCode) | $($r4.Error)"
    }
    Out ""

    # ── Item 5: GET /api/v1/companies/2330/ohlcv ─────────────────────────────
    # FAIL if any entry has source==mock
    Out "--- Item-5: GET /api/v1/companies/2330/ohlcv ---"
    $r5 = SafeGet "$BaseUrl/api/v1/companies/2330/ohlcv" $session
    if ($r5.StatusCode -eq 200 -and $r5.Content) {
        # Check for mock source using string scan first (fast path)
        $mockHit = $r5.Content -match '"source"\s*:\s*"mock"'
        if ($mockHit) {
            # Confirm via parsed JSON
            $j5 = $r5.Content | ConvertFrom-Json
            $data5 = if ($j5.data) { $j5.data } else { $j5 }
            $mockEntries = @()
            if ($data5 -is [array]) {
                $mockEntries = $data5 | Where-Object { $_.source -eq "mock" }
            }
            $mockCount = $mockEntries.Count
            StopLine "item-5/SL-07" "GET /ohlcv: $mockCount entries have source=mock (stop-line violation — mock pretending live in prod)"
        } else {
            $j5 = $r5.Content | ConvertFrom-Json
            $data5 = if ($j5.data) { $j5.data } else { $j5 }
            $entryCount = if ($data5 -is [array]) { $data5.Count } else { 0 }
            Pass "item-5" "GET /api/v1/companies/2330/ohlcv" "HTTP 200 | entries=$entryCount | no source=mock"
        }
        CheckBody "item-5" ($r5.Content -replace '"source"\s*:\s*"mock"', '"source":"[REDACTED-mock-hit]"')
    } else {
        Fail "item-5" "GET /api/v1/companies/2330/ohlcv" "HTTP $($r5.StatusCode) | $($r5.Error)"
    }
    Out ""

    # ── Item 6: GET /api/v1/diagnostics/finmind ──────────────────────────────
    # FAIL if inProcess.requestCount==0 for >1h after deploy, or ohlcvSource==mock
    Out "--- Item-6: GET /api/v1/diagnostics/finmind ---"
    $r6 = SafeGet "$BaseUrl/api/v1/diagnostics/finmind" $session
    if ($r6.StatusCode -eq 200 -and $r6.Content) {
        $j6 = $r6.Content | ConvertFrom-Json
        # Navigate common response shapes: data.inProcess or direct fields
        $d6 = if ($j6.data) { $j6.data } else { $j6 }
        $reqCount   = if ($d6.inProcess) { $d6.inProcess.requestCount } else { $d6.requestCount }
        $ohlcvSrc   = if ($d6.ohlcvSource) { $d6.ohlcvSource } else { $d6.source }
        $lastFetch  = if ($d6.lastFetchTs) { $d6.lastFetchTs } else { $d6.lastFetch }

        $i6Fail = $false
        $reasons6 = @()

        if ($null -eq $reqCount -or $reqCount -eq 0) {
            $reasons6 += "inProcess.requestCount=0 (ETL never called FinMind API — smoking gun)"
            $i6Fail = $true
        }
        if ($ohlcvSrc -eq "mock") {
            $reasons6 += "ohlcvSource=mock [SL-07]"
            $i6Fail = $true
        }

        if ($i6Fail) {
            Fail "item-6" "GET /api/v1/diagnostics/finmind" ($reasons6 -join " | ")
        } else {
            Pass "item-6" "GET /api/v1/diagnostics/finmind" "requestCount=$reqCount | ohlcvSource=$ohlcvSrc | lastFetch=$lastFetch"
        }
        CheckBody "item-6" $r6.Content
    } elseif ($r6.StatusCode -eq 404) {
        Warn "item-6" "GET /api/v1/diagnostics/finmind" "404 — endpoint not deployed yet (PR #182 pending?)"
    } else {
        Fail "item-6" "GET /api/v1/diagnostics/finmind" "HTTP $($r6.StatusCode) | $($r6.Error)"
    }
    Out ""

    # ── Item 7: GET /api/v1/data-sources/finmind/status ─────────────────────
    Out "--- Item-7: GET /api/v1/data-sources/finmind/status ---"
    $r7 = SafeGet "$BaseUrl/api/v1/data-sources/finmind/status" $session
    if ($r7.StatusCode -eq 200 -and $r7.Content) {
        $j7 = $r7.Content | ConvertFrom-Json
        $d7 = if ($j7.data) { $j7.data } else { $j7 }
        $fmState = $d7.state
        if ($fmState -eq "LIVE_READY") {
            Pass "item-7" "GET /api/v1/data-sources/finmind/status" "state=$fmState"
        } else {
            Fail "item-7" "GET /api/v1/data-sources/finmind/status" "state=$fmState (expected LIVE_READY)"
        }
        CheckBody "item-7" $r7.Content
    } else {
        Fail "item-7" "GET /api/v1/data-sources/finmind/status" "HTTP $($r7.StatusCode) | $($r7.Error)"
    }
    Out ""

    # ── Item 8: GET /api/v1/briefs ────────────────────────────────────────────
    # FAIL if data[0].date < today-2
    Out "--- Item-8: GET /api/v1/briefs ---"
    $r8 = SafeGet "$BaseUrl/api/v1/briefs" $session
    if ($r8.StatusCode -eq 200 -and $r8.Content) {
        $j8 = $r8.Content | ConvertFrom-Json
        $briefs = if ($j8.data) { $j8.data } else { $j8 }
        if ($briefs -is [array] -and $briefs.Count -gt 0) {
            $latestDate = ParseDate $briefs[0].date
            if ($latestDate -and $latestDate -lt $STALE_THRESHOLD) {
                Fail "item-8" "GET /api/v1/briefs" "data[0].date=$($briefs[0].date) stale (< $($STALE_THRESHOLD.ToString('yyyy-MM-dd'))) [SL-14]"
            } elseif ($latestDate) {
                Pass "item-8" "GET /api/v1/briefs" "count=$($briefs.Count) | latest=$($briefs[0].date)"
            } else {
                Fail "item-8" "GET /api/v1/briefs" "data[0].date='$($briefs[0].date)' unparseable"
            }
        } else {
            Fail "item-8" "GET /api/v1/briefs" "data is empty or not array — no briefs produced"
        }
        CheckBody "item-8" $r8.Content
    } else {
        Fail "item-8" "GET /api/v1/briefs" "HTTP $($r8.StatusCode) | $($r8.Error)"
    }
    Out ""

    # ── Item 9: GET /api/v1/openalice/observability ───────────────────────────
    # FAIL if workerStatus!=healthy OR (queuedJobs==0 AND terminalJobs>100)
    Out "--- Item-9: GET /api/v1/openalice/observability ---"
    $r9 = SafeGet "$BaseUrl/api/v1/openalice/observability" $session
    if ($r9.StatusCode -eq 200 -and $r9.Content) {
        $j9 = $r9.Content | ConvertFrom-Json
        $d9 = if ($j9.data) { $j9.data } else { $j9 }
        $workerStatus  = $d9.workerStatus
        $queuedJobs    = [int]($d9.queuedJobs)
        $terminalJobs  = [int]($d9.terminalJobs)

        $i9Fail = $false
        $reasons9 = @()

        if ($workerStatus -ne "healthy") {
            $reasons9 += "workerStatus=$workerStatus (expected healthy)"
            $i9Fail = $true
        }
        # Dispatcher-dead heuristic: heartbeat=healthy but no new work, all jobs are historical
        if ($queuedJobs -eq 0 -and $terminalJobs -gt 100) {
            $reasons9 += "queuedJobs=0 AND terminalJobs=$terminalJobs — dispatcher likely dead (false-healthy pattern from K-line incident)"
            $i9Fail = $true
        }

        if ($i9Fail) {
            Fail "item-9" "GET /api/v1/openalice/observability" ($reasons9 -join " | ")
        } else {
            Pass "item-9" "GET /api/v1/openalice/observability" "workerStatus=$workerStatus | queuedJobs=$queuedJobs | terminalJobs=$terminalJobs"
        }
        CheckBody "item-9" $r9.Content
    } else {
        Fail "item-9" "GET /api/v1/openalice/observability" "HTTP $($r9.StatusCode) | $($r9.Error)"
    }
    Out ""

    # ── Item 10: GET /api/v1/paper/fills ──────────────────────────────────────
    Out "--- Item-10: GET /api/v1/paper/fills ---"
    $r10 = SafeGet "$BaseUrl/api/v1/paper/fills" $session
    if ($r10.StatusCode -eq 200) {
        Pass "item-10" "GET /api/v1/paper/fills" "HTTP 200"
        if ($r10.Content) { CheckBody "item-10" $r10.Content }
    } else {
        Fail "item-10" "GET /api/v1/paper/fills" "HTTP $($r10.StatusCode) | $($r10.Error)"
    }
    Out ""

    # ── Item 11: GET /api/v1/paper/portfolio ──────────────────────────────────
    Out "--- Item-11: GET /api/v1/paper/portfolio ---"
    $r11 = SafeGet "$BaseUrl/api/v1/paper/portfolio" $session
    if ($r11.StatusCode -eq 200) {
        Pass "item-11" "GET /api/v1/paper/portfolio" "HTTP 200"
        if ($r11.Content) { CheckBody "item-11" $r11.Content }
    } else {
        Fail "item-11" "GET /api/v1/paper/portfolio" "HTTP $($r11.StatusCode) | $($r11.Error)"
    }
    Out ""

    # ── Item 12: GET /api/v1/paper/orders ────────────────────────────────────
    Out "--- Item-12: GET /api/v1/paper/orders ---"
    $r12 = SafeGet "$BaseUrl/api/v1/paper/orders" $session
    if ($r12.StatusCode -eq 200) {
        Pass "item-12" "GET /api/v1/paper/orders" "HTTP 200"
        if ($r12.Content) { CheckBody "item-12" $r12.Content }
    } else {
        Fail "item-12" "GET /api/v1/paper/orders" "HTTP $($r12.StatusCode) | $($r12.Error)"
    }
    Out ""

    # ── SL-08: POST /order/create must NOT return 200 ────────────────────────
    Out "--- SL-08: POST /order/create (KGI FROZEN gate) ---"
    $slBody = '{"symbol":"2330","side":"buy","qty":1}'
    $rSL = SafePost "$BaseUrl/order/create" $slBody $session
    if ($rSL.StatusCode -eq 200) {
        StopLine "SL-08" "POST /order/create returned 200 — KGI FROZEN gate broken! Expected 409 NOT_ENABLED"
    } elseif ($rSL.StatusCode -eq 409 -or $rSL.StatusCode -eq 404 -or $rSL.StatusCode -eq 403 -or $rSL.StatusCode -eq 401) {
        Pass "SL-08" "POST /order/create" "HTTP $($rSL.StatusCode) (not 200 — gate holding)"
    } else {
        Warn "SL-08" "POST /order/create" "HTTP $($rSL.StatusCode) — unexpected but not 200 | $($rSL.Error)"
    }
    Out ""

    Summarize $runStart
}

function Summarize {
    param([datetime]$runStart)
    $elapsed = ((Get-Date) - $runStart).TotalSeconds
    $total   = $script:passCount + $script:failCount

    Out "================================================================"
    Out "OVERALL SUMMARY"
    Out "================================================================"
    $verdict = if ($script:failCount -eq 0 -and $script:stopLinesHit -eq 0) { "PASS" } else { "FAIL" }
    Out "OVERALL: $verdict | passed=$($script:passCount) | failed=$($script:failCount) | warned=$($script:warnCount) | stop-lines triggered=$($script:stopLinesHit) | elapsed=$([Math]::Round($elapsed,1))s"
    Out ""
    if ($verdict -eq "FAIL") {
        Out "ACTION REQUIRED:"
        Out "  - Data freshness failures -> Jason F1-F4 (see kline_incident_root_cause_2026-05-05.md)"
        Out "  - Stop-line violations -> Escalate to Elva immediately"
        Out "  - Paper route 404/403 -> Jason paper-sprint fixes"
    } else {
        Out "ALL CHECKS PASS — safe to declare live / collect as baseline"
    }
    Out "================================================================"
}

# ── Evidence file writer ──────────────────────────────────────────────────────
function Write-Evidence {
    param([string]$runLabel, [bool]$isAppend = $false)

    $runFile = "$EVIDENCE_DIR\bruce_smoke_run_$($script:runTs).md"

    # Build run block
    $block = @"

## Smoke Run: $runLabel

``````
$($script:lines -join "`n")
``````

"@

    # Write run-specific evidence file
    if ($isAppend) {
        Add-Content -Path $runFile -Value $block -Encoding UTF8
    } else {
        Set-Content -Path $runFile -Value "# Bruce Production Smoke — Run $runLabel`n$block" -Encoding UTF8
    }
    Write-Host ""
    Write-Host "Run evidence: $runFile"
    return $runFile
}

function Write-HarnessDoc {
    param([string]$firstRunFile)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $content = @"
# Bruce PowerShell Smoke Harness — 2026-05-05

**Script:** ``scripts\verify\Invoke-ProductionSmoke.ps1``
**Version:** $SCRIPT_VERSION
**Authored:** Bruce (verifier-release-bruce), $ts TST
**Motivation:** K-line incident root cause — ETL dead 6-10 days, Bash-dead Bruce had 0 detection capability.
**First baseline run evidence:** $firstRunFile

---

## Design

### 12 Test Items

| # | Endpoint | Key assertion |
|---|---|---|
| 1 | POST /auth/login | Cookie present, len>0, value REDACTED |
| 2 | GET /health | status==ok, uptime parseable |
| 3 | GET /api/v1/companies/2330 | data.id present |
| 4 | GET /api/v1/companies/2330/kbar?freq=1d | state==LIVE AND rows>0 AND date>=today-2 |
| 5 | GET /api/v1/companies/2330/ohlcv | no entry has source==mock |
| 6 | GET /api/v1/diagnostics/finmind | requestCount>0 AND ohlcvSource!=mock |
| 7 | GET /api/v1/data-sources/finmind/status | state==LIVE_READY |
| 8 | GET /api/v1/briefs | data[0].date >= today-2 |
| 9 | GET /api/v1/openalice/observability | workerStatus==healthy AND NOT (queuedJobs==0 AND terminalJobs>100) |
| 10 | GET /api/v1/paper/fills | HTTP 200 |
| 11 | GET /api/v1/paper/portfolio | HTTP 200 |
| 12 | GET /api/v1/paper/orders | HTTP 200 |

### 14 Stop-Lines

| SL | Pattern | Trigger |
|---|---|---|
| SL-01 | broker_token in body | Security leak |
| SL-02 | api_key in body | Security leak |
| SL-03 | kgi_session in body | Security leak |
| SL-04 | Railway in body | Env var leak |
| SL-05 | password in body | Security leak |
| SL-06 | secret in body | Security leak |
| SL-07 | source==mock in prod | ETL dead / mock pretending live |
| SL-08 | POST /order/create returns 200 | KGI FROZEN gate broken |
| SL-09/10 | Cookie value printed | Internal — enforced by script design |
| SL-11 | kbar state!=LIVE | ETL not live |
| SL-12 | kbar rows.length==0 | ETL not writing |
| SL-13 | kbar date stale >2d | ETL frozen |
| SL-14 | briefs date stale >2d | Scheduler dead |

### Usage

``````powershell
# One-shot run (from repo root)
.\scripts\verify\Invoke-ProductionSmoke.ps1

# Watch mode — loop every 60s, append to evidence file
.\scripts\verify\Invoke-ProductionSmoke.ps1 -Watch

# Custom URL
.\scripts\verify\Invoke-ProductionSmoke.ps1 -BaseUrl https://staging.eycvector.com
``````

### Acceptance Criteria

- **Baseline (pre-fix):** FAIL — at minimum items 4/5/6/8/9 must fail given K-line incident state
- **Post-fix (Jason F1-F4):** 12/12 PASS, 0 stop-lines

---

## Run History

"@

    Set-Content -Path $HARNESS_DOC -Value $content -Encoding UTF8
    Write-Host "Harness doc: $HARNESS_DOC"
}

# ── Entry point ───────────────────────────────────────────────────────────────
if ($Watch) {
    Write-Host "=== WATCH MODE: running every 60s. Ctrl+C to stop ==="
    $watchRun = 1
    while ($true) {
        $script:lines = [System.Collections.Generic.List[string]]::new()
        Invoke-SmokeRun

        $runFile = Write-Evidence "watch-$watchRun-$(Get-Date -Format 'HHmm')" ($watchRun -gt 1)

        if ($watchRun -eq 1) {
            Write-HarnessDoc $runFile
        }

        $watchRun++
        Write-Host ""
        Write-Host "Next run in 60s... (Ctrl+C to stop)"
        Start-Sleep -Seconds 60
    }
} else {
    $script:lines = [System.Collections.Generic.List[string]]::new()
    Invoke-SmokeRun

    $runFile = Write-Evidence "baseline-$(Get-Date -Format 'yyyyMMdd-HHmm')"
    Write-HarnessDoc $runFile
}
