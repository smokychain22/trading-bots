#Requires -Version 7
Set-StrictMode -Version Latest

function Invoke-ThetaBoundedProcess {
  param(
    [Parameter(Mandatory)][string]$Executable,
    [string[]]$Arguments = @(),
    [ValidateRange(1,21600)][int]$TimeoutSeconds,
    [string]$WorkingDirectory = (Get-Location).Path,
    [AllowNull()][string]$StandardInputText = $null
  )
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
  $startInfo.WorkingDirectory = $WorkingDirectory
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = $null -ne $StandardInputText
  $process = $null
  try {
    $process = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) { throw 'THETA_BOUNDED_PROCESS_START_FAILED' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($null -ne $StandardInputText) {
      $stdinTask = $process.StandardInput.WriteAsync($StandardInputText)
      if (-not $stdinTask.Wait($TimeoutSeconds * 1000)) {
        try { if (-not $process.HasExited) { $process.Kill($true) } } catch {}
        if (-not $process.WaitForExit(10000)) { throw 'THETA_BOUNDED_PROCESS_TERMINATION_FAILED' }
        $null = $stdoutTask.GetAwaiter().GetResult()
        $null = $stderrTask.GetAwaiter().GetResult()
        return [pscustomobject]@{ State='TIMED_OUT'; ExitCode=-1; Output=[string[]]@() }
      }
      $null = $stdinTask.GetAwaiter().GetResult()
      $process.StandardInput.Close()
    }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { if (-not $process.HasExited) { $process.Kill($true) } } catch {}
      if (-not $process.WaitForExit(10000)) { throw 'THETA_BOUNDED_PROCESS_TERMINATION_FAILED' }
      $null = $stdoutTask.GetAwaiter().GetResult()
      $null = $stderrTask.GetAwaiter().GetResult()
      return [pscustomobject]@{ State='TIMED_OUT'; ExitCode=-1; Output=[string[]]@() }
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    # Drain stderr to prevent child-process pipe backpressure. It is never
    # returned because provider diagnostics may contain sensitive values.
    $null = $stderrTask.GetAwaiter().GetResult()
    [string[]]$output = if ($stdout) { @($stdout -split "\r?\n" | Where-Object { $_ -ne '' }) } else { @() }
    return [pscustomobject]@{ State='COMPLETED'; ExitCode=$process.ExitCode; Output=[string[]]$output }
  } finally {
    if ($null -ne $process) { $process.Dispose() }
  }
}

function Get-ThetaBoundedFailureCode {
  param(
    [Parameter(Mandatory)][object]$ProcessResult
  )
  if ($ProcessResult.State -ne 'COMPLETED' -or $ProcessResult.ExitCode -eq 0) { return $null }
  $candidateLines = @($ProcessResult.Output | Select-Object -Last 10)
  [array]::Reverse($candidateLines)
  foreach ($line in $candidateLines) {
    try {
      $receipt = [string]$line | ConvertFrom-Json -ErrorAction Stop
      $stateProperty = $receipt.PSObject.Properties['state']
      $reasonProperty = $receipt.PSObject.Properties['reasonCode']
      if ($null -eq $stateProperty -or $null -eq $reasonProperty -or
          [string]$stateProperty.Value -ne 'FAILED') { continue }
      $reasonCode = [string]$reasonProperty.Value
      if ($reasonCode -cmatch '^[A-Z][A-Z0-9_]{2,127}$') { return $reasonCode }
    } catch {
      # Child stdout can contain normal progress lines. Only a strict,
      # secret-free failure receipt is eligible for parent propagation.
    }
  }
  return $null
}
