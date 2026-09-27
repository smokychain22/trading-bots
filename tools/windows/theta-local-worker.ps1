param([string]$ControlRoot = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ThetaProcess.Common.ps1')

if ([string]::IsNullOrWhiteSpace($ControlRoot)) {
  $ControlRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $ControlRoot = (Resolve-Path -LiteralPath $ControlRoot).Path
}
$stateRoot = Join-Path $ControlRoot '.theta-local-worker'
$runtimeFile = Join-Path $stateRoot 'runtime.json'
$tokenFile = Join-Path $stateRoot 'worker.token'
$statusFile = Join-Path $stateRoot 'status.json'
$productionEnvFile = Join-Path $stateRoot 'production.env'
$stopFile = Join-Path $stateRoot 'stop.request'
$exportSessionFile = Join-Path $stateRoot 'last-auto-export-session'
$pendingExportSessionFile = Join-Path $stateRoot 'pending-auto-export-session'
$researchIdentityFile = Join-Path $stateRoot 'last-empirical-dataset-identity'
$qualificationSessionFile = Join-Path $stateRoot 'last-optionomics-qualification-session'
$alpacaQualificationSessionFile = Join-Path $stateRoot 'last-alpaca-indicative-qualification-session'
$storageAuditDateFile = Join-Path $stateRoot 'last-storage-audit-date'
$storageAuditFailureFile = Join-Path $stateRoot 'storage-audit-failure.json'
if (!(Test-Path -LiteralPath $runtimeFile)) { throw 'THETA_LOCAL_WORKER_NOT_INSTALLED' }
if (!(Test-Path -LiteralPath $tokenFile)) { throw 'THETA_LOCAL_WORKER_TOKEN_NOT_PROVISIONED' }
if (!(Test-Path -LiteralPath $productionEnvFile)) { throw 'THETA_PRODUCTION_ENV_NOT_PROVISIONED' }
$runtime = Get-Content -Raw -LiteralPath $runtimeFile | ConvertFrom-Json
$RepositoryPath = (Resolve-Path -LiteralPath ([string]$runtime.releasePath)).Path
$token = (Get-Content -Raw -LiteralPath $tokenFile).Trim()
if ($runtime.repositoryPath -ne $ControlRoot) { throw 'THETA_RUNTIME_CONTROL_PATH_MISMATCH' }
if ($runtime.releasePath -ne $RepositoryPath) { throw 'THETA_RUNTIME_RELEASE_PATH_MISMATCH' }
if ($token.Length -lt 32) { throw 'THETA_LOCAL_WORKER_TOKEN_INVALID' }

Set-Location -LiteralPath $RepositoryPath
$currentSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $currentSha -ne $runtime.buildSha) {
  @{state='BLOCKED';observedAt=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
    workspaceSha=$currentSha;mode='MASTER_THETA_PAPER';executionGate='LOCKED';
    failureCode='THETA_RUNTIME_SHA_MISMATCH'} | ConvertTo-Json |
    Set-Content -LiteralPath $statusFile -Encoding utf8
  throw 'THETA_RUNTIME_SHA_MISMATCH'
}
if ((& git status --porcelain --untracked-files=no).Count -gt 0) { throw 'THETA_RUNTIME_TRACKED_FILES_DIRTY' }

