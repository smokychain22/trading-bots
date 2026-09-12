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
$exportSessionFile = Join-Path $stateRoot 'last-auto-export-session'
$researchHashFile = Join-Path $stateRoot 'last-empirical-dataset-hash'
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
      $report = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $headers -TimeoutSec 120
      $marketSessionDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [DateTimeOffset]::UtcNow, 'Eastern Standard Time').ToString('yyyy-MM-dd')
      $lastExportedSession = if (Test-Path -LiteralPath $exportSessionFile) {
        (Get-Content -Raw -LiteralPath $exportSessionFile).Trim()
      } else { '' }
      $researchExport = if ($lastExportedSession -eq $marketSessionDate) {
        'CURRENT_SESSION_EXPORTED'
      } else { 'WAITING_FOR_COMPLETE_SCAN' }
      $completeScan = @($report.jobResults | Where-Object {
        $_.jobType -eq 'OPPORTUNITY_SCAN' -and $_.status -eq 'SUCCEEDED'
      }).Count -gt 0
      if ($completeScan -and $lastExportedSession -ne $marketSessionDate) {
        & npm run theta:research-export -- --latest *> $null
        if ($LASTEXITCODE -eq 0) {
          Set-Content -LiteralPath $exportSessionFile -Value $marketSessionDate -Encoding ascii
          $researchExport = 'EXPORTED_FIRST_COMPLETE_SCAN'
        } else {
          $researchExport = 'BLOCKED_ON_EVIDENCE'
        }
      }
      $latestDataset = Join-Path $RepositoryPath 'research_exports\latest\dataset.json'
      $latestManifest = Join-Path $RepositoryPath 'research_exports\latest\manifest.json'
      if ((Test-Path -LiteralPath $latestDataset) -and (Test-Path -LiteralPath $latestManifest)) {
        $manifest = Get-Content -Raw -LiteralPath $latestManifest | ConvertFrom-Json
        $datasetHash = [string]$manifest.datasetHash
        $lastResearchHash = if (Test-Path -LiteralPath $researchHashFile) {
          (Get-Content -Raw -LiteralPath $researchHashFile).Trim()
        } else { '' }
        if ($datasetHash -match '^[0-9a-f]{64}$' -and $datasetHash -ne $lastResearchHash) {
          $python = Join-Path $RepositoryPath '.venv\Scripts\python.exe'
          if (!(Test-Path -LiteralPath $python)) { $python = 'python' }
          $env:PYTHONPATH = Join-Path $RepositoryPath 'bots\theta\quant'
          $runTimestamp = (Get-Date).ToUniversalTime().ToString('o')
          & $python -m research.empirical_pipeline --export $latestDataset --output (Join-Path $RepositoryPath 'research_outputs') `
            --evidence-source LIVE_SHADOW --strategy-branch THETA_CONVENTIONAL `
            --experiment-id AUTO-DESCRIPTIVE --target-version theta-research-targets-v1 `
            --feature-version ([string]$manifest.featureSetVersion) --cost-model-version theta-cost-model-v1 `
            --split-definition NO_SPLIT_DESCRIPTIVE_ONLY --source-code-commit $runtime.buildSha `
            --run-timestamp $runTimestamp *> $null
          if ($LASTEXITCODE -eq 0) {
            Set-Content -LiteralPath $researchHashFile -Value $datasetHash -Encoding ascii
            $researchExport = 'EXPORTED_AND_RESEARCHED'
          } else {
            $researchExport = 'RESEARCH_PIPELINE_BLOCKED'
          }
        } elseif ($datasetHash -eq $lastResearchHash) {
          $researchExport = 'RESEARCH_CURRENT'
        } elseif ($datasetHash) {
          $researchExport = 'RESEARCH_DATASET_HASH_INVALID'
        }
      }
      @{state='ONLINE';lastCycle=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='THETA_LOCAL_SHADOW';executionGate='LOCKED';researchExport=$researchExport} | ConvertTo-Json |
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
