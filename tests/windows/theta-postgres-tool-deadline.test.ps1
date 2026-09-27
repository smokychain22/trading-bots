#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')

function Get-ThetaNativePgTool {
  param([ValidateSet('pg_dump','pg_restore','psql')][string]$Tool)
  return (Join-Path $PSHOME 'pwsh')
}

$connection = [pscustomobject]@{
  Host='localhost'; Port='5432'; User='test'; Password='do-not-leak'; Database='test'; SslMode='disable'
}
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('theta-pg-deadline-test-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $tempRoot)
try {
  $successScript = Join-Path $tempRoot 'success.ps1'
  [IO.File]::WriteAllText($successScript, "Write-Output 'ok'`n", [Text.UTF8Encoding]::new($false))
  $success = @(Invoke-ThetaPg -Tool psql -Connection $connection -Arguments @('-NoProfile','-File',$successScript))
  if ($success.Count -ne 1 -or $success[0] -ne 'ok') { throw 'POSTGRES_TOOL_DEFAULT_DEADLINE_RESULT_INVALID' }

  $hardDeadlineScript = Join-Path $tempRoot 'hard-deadline.ps1'
  [IO.File]::WriteAllText($hardDeadlineScript, "Start-Sleep -Seconds 30`n", [Text.UTF8Encoding]::new($false))
  $timer = [Diagnostics.Stopwatch]::StartNew()
  try {
    Invoke-ThetaPg -Tool psql -Connection $connection -Arguments @('-NoProfile','-File',$hardDeadlineScript) -TimeoutSeconds 1 | Out-Null
    throw 'POSTGRES_TOOL_HARD_DEADLINE_NOT_ENFORCED'
  } catch {
    if ($_.Exception.Message -notmatch '^POSTGRES_TOOL_TIMEOUT:psql reason=HARD_DEADLINE timeoutSeconds=1\b') { throw }
  }
  $timer.Stop()
  if ($timer.Elapsed.TotalSeconds -gt 10) { throw 'POSTGRES_TOOL_HARD_DEADLINE_EXIT_TOO_SLOW' }

  $progressPath = Join-Path $tempRoot 'stalled.backup'
  $noProgressScript = Join-Path $tempRoot 'no-progress.ps1'
  [IO.File]::WriteAllText($noProgressScript,
    "[IO.File]::WriteAllBytes('$($progressPath.Replace("'", "''"))', [byte[]](1,2,3))`nStart-Sleep -Seconds 30`n",
    [Text.UTF8Encoding]::new($false))
  try {
    Invoke-ThetaPg -Tool pg_dump -Connection $connection -Arguments @('-NoProfile','-File',$noProgressScript) `
      -TimeoutSeconds 30 -ProgressFilePath $progressPath -NoProgressTimeoutSeconds 3 | Out-Null
    throw 'POSTGRES_TOOL_NO_PROGRESS_DEADLINE_NOT_ENFORCED'
  } catch {
    if ($_.Exception.Message -notmatch '^POSTGRES_TOOL_TIMEOUT:pg_dump reason=NO_PROGRESS timeoutSeconds=3 progressBytes=3\b') { throw }
  }

  $quotaScript = Join-Path $tempRoot 'quota.ps1'
  [IO.File]::WriteAllText($quotaScript,
    "[Console]::Error.WriteLine('Your project has exceeded the data transfer quota. Upgrade your plan to increase limits. password=do-not-leak')`nexit 1`n",
    [Text.UTF8Encoding]::new($false))
  try {
    Invoke-ThetaPg -Tool psql -Connection $connection -Arguments @('-NoProfile','-File',$quotaScript) -TimeoutSeconds 10 | Out-Null
    throw 'POSTGRES_TOOL_QUOTA_FAILURE_NOT_SURFACED'
  } catch {
    $message = $_.Exception.Message
    if ($message -notmatch 'class=AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED') { throw }
    if ($message -match 'do-not-leak') { throw 'POSTGRES_TOOL_DIAGNOSTIC_EXPOSED_SECRET' }
  }

  $backupSource = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\dr\Backup-Theta.ps1')
  if ($backupSource -notmatch '-NoProgressTimeoutSeconds 900') { throw 'PRODUCTION_DUMP_NO_PROGRESS_DEADLINE_NOT_WIRED' }
  if ($backupSource -notmatch '-TimeoutSeconds 14400') { throw 'PRODUCTION_DUMP_HARD_DEADLINE_NOT_WIRED' }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}

Write-Output 'THETA_POSTGRES_TOOL_DEADLINE_TEST=PASS'
