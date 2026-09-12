param([string]$RepositoryPath = '')
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
  $RepositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $RepositoryPath = (Resolve-Path -LiteralPath $RepositoryPath).Path
}
$stateRoot = Join-Path $RepositoryPath '.theta-local-worker'
$runtimeFile = Join-Path $stateRoot 'runtime.json'
$tokenFile = Join-Path $stateRoot 'worker.token'
$statusFile = Join-Path $stateRoot 'status.json'
$stopFile = Join-Path $stateRoot 'stop.request'
if (!(Test-Path -LiteralPath $runtimeFile)) { throw 'THETA_LOCAL_WORKER_NOT_INSTALLED' }
if (!(Test-Path -LiteralPath $tokenFile)) { throw 'THETA_LOCAL_WORKER_TOKEN_NOT_PROVISIONED' }
$runtime = Get-Content -Raw -LiteralPath $runtimeFile | ConvertFrom-Json
$token = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
if ($runtime.repositoryPath -ne $RepositoryPath) { throw 'THETA_RUNTIME_PATH_MISMATCH' }
if ($token.Length -lt 32) { throw 'THETA_LOCAL_WORKER_TOKEN_INVALID' }

Set-Location -LiteralPath $RepositoryPath
$currentSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentSha -ne $runtime.buildSha) { throw 'THETA_RUNTIME_SHA_MISMATCH' }
if ((& git status --porcelain --untracked-files=no).Count -gt 0) { throw 'THETA_RUNTIME_TRACKED_FILES_DIRTY' }
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile -Force }

$mutex = [Threading.Mutex]::new($false, 'Local\THETA_LOCAL_SHADOW_SUPERVISOR')
$owned = $false
try {
  $owned = $mutex.WaitOne(0)
  if (!$owned) { exit 23 }
  $delaySeconds = 5
  while (!(Test-Path -LiteralPath $stopFile)) {
    $headers = @{ Authorization = "Bearer $token"; 'X-Theta-Worker-Id'=$runtime.workerId;
      'X-Theta-Host-Id'=$env:COMPUTERNAME; 'X-Theta-Build-Sha'=$runtime.buildSha }
    $workerExit = 0
    try {
      Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $headers -TimeoutSec 120 | Out-Null
      @{state='ONLINE';lastCycle=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='THETA_LOCAL_SHADOW';executionGate='LOCKED'} | ConvertTo-Json |
        Set-Content -LiteralPath $statusFile -Encoding utf8
      $delaySeconds = 5
    } catch {
      $workerExit = 1
      @{state='DEGRADED';lastFailure=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='THETA_LOCAL_SHADOW';executionGate='LOCKED'} | ConvertTo-Json |
        Set-Content -LiteralPath $statusFile -Encoding utf8
    }
    if (Test-Path -LiteralPath $stopFile) { break }
    $waitSeconds = if ($workerExit -eq 0) { 60 } else { $delaySeconds }
    for ($elapsed = 0; $elapsed -lt $waitSeconds; $elapsed++) {
      if (Test-Path -LiteralPath $stopFile) { break }
      Start-Sleep -Seconds 1
    }
    if ($workerExit -ne 0) { $delaySeconds = [Math]::Min(300, $delaySeconds * 2) }
  }
} finally {
  try {
    if ($token.Length -ge 32) {
      $headers = @{ Authorization="Bearer $token"; 'X-Theta-Worker-Id'=$runtime.workerId;
        'X-Theta-Host-Id'=$env:COMPUTERNAME; 'X-Theta-Build-Sha'=$runtime.buildSha }
      Invoke-RestMethod -Method Delete -Uri $runtime.endpoint -Headers $headers -TimeoutSec 15 | Out-Null
    }
  } catch {}
  @{state='OFFLINE';lastShutdown=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
    mode='THETA_LOCAL_SHADOW';executionGate='LOCKED'} | ConvertTo-Json |
    Set-Content -LiteralPath $statusFile -Encoding utf8
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
