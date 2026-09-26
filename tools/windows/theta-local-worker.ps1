param([string]$ControlRoot = '')
$ErrorActionPreference = 'Stop'

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
            & node --import tsx tools/theta-local-evidence-backfill.ts "--environment-file=$productionEnvFile" *> $null
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
          & node "--env-file=$productionEnvFile" --import tsx tools/theta-research-export.ts --latest *> $null
          $researchExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
        if ($researchExit -eq 0) {
          Set-Content -LiteralPath $exportSessionFile -Value $pendingExportSession -Encoding ascii
          Remove-Item -LiteralPath $pendingExportSessionFile -Force
          $researchExport = 'EXPORTED_FIRST_COMPLETE_SCAN'
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
          $localEvidenceOutput = & node tools/write-local-durable-evidence.mjs research_exports/latest (Join-Path $stateRoot 'evidence')
          if ($LASTEXITCODE -eq 0) {
            $localEvidenceResult = $localEvidenceOutput | ConvertFrom-Json
            $localEvidenceState = [string]$localEvidenceResult.state
            $localEvidenceHash = [string]$localEvidenceResult.bundleHash
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
          $storageAuditOutput = & node --import tsx tools/theta-storage-audit.ts "--environment-file=$productionEnvFile" `
            "--output-root=$(Join-Path $stateRoot 'storage-audits')"
          $storageAuditExit = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousErrorActionPreference }
        if ($storageAuditExit -eq 0) {
          Set-Content -LiteralPath $storageAuditDateFile -Value $storageAuditDate -Encoding ascii
          Remove-Item -LiteralPath $storageAuditFailureFile -Force -ErrorAction SilentlyContinue
          $storageAuditState = 'CAPTURED'
        } else {
          $storageErrorCode = 'UNCLASSIFIED_STORAGE_AUDIT_FAILURE'
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
      $localResearchParquetFiles = 0
      $localResearchLastManifestHash = $null
      $localResearchDuckdbVerification = 'NOT_AVAILABLE'
      $localResearchParquetState = if ($report.reconciliation.marketOpen -eq $true) {
        'DEFERRED_MARKET_CRITICAL'
      } else { 'NOT_ATTEMPTED' }
      if ($report.reconciliation.marketOpen -ne $true) {
        $researchSpoolPath = Join-Path $stateRoot 'research-spool\theta-research.sqlite'
        $researchArchiveHealthPath = Join-Path $stateRoot 'research-spool\archive-health.json'
        $researchParquetRoot = 'C:\ProjectBackups\trading-bots\research-archives'
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
          $archiveOutput = & node --import tsx tools/archive-canonical-strategy-frontiers.ts `
            "--environment-file=$productionEnvFile" "--sqlite=$researchSpoolPath" `
            "--health=$researchArchiveHealthPath" "--parquet-root=$researchParquetRoot" `
            "--since=$($runtime.installedAt)" "--source-sha=$($runtime.buildSha)" --limit=10000
          $archiveExit = $LASTEXITCODE
          if ($archiveExit -eq 0) {
            $archiveResult = $archiveOutput | ConvertFrom-Json
            $localResearchArchiveState = [string]$archiveResult.state
            $localResearchArchiveRows = [int]$archiveResult.researchRowCount
            if ($null -ne $archiveResult.health) {
              $localResearchArchiveFailureFamily = [string]$archiveResult.health.failureFamily
              $localResearchTransferQuotaState = [string]$archiveResult.health.transferQuotaState
              $localResearchArchiveNextRetryAt = [string]$archiveResult.health.nextRetryAt
            }
          } else { $localResearchArchiveState = 'FAILED_NONCRITICAL' }
          $compactorPython = Join-Path $RepositoryPath '.venv\Scripts\python.exe'
          if (!(Test-Path -LiteralPath $compactorPython)) { $compactorPython = 'python' }
          & $compactorPython -c 'import duckdb' *> $null
          if ($LASTEXITCODE -ne 0 -and $compactorPython -ne 'python') {
            $compactorPython = 'python'
            & $compactorPython -c 'import duckdb' *> $null
          }
          $duckdbAvailable = $LASTEXITCODE -eq 0
          if ($duckdbAvailable) {
            $parquetOutput = & $compactorPython tools/compact-local-research-spool.py `
              "--sqlite=$researchSpoolPath" "--destination=$researchParquetRoot" --limit=1000
            $parquetExit = $LASTEXITCODE
            if ($parquetExit -eq 0) {
              $parquetResult = $parquetOutput | ConvertFrom-Json
              $localResearchParquetState = [string]$parquetResult.state
            } else { $localResearchParquetState = 'FAILED_NONCRITICAL' }
          } else { $localResearchParquetState = 'DEPENDENCY_UNAVAILABLE_NONCRITICAL' }
          $parquetVerification = 'NOT_AVAILABLE'
          if ($duckdbAvailable) {
            $verificationOutput = & $compactorPython tools/verify-local-research-parquet.py `
              "--root=$researchParquetRoot" `
              "--cache=$(Join-Path $stateRoot 'research-spool\parquet-verification-cache.json')"
            if ($LASTEXITCODE -eq 0) {
              $verificationResult = $verificationOutput | ConvertFrom-Json
              $parquetVerification = [string]$verificationResult.state
            } else { $parquetVerification = 'FAILED' }
          }
          $healthOutput = & node --import tsx tools/archive-canonical-strategy-frontiers.ts `
            "--sqlite=$researchSpoolPath" "--health=$researchArchiveHealthPath" `
            "--parquet-root=$researchParquetRoot" "--duckdb-verification=$parquetVerification" --health-only
          if ($LASTEXITCODE -eq 0) {
            $healthResult = $healthOutput | ConvertFrom-Json
            $localResearchSpoolRows = [int]$healthResult.health.spoolRows
            $localResearchPendingCompactionRows = [int]$healthResult.health.pendingCompactionRows
            $localResearchParquetFiles = [int]$healthResult.health.parquetFiles
            $localResearchLastManifestHash = [string]$healthResult.health.lastManifestHash
            $localResearchDuckdbVerification = [string]$healthResult.health.duckdbVerification
            $localResearchArchiveFailureFamily = [string]$healthResult.health.failureFamily
            $localResearchTransferQuotaState = [string]$healthResult.health.transferQuotaState
            $localResearchArchiveNextRetryAt = [string]$healthResult.health.nextRetryAt
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
        $receiptOutput = $receiptInput | & node tools/write-local-runtime-receipt.mjs (Join-Path $stateRoot 'receipts')
        if ($LASTEXITCODE -eq 0) {
          $receiptResult = $receiptOutput | ConvertFrom-Json
          $localReceiptState = [string]$receiptResult.state
          $localReceiptHash = [string]$receiptResult.receiptHash
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
        localResearchParquetFiles=$localResearchParquetFiles;
        localResearchLastManifestHash=$localResearchLastManifestHash;
        localResearchDuckdbVerification=$localResearchDuckdbVerification;
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
            & node --import tsx tools/theta-no-submit-probe.ts "--environment-file=$productionEnvFile" *> $null
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
        $failureReceiptInput | & node tools/write-local-runtime-receipt.mjs --failure (Join-Path $stateRoot 'receipts') *> $null
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
