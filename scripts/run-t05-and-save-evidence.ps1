# T05 Idempotency Race — Run test and save evidence
# Usage: powershell -ExecutionPolicy Bypass -File scripts\run-t05-and-save-evidence.ps1
# Working directory must be repo root.

$ErrorActionPreference = "Continue"
$evidenceDir = "evidence\w7_paper_sprint"
$evidenceFile = "$evidenceDir\t05_local_dryrun_2026-05-01.txt"
$testFile = "apps\api\src\__tests__\idempotency-race.test.ts"

# Ensure evidence directory exists
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null

Write-Host "=== T05 Concurrent Idempotency Race — $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ') ===" -ForegroundColor Cyan
Write-Host "Test file: $testFile"
Write-Host "Evidence:  $evidenceFile"
Write-Host ""

# Run the test, capture all output
$output = node --import tsx --test $testFile 2>&1 | Out-String

# Print to console
Write-Host $output

# Determine PASS/FAIL
$passed = $output -match "T05-B.*PASS" -or $output -match "RESULT: PASS"
$resultLine = if ($passed) { "OVERALL: PASS" } else { "OVERALL: FAIL" }

# Build evidence content
$header = @"
=== T05 Concurrent Idempotency Race Evidence ===
Run at   : $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
Test file: $testFile
Runner   : node --import tsx --test
Option   : B (in-memory domain layer, no HTTP)
Stop-line: kgi|broker.submit|live.submit|order/create = 0 functional hits

$resultLine

=== Raw Output ===
"@

$evidence = $header + $output
$evidence | Out-File -Encoding utf8 -FilePath $evidenceFile

Write-Host ""
Write-Host "Evidence saved to: $evidenceFile" -ForegroundColor Green
Write-Host $resultLine -ForegroundColor $(if ($passed) { "Green" } else { "Red" })
