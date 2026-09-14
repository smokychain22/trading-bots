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
$productionEnvFile = Join-Path $stateRoot 'production.env'
$stopFile = Join-Path $stateRoot 'stop.request'
$exportSessionFile = Join-Path $stateRoot 'last-auto-export-session'
$researchIdentityFile = Join-Path $stateRoot 'last-empirical-dataset-identity'
$qualificationSessionFile = Join-Path $stateRoot 'last-optionomics-qualification-session'
if (!(Test-Path -LiteralPath $runtimeFile)) { throw 'THETA_LOCAL_WORKER_NOT_INSTALLED' }
if (!(Test-Path -LiteralPath $tokenFile)) { throw 'THETA_LOCAL_WORKER_TOKEN_NOT_PROVISIONED' }
if (!(Test-Path -LiteralPath $productionEnvFile)) { throw 'THETA_PRODUCTION_ENV_NOT_PROVISIONED' }
$runtime = Get-Content -Raw -LiteralPath $runtimeFile | ConvertFrom-Json
$token = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
if ($runtime.repositoryPath -ne $RepositoryPath) { throw 'THETA_RUNTIME_PATH_MISMATCH' }
if ($token.Length -lt 32) { throw 'THETA_LOCAL_WORKER_TOKEN_INVALID' }

Set-Location -LiteralPath $RepositoryPath
$currentSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentSha -ne $runtime.buildSha) { throw 'THETA_RUNTIME_SHA_MISMATCH' }
if ((& git status --porcelain --untracked-files=no).Count -gt 0) { throw 'THETA_RUNTIME_TRACKED_FILES_DIRTY' }
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile -Force }

$mutex = [Threading.Mutex]::new($false, 'Local\THETA_MASTER_PAPER_SUPERVISOR')
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
      $lastQualificationSession = if (Test-Path -LiteralPath $qualificationSessionFile) {
        (Get-Content -Raw -LiteralPath $qualificationSessionFile).Trim()
      } else { '' }
      if ($report.reconciliation.marketOpen -eq $true -and $lastQualificationSession -ne $marketSessionDate) {
        $qualificationHeaders = $headers.Clone()
        $qualificationHeaders['X-Theta-Operation'] = 'optionomics-quote-qualification'
        $qualification = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $qualificationHeaders -TimeoutSec 120
        if ($null -ne $qualification -and $qualification.marketSession -eq 'OPEN') {
          Set-Content -LiteralPath $qualificationSessionFile -Value $marketSessionDate -Encoding ascii
        }
      }
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
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          & node "--env-file=$productionEnvFile" --import tsx tools/theta-research-export.ts --latest *> $null
          $researchExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
        if ($researchExit -eq 0) {
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
        $researchIdentity = "$datasetHash`:$($runtime.buildSha)"
        $lastResearchIdentity = if (Test-Path -LiteralPath $researchIdentityFile) {
          (Get-Content -Raw -LiteralPath $researchIdentityFile).Trim()
        } else { '' }
        if ($datasetHash -match '^[0-9a-f]{64}$' -and $researchIdentity -ne $lastResearchIdentity) {
          $python = Join-Path $RepositoryPath '.venv\Scripts\python.exe'
          if (!(Test-Path -LiteralPath $python)) { $python = 'python' }
          $env:PYTHONPATH = Join-Path $RepositoryPath 'bots\theta\quant'
          $runTimestamp = (Get-Date).ToUniversalTime().ToString('o')
          $experimentId = "AUTO-DESCRIPTIVE-$($runtime.buildSha.Substring(0,12))"
          $resultManifestPath = Join-Path $RepositoryPath "research_outputs\$datasetHash\$experimentId\manifest.json"
          $existingResultValid = $false
          if (Test-Path -LiteralPath $resultManifestPath) {
            $existingResult = Get-Content -Raw -LiteralPath $resultManifestPath | ConvertFrom-Json
            $existingResultValid = `
              [string]$existingResult.dataset_hash -eq $datasetHash -and `
              [string]$existingResult.source_code_commit -eq [string]$runtime.buildSha -and `
              [string]$existingResult.experiment_id -eq $experimentId -and `
              [string]$existingResult.feature_version -eq [string]$manifest.featureSetVersion -and `
              [string]$existingResult.evidence_source -eq 'LIVE_SHADOW' -and `
              [string]$existingResult.strategy_branch -eq 'THETA_CONVENTIONAL'
          }
          if ($existingResultValid) {
            Set-Content -LiteralPath $researchIdentityFile -Value $researchIdentity -Encoding ascii
            $researchExport = 'RESEARCH_CURRENT'
          } elseif (Test-Path -LiteralPath $resultManifestPath) {
            $researchExport = 'RESEARCH_RESULT_IDENTITY_INVALID'
          } else {
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            try {
              & $python -m research.empirical_pipeline --export $latestDataset --output (Join-Path $RepositoryPath 'research_outputs') `
                --evidence-source LIVE_SHADOW --strategy-branch THETA_CONVENTIONAL `
                --experiment-id $experimentId --target-version theta-research-targets-v1 `
                --feature-version ([string]$manifest.featureSetVersion) --cost-model-version theta-cost-model-v1 `
                --split-definition NO_SPLIT_DESCRIPTIVE_ONLY --source-code-commit $runtime.buildSha `
                --run-timestamp $runTimestamp *> $null
              $pipelineExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $previousErrorActionPreference }
            if ($pipelineExit -eq 0) {
              Set-Content -LiteralPath $researchIdentityFile -Value $researchIdentity -Encoding ascii
              $researchExport = 'EXPORTED_AND_RESEARCHED'
            } else {
              $researchExport = 'RESEARCH_PIPELINE_BLOCKED'
            }
          }
        } elseif ($researchIdentity -eq $lastResearchIdentity) {
          $researchExport = 'RESEARCH_CURRENT'
        } elseif ($datasetHash) {
          $researchExport = 'RESEARCH_DATASET_HASH_INVALID'
        }
      }
      @{state='ONLINE';lastCycle=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='MASTER_THETA_PAPER';executionGate='EXTERNAL_QUOTE_BLOCKER';researchExport=$researchExport} | ConvertTo-Json |
        Set-Content -LiteralPath $statusFile -Encoding utf8
      $delaySeconds = 5
    } catch {
      $workerExit = 1
      $httpStatus = if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
        [int]$_.Exception.Response.StatusCode
      } else { $null }
      $exceptionType = $_.Exception.GetType().Name
      $failureCode = if ($null -ne $httpStatus) { "HTTP_$httpStatus" }
        elseif ($exceptionType -match '^[A-Za-z0-9_.-]{1,96}$') { "LOCAL_$exceptionType" }
        else { 'LOCAL_WORKER_LOOP_FAILED' }
      @{state='DEGRADED';lastFailure=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='MASTER_THETA_PAPER';executionGate='EXTERNAL_QUOTE_BLOCKER';failureCode=$failureCode} | ConvertTo-Json |
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
    mode='MASTER_THETA_PAPER';executionGate='EXTERNAL_QUOTE_BLOCKER'} | ConvertTo-Json |
    Set-Content -LiteralPath $statusFile -Encoding utf8
  if ($owned) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
