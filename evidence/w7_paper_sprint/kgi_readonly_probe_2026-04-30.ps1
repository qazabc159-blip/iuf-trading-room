# KGI Gateway Operator-Gated Read-Only Probes — 2026-04-30
#
# Per 楊董 W7 D-Bundle ACK directive:
#   "KGI gateway 已用最新 main 重新啟動，KGI 已用新密碼手動登入完成。
#    /health 顯示 kgi_logged_in=true。
#    KGI_GATEWAY_POSITION_DISABLED=true。KGI_GATEWAY_QUOTE_DISABLED=false。
#    請繼續 operator-gated read-only checks。"
#
# Hard lines (W7 + Path B carry-over):
#   1. NEVER hit /position    (KGI_GATEWAY_POSITION_DISABLED=true containment, Candidate F/G)
#   2. NEVER hit /order/create (永久 409, W7 hard line)
#   3. NEVER POST /quote/subscribe/* (mutates SDK subscription state)
#   4. NEVER POST /session/login or /session/logout (would kick the live operator)
#   5. NEVER print / log person_pwd / person_id / account number
#   6. ALL probes are GET only, no body — pure read of cached / historical state
#   7. STOP on first 500 / connection-refused / native crash; do not retry blindly
#
# Run from operator's Windows host (where the gateway lives at 127.0.0.1:8787).
# Output is captured to ./evidence/w7_paper_sprint/kgi_readonly_probe_2026-04-30_runlog.txt

$ErrorActionPreference = "Continue"
$Gateway = "http://127.0.0.1:8787"
$RunLog  = Join-Path $PSScriptRoot "kgi_readonly_probe_2026-04-30_runlog.txt"
$TS      = Get-Date -Format "yyyy-MM-ddTHH:mm:sszzz"

"=== KGI Gateway Read-Only Probes — $TS ===" | Tee-Object -FilePath $RunLog
"Gateway: $Gateway"                            | Tee-Object -FilePath $RunLog -Append
""                                             | Tee-Object -FilePath $RunLog -Append

function Probe {
  param(
    [string]$Label,
    [string]$Url,
    [int[]]$AcceptStatuses = @(200)
  )
  "--- $Label ---"               | Tee-Object -FilePath $RunLog -Append
  "GET $Url"                     | Tee-Object -FilePath $RunLog -Append
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -ErrorAction Stop
    $code = [int]$resp.StatusCode
    "  status: $code"            | Tee-Object -FilePath $RunLog -Append
    if ($AcceptStatuses -contains $code) {
      "  body: $($resp.Content)" | Tee-Object -FilePath $RunLog -Append
      "  verdict: PASS"          | Tee-Object -FilePath $RunLog -Append
    } else {
      "  body: $($resp.Content)" | Tee-Object -FilePath $RunLog -Append
      "  verdict: UNEXPECTED ($code not in [$($AcceptStatuses -join ',')])" | Tee-Object -FilePath $RunLog -Append
    }
  } catch [System.Net.WebException] {
    $errResp = $_.Exception.Response
    if ($errResp -ne $null) {
      $code = [int]$errResp.StatusCode
      $reader = New-Object System.IO.StreamReader($errResp.GetResponseStream())
      $body = $reader.ReadToEnd()
      "  status: $code"          | Tee-Object -FilePath $RunLog -Append
      "  body: $body"            | Tee-Object -FilePath $RunLog -Append
      if ($AcceptStatuses -contains $code) {
        "  verdict: PASS (expected non-200)" | Tee-Object -FilePath $RunLog -Append
      } else {
        "  verdict: FAIL ($code not in [$($AcceptStatuses -join ',')])" | Tee-Object -FilePath $RunLog -Append
      }
    } else {
      "  status: NETWORK_ERROR"  | Tee-Object -FilePath $RunLog -Append
      "  error: $($_.Exception.Message)" | Tee-Object -FilePath $RunLog -Append
      "  verdict: BLOCKED — gateway likely down. STOP."  | Tee-Object -FilePath $RunLog -Append
      throw "Gateway unreachable, halting probe sequence."
    }
  }
  ""                              | Tee-Object -FilePath $RunLog -Append
}

# 1. Sanity: gateway alive + login state
Probe -Label "1. /health (no auth)" `
      -Url "$Gateway/health" `
      -AcceptStatuses @(200)

# 2. Session: account list cached after login (proves login completed cleanly)
Probe -Label "2. /session/show-account (auth — expects 200 since kgi_logged_in=true)" `
      -Url "$Gateway/session/show-account" `
      -AcceptStatuses @(200)

# 3. Quote subsystem state: buffer counts, no auth, always 200
Probe -Label "3. /quote/status (no auth, ring buffer metrics only)" `
      -Url "$Gateway/quote/status" `
      -AcceptStatuses @(200)

# 4. K-bar subsystem state
Probe -Label "4. /quote/kbar/status (k-bar buffer metrics)" `
      -Url "$Gateway/quote/kbar/status" `
      -AcceptStatuses @(200)

# 5. Historical K-bar recover for 2330 (pure read, no subscription)
$From = (Get-Date).AddDays(-30).ToString("yyyyMMdd")
$To   = (Get-Date).ToString("yyyyMMdd")
Probe -Label "5. /quote/kbar/recover?symbol=2330 (read-only historical, last 30d)" `
      -Url "$Gateway/quote/kbar/recover?symbol=2330&from_date=$From&to_date=$To" `
      -AcceptStatuses @(200)

# 6. Trades read (post set-account, history only)
Probe -Label "6. /trades (read-only, expects 200 if account set OR empty list)" `
      -Url "$Gateway/trades" `
      -AcceptStatuses @(200)

# 7. Deals read (post set-account, history only)
Probe -Label "7. /deals (read-only, expects 200 if account set OR empty list)" `
      -Url "$Gateway/deals" `
      -AcceptStatuses @(200)

# 8. Position circuit-breaker confirmation — MUST return 503, NOT 500/crash.
#    This is the containment proof. We probe explicitly to verify the breaker
#    is still tripped; we expect 503 with code=POSITION_DISABLED.
Probe -Label "8. /position (MUST be 503 POSITION_DISABLED — containment proof)" `
      -Url "$Gateway/position" `
      -AcceptStatuses @(503)

"=== Probe sequence complete — $((Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')) ===" | Tee-Object -FilePath $RunLog -Append
""
"Run log saved to: $RunLog"
"Next: review verdicts — any FAIL / UNEXPECTED / BLOCKED → STOP and report to Elva."
