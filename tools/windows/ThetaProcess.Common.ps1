#Requires -Version 7
Set-StrictMode -Version Latest

function ConvertTo-ThetaSanitizedStandardError {
  param([AllowNull()][string]$Diagnostic)
  if ([string]::IsNullOrWhiteSpace($Diagnostic)) { return [string[]]@() }
  $codes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  if ($Diagnostic -match '(?i)exceeded (?:the )?data transfer quota') { [void]$codes.Add('AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED') }
  foreach ($code in @('EAI_AGAIN','ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE')) {
    if ($Diagnostic -match "(?i)(^|[^A-Z0-9_])$code([^A-Z0-9_]|$)") { [void]$codes.Add($code) }
  }
  foreach ($match in [regex]::Matches($Diagnostic, '(?i)(?:SQLSTATE\s*)?\b((?=[0-9A-Z]*[0-9])[0-9A-Z]{5})\b')) {
    $value = ([string]$match.Groups[1].Value).ToUpperInvariant()
    if ($value -match '^(?=.*[0-9])[0-9A-Z]{5}$') { [void]$codes.Add("SQLSTATE_$value") }
  }
  if ($Diagnostic -match '(?i)(certificate|tls|ssl)') { [void]$codes.Add('TLS_DIAGNOSTIC_REDACTED') }
  if ($Diagnostic -match '(?i)(password authentication failed|authentication failed|permission denied)') {
    [void]$codes.Add('AUTHORIZATION_DIAGNOSTIC_REDACTED')
  }
  if ($codes.Count -eq 0) { [void]$codes.Add('CHILD_STDERR_REDACTED') }
  return [string[]]@($codes | Sort-Object)
}

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
        $stderr = $stderrTask.GetAwaiter().GetResult()
        return [pscustomobject]@{ State='TIMED_OUT'; ExitCode=-1; Output=[string[]]@();
          SanitizedStandardError=@(ConvertTo-ThetaSanitizedStandardError $stderr) }
      }
      $null = $stdinTask.GetAwaiter().GetResult()
      $process.StandardInput.Close()
    }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { if (-not $process.HasExited) { $process.Kill($true) } } catch {}
      if (-not $process.WaitForExit(10000)) { throw 'THETA_BOUNDED_PROCESS_TERMINATION_FAILED' }
      $null = $stdoutTask.GetAwaiter().GetResult()
      $stderr = $stderrTask.GetAwaiter().GetResult()
      return [pscustomobject]@{ State='TIMED_OUT'; ExitCode=-1; Output=[string[]]@();
        SanitizedStandardError=@(ConvertTo-ThetaSanitizedStandardError $stderr) }
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    # Drain stderr to prevent child-process pipe backpressure. Only typed,
    # allowlisted categories are returned. Raw provider text never leaves this
    # process owner.
    $stderr = $stderrTask.GetAwaiter().GetResult()
    [string[]]$output = if ($stdout) { @($stdout -split "\r?\n" | Where-Object { $_ -ne '' }) } else { @() }
    return [pscustomobject]@{ State='COMPLETED'; ExitCode=$process.ExitCode; Output=[string[]]$output;
      SanitizedStandardError=@(ConvertTo-ThetaSanitizedStandardError $stderr) }
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
