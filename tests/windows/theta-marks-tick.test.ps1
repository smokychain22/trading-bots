#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\..\tools\windows\ThetaProcess.Common.ps1')

$root = Join-Path ([IO.Path]::GetTempPath()) ('theta-marks-tick-test-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $root)
$listener = $null
try {
  $port = Get-Random -Minimum 20000 -Maximum 40000
  $listener = [System.Net.HttpListener]::new()
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  $endpoint = "http://127.0.0.1:$port/"
  $secret = 'SYNTHETIC-TOKEN-NEVER-PERSISTED-0123456789'
  $headers = @{ Authorization = "Bearer $secret"; 'X-Theta-Worker-Id' = 'worker-test' }
  $statusPath = Join-Path $root 'marks-ticker.json'

  # Serve one request on a worker thread so the synchronous client below can complete.
  function Serve([int]$statusCode, [string]$body, [hashtable]$extraHeaders = @{}) {
    $job = Start-ThreadJob -ArgumentList @($listener, $statusCode, $body, $extraHeaders) -ScriptBlock {
      param($l, $code, $payload, $more)
      $context = $l.GetContext()
      $seen = @{ Operation = $context.Request.Headers['X-Theta-Operation']; Method = $context.Request.HttpMethod;
                 Authorization = $context.Request.Headers['Authorization'] }
      $context.Response.StatusCode = $code
      foreach ($key in $more.Keys) { $context.Response.Headers.Add($key, [string]$more[$key]) }
      $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
      $context.Response.ContentType = 'application/json'
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $context.Response.Close()
      $seen
    }
    return $job
  }

  # 1) Success: operation header is the read-only marks operation, counts are recorded, the token is never persisted.
  $job = Serve 200 '{"due":3,"observed":2,"missed":0,"deferred":1,"brokerMutations":0}'
  $ok = Invoke-ThetaMarksTick -Endpoint $endpoint -Headers $headers -StatusPath $statusPath -TimeoutSeconds 10
  $seen = Receive-Job -Job $job -Wait -AutoRemoveJob
  if ($ok -ne $true) { throw 'THETA_MARKS_TICK_SUCCESS_NOT_REPORTED' }
  if ($seen.Operation -ne 'runtime-marks-cycle' -or $seen.Method -ne 'POST') { throw 'THETA_MARKS_TICK_WRONG_OPERATION' }
  $status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
  if ($status.state -ne 'OK' -or $status.due -ne 3 -or $status.observed -ne 2 -or $status.missed -ne 0 -or
      $status.deferred -ne 1 -or $status.brokerMutations -ne 0) { throw 'THETA_MARKS_TICK_STATUS_INVALID' }
  if ((Get-Content -Raw -LiteralPath $statusPath) -match 'SYNTHETIC-TOKEN|Bearer') { throw 'THETA_MARKS_TICK_LEAKED_SECRET' }

  # 2) Missing count fields stay UNKNOWN (null) in the status file, never coerced to zero.
  $job = Serve 200 '{}'
  $ok = Invoke-ThetaMarksTick -Endpoint $endpoint -Headers $headers -StatusPath $statusPath -TimeoutSeconds 10
  [void](Receive-Job -Job $job -Wait -AutoRemoveJob)
  $status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
  if ($ok -ne $true -or $null -ne $status.due -or $null -ne $status.observed -or $null -ne $status.deferred) {
    throw 'THETA_MARKS_TICK_UNKNOWN_COERCED_TO_ZERO'
  }

  # 3) A 503 with a safe server error code is reported as a failed tick with only safe metadata.
  $job = Serve 503 '{"error":"x"}' @{ 'X-Theta-Safe-Error-Code' = 'POSTGRES_57P03' }
  $ok = Invoke-ThetaMarksTick -Endpoint $endpoint -Headers $headers -StatusPath $statusPath -TimeoutSeconds 10
  [void](Receive-Job -Job $job -Wait -AutoRemoveJob)
  $status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
  if ($ok -ne $false -or $status.state -ne 'FAILED' -or $status.httpStatus -ne 503 -or $status.serverErrorCode -ne 'POSTGRES_57P03') {
    throw 'THETA_MARKS_TICK_HTTP_FAILURE_NOT_CLASSIFIED'
  }

  # 4) A 409 lease refusal is a failed tick (the caller backs off), not a crash.
  $job = Serve 409 '{"error":"marks_tick_requires_primary_lease"}'
  $ok = Invoke-ThetaMarksTick -Endpoint $endpoint -Headers $headers -StatusPath $statusPath -TimeoutSeconds 10
  [void](Receive-Job -Job $job -Wait -AutoRemoveJob)
  if ($ok -ne $false) { throw 'THETA_MARKS_TICK_LEASE_REFUSAL_NOT_FAILED' }

  # 5) Connection refused never throws out of the helper.
  $listener.Stop()
  $ok = Invoke-ThetaMarksTick -Endpoint $endpoint -Headers $headers -StatusPath $statusPath -TimeoutSeconds 5
  $status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
  if ($ok -ne $false -or $status.state -ne 'FAILED' -or $null -ne $status.httpStatus) { throw 'THETA_MARKS_TICK_TRANSPORT_FAILURE_NOT_CLASSIFIED' }

  # 6) The supervisor wires the ticker read-only: marks operation only, bounded cadence, stopped on shutdown.
  $worker = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\theta-local-worker.ps1')
  if ($worker -notmatch 'Start-ThreadJob -Name ''theta-marks-ticker''') { throw 'THETA_MARKS_TICKER_NOT_STARTED' }
  if ($worker -notmatch 'Stop-Job -Job \$marksTickerJob') { throw 'THETA_MARKS_TICKER_NOT_STOPPED' }
  if ($worker -notmatch '\$marksTickIntervalSeconds = 40') { throw 'THETA_MARKS_TICK_CADENCE_CHANGED' }

  Write-Output 'THETA_MARKS_TICK_TEST=PASS'
}
finally {
  if ($null -ne $listener -and $listener.IsListening) { $listener.Stop() }
  if ($null -ne $listener) { $listener.Close() }
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
