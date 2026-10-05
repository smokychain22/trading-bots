$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\tools\windows\ThetaProcess.Common.ps1')

function Assert-Equal($Actual, $Expected, $Name) {
  if ($Actual -ne $Expected) { throw "$Name expected $Expected, received $Actual" }
}

$now = [DateTimeOffset]::Parse('2026-10-05T19:59:24.634Z')
$maximumAgeSeconds = 45 * 60

Assert-Equal (Test-ThetaTimestampFresh -TimestampText $now.ToString('o') -Now $now `
  -MaximumAgeSeconds $maximumAgeSeconds) $true 'qualification at T'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText $now.AddSeconds(-$maximumAgeSeconds + 0.001).ToString('o') `
  -Now $now -MaximumAgeSeconds $maximumAgeSeconds) $true 'qualification at expiry minus 1ms'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText $now.AddSeconds(-$maximumAgeSeconds).ToString('o') `
  -Now $now -MaximumAgeSeconds $maximumAgeSeconds) $false 'qualification at expiry'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText $now.AddSeconds(-$maximumAgeSeconds - 0.001).ToString('o') `
  -Now $now -MaximumAgeSeconds $maximumAgeSeconds) $false 'qualification at expiry plus 1ms'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText $now.AddSeconds(5).ToString('o') -Now $now `
  -MaximumAgeSeconds $maximumAgeSeconds) $true 'bounded clock skew'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText $now.AddSeconds(5.001).ToString('o') -Now $now `
  -MaximumAgeSeconds $maximumAgeSeconds) $false 'unbounded future clock skew'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText '2026-10-05' -Now $now `
  -MaximumAgeSeconds $maximumAgeSeconds) $false 'legacy date-only sentinel'
Assert-Equal (Test-ThetaTimestampFresh -TimestampText $null -Now $now `
  -MaximumAgeSeconds $maximumAgeSeconds) $false 'missing timestamp'

$completeOpen = @([pscustomobject]@{jobType='OPPORTUNITY_SCAN';status='SUCCEEDED'})
$completeWait = @([pscustomobject]@{jobType='WAIT_RECHECK';status='SUCCEEDED'})
$riskWait = @([pscustomobject]@{jobType='WAIT_RECHECK';status='SUCCEEDED';decision='RISK_WAIT'})
$partial = @([pscustomobject]@{jobType='WAIT_RECHECK';status='DEGRADED'})
$failed = @([pscustomobject]@{jobType='OPPORTUNITY_SCAN';status='FAILED'})

Assert-Equal (Test-ThetaCompleteEvidenceScan -JobResults $completeOpen) $true 'complete OPEN scan'
Assert-Equal (Test-ThetaCompleteEvidenceScan -JobResults $completeWait) $true 'complete WAIT scan'
Assert-Equal (Test-ThetaCompleteEvidenceScan -JobResults $riskWait) $true 'complete RISK_WAIT scan'
Assert-Equal (Test-ThetaCompleteEvidenceScan -JobResults $partial) $false 'partial provider scan'
Assert-Equal (Test-ThetaCompleteEvidenceScan -JobResults $failed) $false 'failed scan'
Assert-Equal (Test-ThetaCompleteEvidenceScan -JobResults $null) $false 'missing scan result'

'PASS'