$mutex = [Threading.Mutex]::new($false, 'Local\THETA_MASTER_PAPER_SUPERVISOR')
$owned = $false
try {
  try { $owned = $mutex.WaitOne(0) }
  catch [Threading.AbandonedMutexException] { $owned = $true }
  if (!$owned) { exit 23 }
  if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile -Force }
  $delaySeconds = 5
  $databaseRecoveryMode = $false
  $databaseRecoverySuccesses = 0
  $databaseConsecutiveFailures = 0
  $databaseCircuitState = 'DB_HEALTHY'
  $databaseRecoveryRequiredSuccesses = 4
  $databaseRecoveryProbeIntervalSeconds = 30
  while (!(Test-Path -LiteralPath $stopFile)) {
    $headers = @{ Authorization = "Bearer $token"; 'X-Theta-Worker-Id'=$runtime.workerId;
      'X-Theta-Host-Id'=$env:COMPUTERNAME; 'X-Theta-Build-Sha'=$runtime.buildSha }
    if ($databaseRecoveryMode) {
      # Probe only PostgreSQL and the existing primary lease. A transient DB
      # failure must not immediately restart the full provider/market scan.
      try {
        $databaseCircuitState = 'DB_RECOVERY_PROBING'
        $probeHeaders = $headers.Clone()
        $probeHeaders['X-Theta-Operation'] = 'runtime-db-probe'
        $probe = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $probeHeaders -TimeoutSec 20
        if ($probe.database -ne 'REACHABLE' -or $probe.lease -ne 'OWNED' -or
          $probe.executionGate -ne 'LOCKED') { throw 'THETA_DATABASE_RECOVERY_PROBE_INVALID' }
        $databaseRecoverySuccesses++
        $delaySeconds = $databaseRecoveryProbeIntervalSeconds
        @{state='INFRASTRUCTURE_DEFERRED';observedAt=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
          mode='MASTER_THETA_PAPER';executionGate='LOCKED';databaseCircuitState=$databaseCircuitState;
          databaseRecoverySuccesses=$databaseRecoverySuccesses;databaseRecoveryRequiredSuccesses=$databaseRecoveryRequiredSuccesses;
          decisionAuthority='INFRASTRUCTURE_DEFERRED';carryForwardCandidateAllowed=$false} | ConvertTo-Json |
          Set-Content -LiteralPath $statusFile -Encoding utf8
        if ($databaseRecoverySuccesses -ge $databaseRecoveryRequiredSuccesses) {
          # A successful four-probe recovery is the first safe point to copy the
          # durable local observation outbox into canonical Postgres. Backfill
          # is deliberately non-critical: an unavailable migration or a second
          # database interruption leaves the WAL spool intact for the next pass.
          $previousErrorActionPreference = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          try {
            [void](Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 180 -Arguments @(
              '--import','tsx','tools/theta-local-evidence-backfill.ts',"--environment-file=$productionEnvFile"))
          } finally {
            $ErrorActionPreference = $previousErrorActionPreference
          }
          $databaseRecoveryMode = $false
          $databaseRecoverySuccesses = 0
          $databaseConsecutiveFailures = 0
          $databaseCircuitState = 'DB_RECOVERED'
          @{state='RECOVERED_PENDING_FRESH_CYCLE';observedAt=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
            mode='MASTER_THETA_PAPER';executionGate='LOCKED';databaseCircuitState=$databaseCircuitState;
            decisionAuthority='INFRASTRUCTURE_DEFERRED';carryForwardCandidateAllowed=$false} | ConvertTo-Json |
            Set-Content -LiteralPath $statusFile -Encoding utf8
        }
      } catch {
        $databaseRecoverySuccesses = 0
        $databaseCircuitState = 'DB_CIRCUIT_OPEN'
        $delaySeconds = [Math]::Min(300, $delaySeconds * 2)
        @{state='INFRASTRUCTURE_DEFERRED';observedAt=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
          mode='MASTER_THETA_PAPER';executionGate='LOCKED';databaseCircuitState=$databaseCircuitState;
          databaseRecoverySuccesses=0;decisionAuthority='INFRASTRUCTURE_DEFERRED';
          carryForwardCandidateAllowed=$false} | ConvertTo-Json |
          Set-Content -LiteralPath $statusFile -Encoding utf8
      }
      for ($elapsed = 0; $elapsed -lt $delaySeconds; $elapsed++) {
        if (Test-Path -LiteralPath $stopFile) { break }
        Start-Sleep -Seconds 1
      }
      continue
    }
    $workerExit = 0
    $currentOperation = 'LOOP_START'
    $operationStartedAt = [DateTimeOffset]::UtcNow
    try {
      # The complete management-first cycle performs reconciliation, provider
      # collection, six-branch evaluation, and atomic evidence persistence.
      # Keep the client deadline above the longest observed server completion
      # window so the supervisor does not abandon a valid in-flight cycle and
      # retry it while Production is still persisting evidence.
      $currentOperation = 'RUNTIME_BROKER_CYCLE'
      $operationStartedAt = [DateTimeOffset]::UtcNow
      $brokerHeaders = $headers.Clone()
      $brokerHeaders['X-Theta-Operation'] = 'runtime-broker-cycle'
      $brokerReport = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $brokerHeaders -TimeoutSec 180
      if ($brokerReport.status -eq 'FAILED' -or $brokerReport.status -eq 'QUARANTINED') {
        throw 'THETA_BROKER_CYCLE_FAILED'
      }
      $currentOperation = 'RUNTIME_LIFECYCLE_CYCLE'
      $operationStartedAt = [DateTimeOffset]::UtcNow
      $lifecycleHeaders = $headers.Clone()
      $lifecycleHeaders['X-Theta-Operation'] = 'runtime-lifecycle-cycle'
      $lifecycleReport = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $lifecycleHeaders -TimeoutSec 180
      if ($lifecycleReport.status -eq 'FAILED' -or $lifecycleReport.status -eq 'QUARANTINED') {
        throw 'THETA_LIFECYCLE_CYCLE_FAILED'
      }
      $currentOperation = 'RUNTIME_MANAGEMENT_CYCLE'
      $operationStartedAt = [DateTimeOffset]::UtcNow
      $managementHeaders = $headers.Clone()
      $managementHeaders['X-Theta-Operation'] = 'runtime-management-cycle'
      $managementReport = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $managementHeaders -TimeoutSec 180
      if ($managementReport.status -eq 'FAILED' -or $managementReport.status -eq 'QUARANTINED') {
        throw 'THETA_MANAGEMENT_CYCLE_FAILED'
      }
      $currentOperation = 'RUNTIME_OBSERVATION_CYCLE'
      $operationStartedAt = [DateTimeOffset]::UtcNow
      $observationHeaders = $headers.Clone()
      $observationHeaders['X-Theta-Operation'] = 'runtime-observation-cycle'
      $observationReport = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $observationHeaders -TimeoutSec 180
      if ($observationReport.status -eq 'FAILED' -or $observationReport.status -eq 'QUARANTINED') {
        throw 'THETA_OBSERVATION_CYCLE_FAILED'
      }
      $currentOperation = 'RUNTIME_EVIDENCE_CYCLE'
      $operationStartedAt = [DateTimeOffset]::UtcNow
      $evidenceHeaders = $headers.Clone()
      $evidenceHeaders['X-Theta-Operation'] = 'runtime-evidence-cycle'
      $report = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $evidenceHeaders -TimeoutSec 290
      # Command-5A is a bounded, local, research-only continuation of the
      # canonical frontier. It records exact T0 subjects and later factual
      # marks without a broker mutation surface. Failures remain visible in
      # worker status but cannot rewrite the Production decision or turn an
      # infrastructure issue into WAIT.
      $command5aSchedulerPath = Join-Path $stateRoot 'research-spool\theta-observation-jobs.sqlite'
      $command5aSpoolPath = Join-Path $stateRoot 'research-spool\theta-research.sqlite'
      $command5aParquetRoot = 'C:\ProjectBackups\trading-bots\research-archives'
      $command5aScheduleState = 'NOT_ATTEMPTED'
      $command5aScheduleErrorCode = $null
      $command5aObservationState = 'NOT_ATTEMPTED'
      $command5aObservationErrorCode = $null
      $command5aMaturationState = 'NOT_ATTEMPTED'
      $command5aMaturationErrorCode = $null
      $command5aObserved = 0
      $command5aMissed = 0
      $command5aDeferredProvider = 0
      $command5aDeferredMarket = 0
      $command5aCensoredRetryExhausted = 0
      $command5aMaterialized = 0
      $command5aMaturationPending = 0
      $command5aMaturationCensored = 0
      $command5aBacklogState = 'NOT_OBSERVED'
      $command5aHealthErrorCode = $null
      $command5aUnresolvedJobs = 0
      $command5aDueJobs = 0
      $command5aOverdueJobs = 0
      $command5aExpiredClaims = 0
      $command5aRetryStalledJobs = 0
      $command5aOldestOverdueSeconds = $null
      $command5aSourceCursor = $null
      $command5aArchiveHealthPath = Join-Path $stateRoot 'research-spool\archive-health.json'
      $command5aSchedulingPausedForStorage = $false
      if (Test-Path -LiteralPath $command5aArchiveHealthPath -PathType Leaf) {
        try {
          $command5aPriorArchiveHealth = Get-Content -Raw -LiteralPath $command5aArchiveHealthPath | ConvertFrom-Json
          $command5aSchedulingPausedForStorage = [string]$command5aPriorArchiveHealth.newSubjectScheduling -eq 'PAUSE_STORAGE_PRESSURE'
        } catch { $command5aSchedulingPausedForStorage = $true }
      }
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      try {
        if ($command5aSchedulingPausedForStorage) {
          $command5aScheduleState = 'PAUSED_STORAGE_WATERMARK'
        } else {
          # The local source cursor advances across bounded pages. On first
          # installation, start at the immutable release time so a worker
          # outage longer than 90 minutes cannot erase serious subjects.
          $command5aSince = [string]$runtime.installedAt
          $command5aScheduleProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 180 -Arguments @(
            '--import','tsx','tools/theta-command5a-runtime.ts','--mode=schedule',
            "--environment-file=$productionEnvFile","--scheduler=$command5aSchedulerPath",
            "--spool=$command5aSpoolPath","--parquet-root=$command5aParquetRoot",
            "--since=$command5aSince",'--limit=250')
          $command5aScheduleOutput = $command5aScheduleProcess.Output
          if ($command5aScheduleProcess.State -eq 'COMPLETED' -and $command5aScheduleProcess.ExitCode -eq 0) {
            $command5aScheduleResult = $command5aScheduleOutput | Select-Object -Last 1 | ConvertFrom-Json
            $command5aScheduleState = [string]$command5aScheduleResult.state
          } else {
            $command5aScheduleState = 'FAILED_NONCRITICAL'
            if ($command5aScheduleProcess.State -eq 'TIMED_OUT') {
              $command5aScheduleErrorCode = 'COMMAND5A_SCHEDULE_PROCESS_TIMEOUT'
            } else {
              try { $command5aScheduleErrorCode = [string](($command5aScheduleOutput | Select-Object -Last 1 | ConvertFrom-Json).errorCode) }
              catch { $command5aScheduleErrorCode = 'COMMAND5A_UNCLASSIFIED_FAILURE' }
            }
          }
        }
        # Session-close jobs become due when the exchange clock turns closed.
        # Run the bounded worker whenever jobs are due. The read-only source
        # accepts only fresh latest marks after close and types stale/missing
        # marks explicitly, so this cannot fabricate an in-session observation.
        $command5aObservationProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 180 -Arguments @(
          '--import','tsx','tools/theta-command5a-runtime.ts','--mode=observe',
          "--environment-file=$productionEnvFile","--scheduler=$command5aSchedulerPath","--spool=$command5aSpoolPath")
        $command5aObservationOutput = $command5aObservationProcess.Output
        if ($command5aObservationProcess.State -eq 'COMPLETED' -and $command5aObservationProcess.ExitCode -eq 0) {
          $command5aObservationResult = $command5aObservationOutput | Select-Object -Last 1 | ConvertFrom-Json
          $command5aObservationState = [string]$command5aObservationResult.state
          $command5aObserved = [int]$command5aObservationResult.observed
          $command5aMissed = [int]$command5aObservationResult.missed
          $command5aDeferredProvider = [int]$command5aObservationResult.deferredProvider
          $command5aDeferredMarket = [int]$command5aObservationResult.deferredMarket
          $command5aCensoredRetryExhausted = [int]$command5aObservationResult.censoredRetryExhausted
        } else {
          $command5aObservationState = 'FAILED_NONCRITICAL'
          if ($command5aObservationProcess.State -eq 'TIMED_OUT') {
            $command5aObservationErrorCode = 'COMMAND5A_OBSERVATION_PROCESS_TIMEOUT'
          } else {
            try { $command5aObservationErrorCode = [string](($command5aObservationOutput | Select-Object -Last 1 | ConvertFrom-Json).errorCode) }
            catch { $command5aObservationErrorCode = 'COMMAND5A_UNCLASSIFIED_FAILURE' }
          }
        }
        # Maturation is local and provider-free. It may run while the market
        # is closed and only consumes already verified observation archives.
        $command5aMaturationProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 120 -Arguments @(
          '--import','tsx','tools/theta-command5a-runtime.ts','--mode=mature',
          "--environment-file=$productionEnvFile","--scheduler=$command5aSchedulerPath","--spool=$command5aSpoolPath",'--limit=64')
        $command5aMaturationOutput = $command5aMaturationProcess.Output
        if ($command5aMaturationProcess.State -eq 'COMPLETED' -and $command5aMaturationProcess.ExitCode -eq 0) {
          $command5aMaturationResult = $command5aMaturationOutput | Select-Object -Last 1 | ConvertFrom-Json
          $command5aMaturationState = [string]$command5aMaturationResult.state
          $command5aMaterialized = [int]$command5aMaturationResult.materialized
          $command5aMaturationPending = [int]$command5aMaturationResult.pending
          $command5aMaturationCensored = [int]$command5aMaturationResult.censored
        } else {
          $command5aMaturationState = 'FAILED_NONCRITICAL'
          if ($command5aMaturationProcess.State -eq 'TIMED_OUT') {
            $command5aMaturationErrorCode = 'COMMAND5A_MATURATION_PROCESS_TIMEOUT'
          } else {
            try { $command5aMaturationErrorCode = [string](($command5aMaturationOutput | Select-Object -Last 1 | ConvertFrom-Json).errorCode) }
            catch { $command5aMaturationErrorCode = 'COMMAND5A_UNCLASSIFIED_FAILURE' }
          }
        }
        $command5aHealthProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 30 -Arguments @(
          '--import','tsx','tools/theta-command5a-runtime.ts','--mode=health',"--scheduler=$command5aSchedulerPath")
        $command5aHealthOutput = $command5aHealthProcess.Output
        if ($command5aHealthProcess.State -eq 'COMPLETED' -and $command5aHealthProcess.ExitCode -eq 0) {
          $command5aHealthResult = $command5aHealthOutput | Select-Object -Last 1 | ConvertFrom-Json
          $command5aBacklogState = [string]$command5aHealthResult.backlogState
          $command5aUnresolvedJobs = [int]$command5aHealthResult.unresolvedCount
          $command5aDueJobs = [int]$command5aHealthResult.dueCount
          $command5aOverdueJobs = [int]$command5aHealthResult.overdueCount
          $command5aExpiredClaims = [int]$command5aHealthResult.expiredClaimCount
          $command5aRetryStalledJobs = [int]$command5aHealthResult.retryStalledCount
          $command5aOldestOverdueSeconds = $command5aHealthResult.oldestOverdueSeconds
          $command5aSourceCursor = $command5aHealthResult.sourceCursor
        } else {
          $command5aBacklogState = 'HEALTH_CHECK_FAILED'
          if ($command5aHealthProcess.State -eq 'TIMED_OUT') {
            $command5aHealthErrorCode = 'COMMAND5A_HEALTH_PROCESS_TIMEOUT'
          } else {
            try { $command5aHealthErrorCode = [string](($command5aHealthOutput | Select-Object -Last 1 | ConvertFrom-Json).errorCode) }
            catch { $command5aHealthErrorCode = 'COMMAND5A_UNCLASSIFIED_FAILURE' }
          }
        }
      } catch {
        if ($command5aScheduleState -eq 'NOT_ATTEMPTED') { $command5aScheduleState = 'FAILED_NONCRITICAL' }
        if ($command5aObservationState -eq 'NOT_ATTEMPTED') { $command5aObservationState = 'FAILED_NONCRITICAL' }
        if ($command5aMaturationState -eq 'NOT_ATTEMPTED') { $command5aMaturationState = 'FAILED_NONCRITICAL' }
      } finally { $ErrorActionPreference = $previousErrorActionPreference }
      $marketSessionDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
        [DateTimeOffset]::UtcNow, 'Eastern Standard Time').ToString('yyyy-MM-dd')
      $lastAlpacaQualificationSession = if (Test-Path -LiteralPath $alpacaQualificationSessionFile) {
        (Get-Content -Raw -LiteralPath $alpacaQualificationSessionFile).Trim()
      } else { '' }
      if ($report.reconciliation.marketOpen -eq $true -and $lastAlpacaQualificationSession -ne $marketSessionDate) {
        $currentOperation = 'ALPACA_INDICATIVE_QUOTE_QUALIFICATION'
        $operationStartedAt = [DateTimeOffset]::UtcNow
        $alpacaQualificationHeaders = $headers.Clone()
        $alpacaQualificationHeaders['X-Theta-Operation'] = 'alpaca-indicative-quote-qualification'
        $alpacaQualification = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $alpacaQualificationHeaders -TimeoutSec 180
        if ($null -ne $alpacaQualification -and $alpacaQualification.qualified -eq $true -and
          $alpacaQualification.marketOpen -eq $true) {
          Set-Content -LiteralPath $alpacaQualificationSessionFile -Value $marketSessionDate -Encoding ascii
        }
      }
      $lastQualificationSession = if (Test-Path -LiteralPath $qualificationSessionFile) {
        (Get-Content -Raw -LiteralPath $qualificationSessionFile).Trim()
      } else { '' }
      if ($report.reconciliation.marketOpen -eq $true -and $lastQualificationSession -ne $marketSessionDate) {
        $currentOperation = 'OPTIONOMICS_QUOTE_QUALIFICATION'
        $operationStartedAt = [DateTimeOffset]::UtcNow
        $qualificationHeaders = $headers.Clone()
        $qualificationHeaders['X-Theta-Operation'] = 'optionomics-quote-qualification'
        $qualification = Invoke-RestMethod -Method Post -Uri $runtime.endpoint -Headers $qualificationHeaders -TimeoutSec 180
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
        Set-Content -LiteralPath $pendingExportSessionFile -Value $marketSessionDate -Encoding ascii
      }
      $pendingExportSession = if (Test-Path -LiteralPath $pendingExportSessionFile) {
        (Get-Content -Raw -LiteralPath $pendingExportSessionFile).Trim()
      } else { '' }
      if ($pendingExportSession -and $lastExportedSession -ne $pendingExportSession -and
        $report.reconciliation.marketOpen -eq $true) {
        $researchExport = 'DEFERRED_MARKET_CRITICAL'
      } elseif ($pendingExportSession -and $lastExportedSession -ne $pendingExportSession) {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $researchProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 600 -Arguments @(
            "--env-file=$productionEnvFile",'--import','tsx','tools/theta-research-export.ts','--latest')
          $researchExit = if ($researchProcess.State -eq 'COMPLETED') { $researchProcess.ExitCode } else { -1 }
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
        if ($researchExit -eq 0) {
          Set-Content -LiteralPath $exportSessionFile -Value $pendingExportSession -Encoding ascii
          Remove-Item -LiteralPath $pendingExportSessionFile -Force
          $researchExport = 'EXPORTED_FIRST_COMPLETE_SCAN'
        } elseif ($researchProcess.State -eq 'TIMED_OUT') {
          $researchExport = 'RESEARCH_EXPORT_PROCESS_TIMEOUT'
        } else {
          $researchExport = 'BLOCKED_ON_EVIDENCE'
        }
      }
      $latestDataset = Join-Path $RepositoryPath 'research_exports\latest\dataset.json'
      $latestManifest = Join-Path $RepositoryPath 'research_exports\latest\manifest.json'
      if ($report.reconciliation.marketOpen -eq $true) {
        if ($researchExport -ne 'DEFERRED_MARKET_CRITICAL') { $researchExport = 'RESEARCH_DEFERRED_MARKET_CRITICAL' }
      } elseif ((Test-Path -LiteralPath $latestDataset) -and (Test-Path -LiteralPath $latestManifest)) {
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
              $pipelineProcess = Invoke-ThetaBoundedProcess -Executable $python -TimeoutSeconds 900 -Arguments @(
                '-m','research.empirical_pipeline','--export',$latestDataset,'--output',(Join-Path $RepositoryPath 'research_outputs'),
                '--evidence-source','LIVE_SHADOW','--strategy-branch','THETA_CONVENTIONAL',
                '--experiment-id',$experimentId,'--target-version','theta-research-targets-v1',
                '--feature-version',([string]$manifest.featureSetVersion),'--cost-model-version','theta-cost-model-v1',
                '--split-definition','NO_SPLIT_DESCRIPTIVE_ONLY','--source-code-commit',([string]$runtime.buildSha),
                '--run-timestamp',$runTimestamp)
              $pipelineExit = if ($pipelineProcess.State -eq 'COMPLETED') { $pipelineProcess.ExitCode } else { -1 }
            } finally { $ErrorActionPreference = $previousErrorActionPreference }
            if ($pipelineExit -eq 0) {
              Set-Content -LiteralPath $researchIdentityFile -Value $researchIdentity -Encoding ascii
              $researchExport = 'EXPORTED_AND_RESEARCHED'
            } elseif ($pipelineProcess.State -eq 'TIMED_OUT') {
              $researchExport = 'RESEARCH_PIPELINE_PROCESS_TIMEOUT'
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
      # Mirror the deterministic research export into a separate, immutable,
      # content-addressed local bundle. This is recovery/research support only,
      # never transactional authority, and failure must not stop broker
      # reconciliation or the Aiven-backed runtime.
      $localEvidenceState = 'NO_EXPORT_AVAILABLE'
      $localEvidenceHash = $null
      if ($report.reconciliation.marketOpen -eq $true) {
        $localEvidenceState = 'DEFERRED_MARKET_CRITICAL'
      } elseif ((Test-Path -LiteralPath $latestDataset) -and (Test-Path -LiteralPath $latestManifest)) {
        try {
          $localEvidenceProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 120 -Arguments @(
            'tools/write-local-durable-evidence.mjs','research_exports/latest',(Join-Path $stateRoot 'evidence'))
          $localEvidenceOutput = $localEvidenceProcess.Output
          if ($localEvidenceProcess.State -eq 'COMPLETED' -and $localEvidenceProcess.ExitCode -eq 0) {
            $localEvidenceResult = $localEvidenceOutput | ConvertFrom-Json
            $localEvidenceState = [string]$localEvidenceResult.state
            $localEvidenceHash = [string]$localEvidenceResult.bundleHash
          } elseif ($localEvidenceProcess.State -eq 'TIMED_OUT') {
            $localEvidenceState = 'PROCESS_TIMEOUT_NONCRITICAL'
          } else { $localEvidenceState = 'FAILED_NONCRITICAL' }
      } catch { $localEvidenceState = 'FAILED_NONCRITICAL' }
      }
      # Storage inventory is operational evidence, but it performs catalog and
      # bounded timestamp-window reads. Run it once per UTC day and only when
      # the supported options session is closed.
      $storageAuditState = if ($report.reconciliation.marketOpen -eq $true) { 'DEFERRED_MARKET_CRITICAL' } else { 'NOT_DUE' }
      $storageAuditDate = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
      $lastStorageAuditDate = if (Test-Path -LiteralPath $storageAuditDateFile) {
        (Get-Content -Raw -LiteralPath $storageAuditDateFile).Trim()
      } else { '' }
      $storageAuditRetryAllowed = $true
      if (Test-Path -LiteralPath $storageAuditFailureFile) {
        try {
          $storageFailure = Get-Content -Raw -LiteralPath $storageAuditFailureFile | ConvertFrom-Json
          $storageRetryAt = [DateTimeOffset]::Parse([string]$storageFailure.nextRetryAt)
          if ($storageRetryAt -gt [DateTimeOffset]::UtcNow) {
            $storageAuditRetryAllowed = $false
            $storageAuditState = "DEFERRED_$([string]$storageFailure.errorCode)"
          }
        } catch { $storageAuditRetryAllowed = $true }
      }
      if ($report.reconciliation.marketOpen -ne $true -and $lastStorageAuditDate -ne $storageAuditDate -and $storageAuditRetryAllowed) {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $storageAuditProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 300 -Arguments @(
            '--import','tsx','tools/theta-storage-audit.ts',"--environment-file=$productionEnvFile",
            "--output-root=$(Join-Path $stateRoot 'storage-audits')")
          $storageAuditOutput = $storageAuditProcess.Output
          $storageAuditExit = if ($storageAuditProcess.State -eq 'COMPLETED') { $storageAuditProcess.ExitCode } else { -1 }
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
        if ($storageAuditExit -eq 0) {
          Set-Content -LiteralPath $storageAuditDateFile -Value $storageAuditDate -Encoding ascii
          Remove-Item -LiteralPath $storageAuditFailureFile -Force -ErrorAction SilentlyContinue
          $storageAuditState = 'CAPTURED'
        } else {
          $storageErrorCode = if ($storageAuditProcess.State -eq 'TIMED_OUT') {
            'STORAGE_AUDIT_PROCESS_TIMEOUT'
          } else { 'UNCLASSIFIED_STORAGE_AUDIT_FAILURE' }
          try {
            $storageAuditResult = $storageAuditOutput | Select-Object -Last 1 | ConvertFrom-Json
            if ([string]$storageAuditResult.errorCode -match '^[A-Z0-9_]+$') {
              $storageErrorCode = [string]$storageAuditResult.errorCode
            }
          } catch { }
          $storageCooldownHours = if ($storageErrorCode -eq '53000') { 12 } `
            elseif ($storageErrorCode -eq '57014') { 1 } else { 0.5 }
          @{errorCode=$storageErrorCode;observedAt=[DateTimeOffset]::UtcNow.ToString('o');
            nextRetryAt=[DateTimeOffset]::UtcNow.AddHours($storageCooldownHours).ToString('o')} |
            ConvertTo-Json -Compress | Set-Content -LiteralPath $storageAuditFailureFile -Encoding utf8
          $storageAuditState = "DEFERRED_$storageErrorCode"
        }
      }
      # PostgreSQL retains the canonical frontier and transactional audit.
      # The Windows owner projects high-volume per-candidate research history
      # into a local SQLite WAL, then compacts verified batches to ZSTD Parquet.
      # Both steps are closed-session and non-critical so research work cannot
      # consume resources needed by the trading worker.
      $localResearchArchiveState = if ($report.reconciliation.marketOpen -eq $true) {
        'DEFERRED_MARKET_CRITICAL'
      } else { 'NOT_ATTEMPTED' }
      $localResearchArchiveRows = 0
      $localResearchArchiveFailureFamily = $null
      $localResearchTransferQuotaState = 'TRANSFER_QUOTA_OPEN'
      $localResearchArchiveNextRetryAt = $null
      $localResearchSpoolRows = 0
      $localResearchPendingCompactionRows = 0
      $localResearchActiveSpoolBytes = 0
      $localResearchTotalBytes = 0
      $localResearchStorageWatermark = 'NORMAL'
      $localResearchParquetFiles = 0
      $localResearchParquetBytes = 0
      $localResearchLastManifestHash = $null
      $localResearchDuckdbVerification = 'NOT_AVAILABLE'
      $localResearchParquetState = if ($report.reconciliation.marketOpen -eq $true) {
        'DEFERRED_MARKET_CRITICAL'
      } else { 'NOT_ATTEMPTED' }
      if ($report.reconciliation.marketOpen -ne $true) {
        $researchSpoolPath = Join-Path $stateRoot 'research-spool\theta-research.sqlite'
        $researchArchiveHealthPath = Join-Path $stateRoot 'research-spool\archive-health.json'
        $researchParquetRoot = $command5aParquetRoot
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $archiveProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 600 -Arguments @(
            '--import','tsx','tools/archive-canonical-strategy-frontiers.ts',
            "--environment-file=$productionEnvFile","--sqlite=$researchSpoolPath",
            "--scheduler=$command5aSchedulerPath","--health=$researchArchiveHealthPath",
            "--parquet-root=$researchParquetRoot","--since=$($runtime.installedAt)",
            "--source-sha=$($runtime.buildSha)",'--limit=10000')
          $archiveOutput = $archiveProcess.Output
          if ($archiveProcess.State -eq 'COMPLETED' -and $archiveProcess.ExitCode -eq 0) {
            $archiveResult = $archiveOutput | ConvertFrom-Json
            $localResearchArchiveState = [string]$archiveResult.state
            $localResearchArchiveRows = [int]$archiveResult.researchRowCount
            if ($null -ne $archiveResult.health) {
              $localResearchArchiveFailureFamily = [string]$archiveResult.health.failureFamily
              $localResearchTransferQuotaState = [string]$archiveResult.health.transferQuotaState
              $localResearchArchiveNextRetryAt = [string]$archiveResult.health.nextRetryAt
            }
          } elseif ($archiveProcess.State -eq 'TIMED_OUT') {
            $localResearchArchiveState = 'PROCESS_TIMEOUT_NONCRITICAL'
          } else { $localResearchArchiveState = 'FAILED_NONCRITICAL' }
          $compactorPython = Join-Path $RepositoryPath '.venv\Scripts\python.exe'
          if (!(Test-Path -LiteralPath $compactorPython)) { $compactorPython = 'python' }
          $duckdbProbe = Invoke-ThetaBoundedProcess -Executable $compactorPython -TimeoutSeconds 30 -Arguments @('-c','import duckdb')
          if (($duckdbProbe.State -ne 'COMPLETED' -or $duckdbProbe.ExitCode -ne 0) -and $compactorPython -ne 'python') {
            $compactorPython = 'python'
            $duckdbProbe = Invoke-ThetaBoundedProcess -Executable $compactorPython -TimeoutSeconds 30 -Arguments @('-c','import duckdb')
          }
          $duckdbAvailable = $duckdbProbe.State -eq 'COMPLETED' -and $duckdbProbe.ExitCode -eq 0
          if ($duckdbAvailable) {
            $parquetProcess = Invoke-ThetaBoundedProcess -Executable $compactorPython -TimeoutSeconds 600 -Arguments @(
              'tools/compact-local-research-spool.py',"--sqlite=$researchSpoolPath",
              "--destination=$researchParquetRoot",'--limit=1000')
            $parquetOutput = $parquetProcess.Output
            if ($parquetProcess.State -eq 'COMPLETED' -and $parquetProcess.ExitCode -eq 0) {
              $parquetResult = $parquetOutput | ConvertFrom-Json
              $localResearchParquetState = [string]$parquetResult.state
            } elseif ($parquetProcess.State -eq 'TIMED_OUT') {
              $localResearchParquetState = 'PROCESS_TIMEOUT_NONCRITICAL'
            } else { $localResearchParquetState = 'FAILED_NONCRITICAL' }
          } elseif ($duckdbProbe.State -eq 'TIMED_OUT') {
            $localResearchParquetState = 'DEPENDENCY_PROBE_PROCESS_TIMEOUT_NONCRITICAL'
          } else { $localResearchParquetState = 'DEPENDENCY_UNAVAILABLE_NONCRITICAL' }
          $parquetVerification = 'NOT_AVAILABLE'
          if ($duckdbAvailable) {
            $verificationProcess = Invoke-ThetaBoundedProcess -Executable $compactorPython -TimeoutSeconds 300 -Arguments @(
              'tools/verify-local-research-parquet.py',"--root=$researchParquetRoot",
              "--cache=$(Join-Path $stateRoot 'research-spool\parquet-verification-cache.json')")
            $verificationOutput = $verificationProcess.Output
            if ($verificationProcess.State -eq 'COMPLETED' -and $verificationProcess.ExitCode -eq 0) {
              $verificationResult = $verificationOutput | ConvertFrom-Json
              $parquetVerification = [string]$verificationResult.state
            } elseif ($verificationProcess.State -eq 'TIMED_OUT') {
              $parquetVerification = 'PROCESS_TIMEOUT'
            } else { $parquetVerification = 'FAILED' }
          }
          $healthProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 60 -Arguments @(
            '--import','tsx','tools/archive-canonical-strategy-frontiers.ts',"--sqlite=$researchSpoolPath",
            "--scheduler=$command5aSchedulerPath","--health=$researchArchiveHealthPath",
            "--parquet-root=$researchParquetRoot","--duckdb-verification=$parquetVerification",'--health-only')
          $healthOutput = $healthProcess.Output
          if ($healthProcess.State -eq 'COMPLETED' -and $healthProcess.ExitCode -eq 0) {
            $healthResult = $healthOutput | ConvertFrom-Json
            $localResearchSpoolRows = [int]$healthResult.health.spoolRows
            $localResearchPendingCompactionRows = [int]$healthResult.health.pendingCompactionRows
            $localResearchActiveSpoolBytes = [long]$healthResult.health.activeSpoolBytes
            $localResearchTotalBytes = [long]$healthResult.health.totalLocalResearchBytes
            $localResearchStorageWatermark = [string]$healthResult.health.spoolWatermark
            $localResearchParquetFiles = [int]$healthResult.health.parquetFiles
            $localResearchParquetBytes = [long]$healthResult.health.parquetBytes
            $localResearchLastManifestHash = [string]$healthResult.health.lastManifestHash
            $localResearchDuckdbVerification = [string]$healthResult.health.duckdbVerification
            $localResearchArchiveFailureFamily = [string]$healthResult.health.failureFamily
            $localResearchTransferQuotaState = [string]$healthResult.health.transferQuotaState
            $localResearchArchiveNextRetryAt = [string]$healthResult.health.nextRetryAt
          } elseif ($healthProcess.State -eq 'TIMED_OUT') {
            $localResearchArchiveFailureFamily = 'ARCHIVE_HEALTH_PROCESS_TIMEOUT'
            $localResearchDuckdbVerification = 'ARCHIVE_HEALTH_PROCESS_TIMEOUT'
          }
        } catch {
          if ($localResearchArchiveState -eq 'NOT_ATTEMPTED') { $localResearchArchiveState = 'FAILED_NONCRITICAL' }
          if ($localResearchParquetState -eq 'NOT_ATTEMPTED') { $localResearchParquetState = 'FAILED_NONCRITICAL' }
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
      }
      # Keep a sanitized, append-only local recovery mirror of operational
      # receipts. Aiven remains runtime authority. The writer accepts only a
      # fixed safe schema and cannot persist credentials, account identifiers,
      # symbols, positions, or raw provider payloads.
      $localReceiptState = 'NOT_WRITTEN'
      $localReceiptHash = $null
      try {
        $receiptInput = @{ observedAt=(Get-Date).ToUniversalTime().ToString('o'); marketSessionDate=$marketSessionDate;
          buildSha=$runtime.buildSha;mode='MASTER_THETA_PAPER';executionGate=[string]$report.executionGate;
          researchExport=$researchExport;scopes=@{BROKER=$brokerReport;LIFECYCLE=$lifecycleReport;
            MANAGEMENT=$managementReport;OBSERVATION=$observationReport;EVIDENCE=$report} } |
          ConvertTo-Json -Depth 12 -Compress
        $receiptProcess = Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 30 -Arguments @(
          'tools/write-local-runtime-receipt.mjs',(Join-Path $stateRoot 'receipts')) -StandardInputText $receiptInput
        $receiptOutput = $receiptProcess.Output
        if ($receiptProcess.State -eq 'COMPLETED' -and $receiptProcess.ExitCode -eq 0) {
          $receiptResult = $receiptOutput | ConvertFrom-Json
          $localReceiptState = [string]$receiptResult.state
          $localReceiptHash = [string]$receiptResult.receiptHash
        } elseif ($receiptProcess.State -eq 'TIMED_OUT') {
          $localReceiptState = 'PROCESS_TIMEOUT'
        } else { $localReceiptState = 'FAILED' }
      } catch { $localReceiptState = 'FAILED' }
      @{state='ONLINE';lastCycle=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='MASTER_THETA_PAPER';executionGate=[string]$report.executionGate;researchExport=$researchExport;
        databaseCircuitState='DB_HEALTHY';decisionAuthority='AVAILABLE';carryForwardCandidateAllowed=$false;
        storageAuditState=$storageAuditState;
        localResearchArchiveState=$localResearchArchiveState;localResearchArchiveRows=$localResearchArchiveRows;
        localResearchParquetState=$localResearchParquetState;
        localResearchArchiveFailureFamily=$localResearchArchiveFailureFamily;
        localResearchTransferQuotaState=$localResearchTransferQuotaState;
        localResearchArchiveNextRetryAt=$localResearchArchiveNextRetryAt;
        localResearchSpoolRows=$localResearchSpoolRows;
        localResearchPendingCompactionRows=$localResearchPendingCompactionRows;
        localResearchActiveSpoolBytes=$localResearchActiveSpoolBytes;
        localResearchTotalBytes=$localResearchTotalBytes;
        localResearchStorageWatermark=$localResearchStorageWatermark;
        localResearchParquetFiles=$localResearchParquetFiles;localResearchParquetBytes=$localResearchParquetBytes;
        localResearchLastManifestHash=$localResearchLastManifestHash;
        localResearchDuckdbVerification=$localResearchDuckdbVerification;
        command5aScheduleState=$command5aScheduleState;command5aScheduleErrorCode=$command5aScheduleErrorCode;
        command5aObservationState=$command5aObservationState;command5aObservationErrorCode=$command5aObservationErrorCode;
        command5aMaturationState=$command5aMaturationState;command5aMaturationErrorCode=$command5aMaturationErrorCode;
        command5aSchedulingPausedForStorage=$command5aSchedulingPausedForStorage;
        command5aObserved=$command5aObserved;command5aMissed=$command5aMissed;
        command5aDeferredProvider=$command5aDeferredProvider;command5aDeferredMarket=$command5aDeferredMarket;
        command5aCensoredRetryExhausted=$command5aCensoredRetryExhausted;
        command5aMaterialized=$command5aMaterialized;command5aMaturationPending=$command5aMaturationPending;
        command5aMaturationCensored=$command5aMaturationCensored;
        command5aBacklogState=$command5aBacklogState;command5aHealthErrorCode=$command5aHealthErrorCode;
        command5aUnresolvedJobs=$command5aUnresolvedJobs;
        command5aDueJobs=$command5aDueJobs;command5aOverdueJobs=$command5aOverdueJobs;
        command5aExpiredClaims=$command5aExpiredClaims;command5aRetryStalledJobs=$command5aRetryStalledJobs;
        command5aOldestOverdueSeconds=$command5aOldestOverdueSeconds;command5aSourceCursor=$command5aSourceCursor;
        localReceiptState=$localReceiptState;localReceiptHash=$localReceiptHash;
        localEvidenceState=$localEvidenceState;localEvidenceHash=$localEvidenceHash} | ConvertTo-Json |
        Set-Content -LiteralPath $statusFile -Encoding utf8
      $delaySeconds = 5
    } catch {
      $workerExit = 1
      $failedAt = [DateTimeOffset]::UtcNow
      $httpStatus = if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
        [int]$_.Exception.Response.StatusCode
      } else { $null }
      $exceptionType = $_.Exception.GetType().Name
      $failureCode = if ($null -ne $httpStatus) { "HTTP_$httpStatus" }
        elseif ($exceptionType -match '^[A-Za-z0-9_.-]{1,96}$') { "LOCAL_$exceptionType" }
        else { 'LOCAL_WORKER_LOOP_FAILED' }
      # Read only the server's explicit safe-error-code header. Never inspect
      # an error body, request URL, exception message, or authentication header.
      $serverErrorCode = $null
      if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.Headers) {
        $candidateCode = [string]$_.Exception.Response.Headers['X-Theta-Safe-Error-Code']
        if ($candidateCode -cmatch '^(POSTGRES|ALPACA|OPTIONOMICS|RUNTIME|THETA)_[A-Z0-9_]{2,87}$') { $serverErrorCode = $candidateCode }
      }
      @{state='DEGRADED';lastFailure=$failedAt.ToString('o');buildSha=$runtime.buildSha;
        mode='MASTER_THETA_PAPER';executionGate='LOCKED';failureCode=$failureCode;
        serverErrorCode=$serverErrorCode;
        failedOperation=$currentOperation;operationStartedAt=$operationStartedAt.ToString('o');
        elapsedMilliseconds=[Math]::Max(0,[Math]::Round(($failedAt - $operationStartedAt).TotalMilliseconds))} | ConvertTo-Json |
        Set-Content -LiteralPath $statusFile -Encoding utf8
      if ($serverErrorCode -eq 'RUNTIME_SCHEMA_INCOMPATIBLE') {
        @{state='SCHEMA_INCOMPATIBLE';lastFailure=$failedAt.ToString('o');buildSha=$runtime.buildSha;
          mode='MASTER_THETA_PAPER';executionGate='LOCKED';failureCode=$failureCode;
          serverErrorCode=$serverErrorCode;failedOperation=$currentOperation;
          decisionAuthority='INFRASTRUCTURE_DEFERRED';leaseAcquired=$false;
          cycleStarted=$false;strategyEvidenceRecorded=$false} | ConvertTo-Json |
          Set-Content -LiteralPath $statusFile -Encoding utf8
      }
      if ($serverErrorCode -cmatch '^POSTGRES_(53[0-9A-Z]{3}|57P03|57P01|08[0-9A-Z]{3}|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|CONNECTION_TERMINATED|CONNECTION_ACQUISITION_TIMEOUT|CHECKED_OUT_CLIENT_LOST|COMMIT_OUTCOME_UNKNOWN)$') {
        # Preserve a sanitized, physically read-only broker observation even
        # when the canonical evidence cycle lost Postgres. The probe cannot
        # submit orders and its local spool is never sufficient mutation proof.
        if ($currentOperation -eq 'RUNTIME_EVIDENCE_CYCLE') {
          $previousErrorActionPreference = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          try {
            [void](Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 180 -Arguments @(
              '--import','tsx','tools/theta-no-submit-probe.ts',"--environment-file=$productionEnvFile"))
          } finally {
            $ErrorActionPreference = $previousErrorActionPreference
          }
        }
        $databaseRecoveryMode = $true
        $databaseRecoverySuccesses = 0
        $databaseConsecutiveFailures++
        $databaseCircuitState = if ($databaseConsecutiveFailures -ge 2) { 'DB_CIRCUIT_OPEN' } else { 'DB_TRANSIENT_FAILURE' }
        @{state='INFRASTRUCTURE_DEFERRED';lastFailure=$failedAt.ToString('o');buildSha=$runtime.buildSha;
          mode='MASTER_THETA_PAPER';executionGate='LOCKED';failureCode=$failureCode;serverErrorCode=$serverErrorCode;
          failedOperation=$currentOperation;databaseCircuitState=$databaseCircuitState;
          databaseConsecutiveFailures=$databaseConsecutiveFailures;decisionAuthority='INFRASTRUCTURE_DEFERRED';
          carryForwardCandidateAllowed=$false;strategyEvidenceRecorded=$false} | ConvertTo-Json |
          Set-Content -LiteralPath $statusFile -Encoding utf8
      }
      # Phase 2 Pass B Final Closure C (directive sections 13-15): a DB/
      # provider failure at an earlier per-cycle step must not silently
      # erase basic local operational evidence just because it happened
      # before the normal success-receipt write further up in this try.
      # Computed independently of any step above (never assumes a step
      # that may not have run actually ran), wrapped in its own try/catch
      # so a receipt-write failure can never itself become a new failure
      # source -- this must never affect $workerExit or fail-closed
      # semantics either way.
      try {
        $failureMarketSessionDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
          [DateTimeOffset]::UtcNow, 'Eastern Standard Time').ToString('yyyy-MM-dd')
        $failureReceiptInput = @{ observedAt=$failedAt.ToUniversalTime().ToString('o');
          marketSessionDate=$failureMarketSessionDate; buildSha=$runtime.buildSha; mode='MASTER_THETA_PAPER';
          workerId=$runtime.workerId; failureCode=$failureCode; failedOperation=$currentOperation;
          marketOpen=$null } | ConvertTo-Json -Compress
        [void](Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 30 -Arguments @(
          'tools/write-local-runtime-receipt.mjs','--failure',(Join-Path $stateRoot 'receipts')) `
          -StandardInputText $failureReceiptInput)
      } catch { }
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
  # A contender that never owned the supervisor cannot release its lease or
  # overwrite its status. This also covers exit 23 during a cutover race.
  if ($owned) {
    try {
      if ($token.Length -ge 32) {
        $headers = @{ Authorization="Bearer $token"; 'X-Theta-Worker-Id'=$runtime.workerId;
          'X-Theta-Host-Id'=$env:COMPUTERNAME; 'X-Theta-Build-Sha'=$runtime.buildSha }
        Invoke-RestMethod -Method Delete -Uri $runtime.endpoint -Headers $headers -TimeoutSec 15 | Out-Null
      }
    } catch {}
    try {
      @{state='OFFLINE';lastShutdown=(Get-Date).ToUniversalTime().ToString('o');buildSha=$runtime.buildSha;
        mode='MASTER_THETA_PAPER';executionGate='LOCKED'} | ConvertTo-Json |
        Set-Content -LiteralPath $statusFile -Encoding utf8
    } finally { $mutex.ReleaseMutex() }
  }
  $mutex.Dispose()
}
