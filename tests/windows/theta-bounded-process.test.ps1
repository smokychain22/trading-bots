#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\..\tools\windows\ThetaProcess.Common.ps1')

$pwsh = Join-Path $PSHOME 'pwsh'
$root = Join-Path ([IO.Path]::GetTempPath()) ('theta-bounded-process-test-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root)
try {
  $successScript = Join-Path $root 'success.ps1'
  [IO.File]::WriteAllText($successScript, "Write-Output 'bounded-ok'`n", [Text.UTF8Encoding]::new($false))
  $success = Invoke-ThetaBoundedProcess -Executable $pwsh `
    -Arguments @('-NoProfile','-File',$successScript) -TimeoutSeconds 10 -WorkingDirectory $root
  if ($success.State -ne 'COMPLETED' -or $success.ExitCode -ne 0 -or
      $success.Output.Count -ne 1 -or $success.Output[0] -ne 'bounded-ok') {
    throw 'THETA_BOUNDED_PROCESS_SUCCESS_RESULT_INVALID'
  }

  $failureScript = Join-Path $root 'failure.ps1'
  [IO.File]::WriteAllText($failureScript, @'
[Console]::Error.WriteLine('SQLSTATE 57P03 postgresql://owner:secret@private.example/db password=never-persist')
Write-Output '{"state":"FAILED","reasonCode":"SAFE_FAILURE"}'
exit 7
'@, [Text.UTF8Encoding]::new($false))
  $failure = Invoke-ThetaBoundedProcess -Executable $pwsh `
    -Arguments @('-NoProfile','-File',$failureScript) -TimeoutSeconds 10 -WorkingDirectory $root
  if ($failure.State -ne 'COMPLETED' -or $failure.ExitCode -ne 7 -or
      $failure.Output.Count -ne 1 -or $failure.Output[0] -notmatch 'SAFE_FAILURE') {
    throw 'THETA_BOUNDED_PROCESS_FAILURE_RESULT_INVALID'
  }
  if (($failure.Output -join "`n") -match 'never-persist|private\.example|owner:secret') {
    throw 'THETA_BOUNDED_PROCESS_EXPOSED_STDERR'
  }
  if (($failure.SanitizedStandardError -join "`n") -match 'never-persist|private\.example|owner:secret') {
    throw 'THETA_BOUNDED_PROCESS_SANITIZED_STDERR_EXPOSED_SECRET'
  }
  if ($failure.SanitizedStandardError -notcontains 'SQLSTATE_57P03') {
    throw 'THETA_BOUNDED_PROCESS_SQLSTATE_NOT_CLASSIFIED'
  }
  $failureCode = Get-ThetaBoundedFailureCode -ProcessResult $failure
  if ($failureCode -ne 'SAFE_FAILURE') { throw 'THETA_BOUNDED_PROCESS_FAILURE_CODE_NOT_RECOVERED' }

  $unsafeFailure = [pscustomobject]@{
    State='COMPLETED';ExitCode=1;Output=@('{"state":"FAILED","reasonCode":"unsafe detail"}')
  }
  if ($null -ne (Get-ThetaBoundedFailureCode -ProcessResult $unsafeFailure)) {
    throw 'THETA_BOUNDED_PROCESS_UNSAFE_FAILURE_CODE_ACCEPTED'
  }
  $lowercaseFailure = [pscustomobject]@{
    State='COMPLETED';ExitCode=1;Output=@('{"state":"FAILED","reasonCode":"unsafe_detail"}')
  }
  if ($null -ne (Get-ThetaBoundedFailureCode -ProcessResult $lowercaseFailure)) {
    throw 'THETA_BOUNDED_PROCESS_LOWERCASE_FAILURE_CODE_ACCEPTED'
  }

  $stdinScript = Join-Path $root 'stdin.ps1'
  [IO.File]::WriteAllText($stdinScript, "[Console]::In.ReadToEnd() | Write-Output`n", [Text.UTF8Encoding]::new($false))
  $stdin = Invoke-ThetaBoundedProcess -Executable $pwsh `
    -Arguments @('-NoProfile','-File',$stdinScript) -TimeoutSeconds 10 -WorkingDirectory $root `
    -StandardInputText 'bounded-stdin'
  if ($stdin.State -ne 'COMPLETED' -or $stdin.ExitCode -ne 0 -or
      $stdin.Output.Count -ne 1 -or $stdin.Output[0] -ne 'bounded-stdin') {
    throw 'THETA_BOUNDED_PROCESS_STDIN_RESULT_INVALID'
  }

  $blockedStdinScript = Join-Path $root 'blocked-stdin.ps1'
  [IO.File]::WriteAllText($blockedStdinScript, "Start-Sleep -Seconds 30`n", [Text.UTF8Encoding]::new($false))
  $stdinTimer = [Diagnostics.Stopwatch]::StartNew()
  $blockedStdin = Invoke-ThetaBoundedProcess -Executable $pwsh `
    -Arguments @('-NoProfile','-File',$blockedStdinScript) -TimeoutSeconds 1 -WorkingDirectory $root `
    -StandardInputText ('x' * 1048576)
  $stdinTimer.Stop()
  if ($blockedStdin.State -ne 'TIMED_OUT' -or $blockedStdin.ExitCode -ne -1) {
    throw 'THETA_BOUNDED_PROCESS_BLOCKED_STDIN_TIMEOUT_INVALID'
  }
  if ($stdinTimer.Elapsed.TotalSeconds -gt 10) { throw 'THETA_BOUNDED_PROCESS_BLOCKED_STDIN_EXIT_TOO_SLOW' }

  $timeoutScript = Join-Path $root 'timeout.ps1'
  [IO.File]::WriteAllText($timeoutScript, "Start-Sleep -Seconds 30`n", [Text.UTF8Encoding]::new($false))
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $timeout = Invoke-ThetaBoundedProcess -Executable $pwsh `
    -Arguments @('-NoProfile','-File',$timeoutScript) -TimeoutSeconds 1 -WorkingDirectory $root
  $timer.Stop()
  if ($timeout.State -ne 'TIMED_OUT' -or $timeout.ExitCode -ne -1 -or $timeout.Output.Count -ne 0 -or
      $null -eq $timeout.SanitizedStandardError) {
    throw 'THETA_BOUNDED_PROCESS_TIMEOUT_RESULT_INVALID'
  }
  if ($timer.Elapsed.TotalSeconds -gt 10) { throw 'THETA_BOUNDED_PROCESS_TIMEOUT_EXIT_TOO_SLOW' }
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force
}

Write-Output 'THETA_BOUNDED_PROCESS_TEST=PASS'
