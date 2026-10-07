#Requires -Version 7
param(
  [string]$BackupRoot,
  [string]$RollbackBackupId='2026-09-27_184220-9fd5a02d',
  [string]$RollbackArchiveSha256='ba534c155eb0c96cfe3a79d1fee74772357831c3c40782e863e32f649703a604',
  [string]$RecoveryGateReceiptPath='.theta-local-worker\receipts\database-recovery-gate-latest.json'
)
# DEPRECATED (2026-10-07): this was the one-off continuation for the 067 checkpoint incident (it pins schema 067 and a 064 rollback
# anchor and validates .env.local, a NON-Production database). It must never run again. The governed path is
# Invoke-ThetaProductionMigration.ps1, which runs the storage audit and stability soak against the migrated (process-target) database and
# takes the verified post-migration backup itself. Kept only as the audited record of that incident.
throw 'DEPRECATED_067_ERA_POST_MIGRATION_CONTINUATION: use tools/windows/dr/Invoke-ThetaProductionMigration.ps1'
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
. (Join-Path $PSScriptRoot 'ThetaTime.Common.ps1')
. (Join-Path $PSScriptRoot '..\ThetaProcess.Common.ps1')
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$root=Get-ThetaBackupRoot $BackupRoot
$mutex=[Threading.Mutex]::new($false,'Local\THETA_POST_MIGRATION_CONTINUATION')
$owned=$false;$pushed=$false;$post=$null;$soak=$null
try{
  try{$owned=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
  if(-not$owned){throw 'POST_MIGRATION_CONTINUATION_ALREADY_RUNNING'}
  Push-Location $repoRoot
  $pushed=$true
  $head=(git rev-parse HEAD).Trim();$origin=(git rev-parse origin/main).Trim()
  if($LASTEXITCODE-ne0-or$head-ne$origin-or(git status --porcelain)){throw 'POST_MIGRATION_SOURCE_NOT_CLEAN_EXACT_MAIN'}
  $gatePath=[IO.Path]::GetFullPath((Join-Path $repoRoot $RecoveryGateReceiptPath))
  $gateRaw=Get-Content -Raw -LiteralPath $gatePath
  $gate=$gateRaw|ConvertFrom-Json
  $completedAtRaw=$null
  $gateDocument=$null
  try{
    $gateDocument=[Text.Json.JsonDocument]::Parse($gateRaw)
    $completedAtElement=$gateDocument.RootElement.GetProperty('completedAt')
    if($completedAtElement.ValueKind-eq[Text.Json.JsonValueKind]::String){$completedAtRaw=$completedAtElement.GetString()}
  }catch{
    $completedAtRaw=$null
  }finally{
    if($gateDocument){$gateDocument.Dispose()}
  }
  if($gate.state-ne'RECOVERY_GATE_SATISFIED'-or-not$gate.checkpointRetryEligible-or$gate.sourceSha-ne$head){
    throw 'POST_MIGRATION_RECOVERY_GATE_INVALID_OR_STALE'
  }
  try{[void](Assert-ThetaFreshMachineTimestamp -Timestamp $completedAtRaw -MaxAgeSeconds 600 -MaxFutureSkewSeconds 30)}
  catch{throw "POST_MIGRATION_RECOVERY_GATE_INVALID_OR_STALE:$($_.Exception.Message)"}
  $rollbackPath=Join-Path $root "daily\$RollbackBackupId"
  if(-not(Test-ThetaVerifiedBackupDirectory -BackupDirectory $rollbackPath -ExpectedBackupId $RollbackBackupId `
      -ExpectedArchiveSha256 $RollbackArchiveSha256)){throw 'ORIGINAL_SCHEMA_064_ROLLBACK_ANCHOR_INVALID'}
  $backupLock=$null
  try{$backupLock=Enter-ThetaBackupProcessLock $root}finally{Exit-ThetaBackupProcessLock $backupLock}
  $battery=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue|Select-Object -First 1
  if($battery-and$battery.BatteryStatus-eq1-and$battery.EstimatedChargeRemaining-lt40){throw 'POST_MIGRATION_POWER_UNSAFE'}
  if((Get-PSDrive -Name $root.Substring(0,1)).Free-lt8GB){throw 'POST_MIGRATION_DISK_SPACE_UNSAFE'}
  $status=(powershell -NoProfile -ExecutionPolicy Bypass -File tools/windows/status-theta-local-worker.ps1|ConvertFrom-Json)
  if($status.supervisorProcessCount-ne0-or$status.effectiveState-ne'NOT_RUNNING'){throw 'POST_MIGRATION_WORKER_NOT_STOPPED'}
  foreach($spec in @(
    @{Name='preflight';Timeout=180;Args=@('--import','tsx','tools/theta-post-migration-resume-preflight.ts','--environment-file=.env.local')},
    @{Name='verify';Timeout=600;Args=@('tools/database-verify.mjs','--environment-file=.env.local')},
    @{Name='storage';Timeout=300;Args=@('--import','tsx','tools/theta-storage-audit.ts','--environment-file=.env.local')}
  )){
    $result=Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds $spec.Timeout -Arguments $spec.Args
    if($result.State-ne'COMPLETED'-or$result.ExitCode-ne0){throw "POST_MIGRATION_$($spec.Name.ToUpperInvariant())_FAILED"}
    $receipt=($result.Output|Select-Object -Last 1)|ConvertFrom-Json
    if($receipt.state-ne'PASS'-and$receipt.state-ne'CONNECTED'){throw "POST_MIGRATION_$($spec.Name.ToUpperInvariant())_INCOMPLETE"}
    if($spec.Name-eq'storage'-and$receipt.unknownClassificationCount-ne0){throw 'POST_MIGRATION_STORAGE_UNKNOWN_CLASSIFICATION'}
  }
  $soakProcess=Invoke-ThetaBoundedProcess -Executable 'node' -TimeoutSeconds 1020 -Arguments @('--import','tsx',
    'tools/theta-postgres-stability-soak.ts','--environment-file=.env.local','--duration-seconds=900')
  $soakLog=Join-Path $root ('logs\post-migration-soak-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.jsonl')
  [IO.File]::WriteAllLines($soakLog,[string[]]$soakProcess.Output,[Text.UTF8Encoding]::new($false))
  if($soakProcess.State-ne'COMPLETED'-or$soakProcess.ExitCode-ne0){throw 'POST_MIGRATION_CONTINUATION_SOAK_FAILED'}
  $soak=($soakProcess.Output|Select-Object -Last 1)|ConvertFrom-Json
  if($soak.result-ne'PASS'-or$soak.requestedDurationSeconds-lt900){throw 'POST_MIGRATION_CONTINUATION_SOAK_INCOMPLETE'}
  $backup=Invoke-ThetaBoundedProcess -Executable (Join-Path $PSHOME 'pwsh.exe') -TimeoutSeconds 21600 -Arguments @(
    '-NoProfile','-File',(Join-Path $PSScriptRoot 'Backup-Theta.ps1'),'-BackupRoot',$root)
  if($backup.State-ne'COMPLETED'-or$backup.ExitCode-ne0){throw 'POST_MIGRATION_CONTINUATION_BACKUP_FAILED'}
  $post=($backup.Output|ConvertFrom-Json)
  $verification=Get-Content -Raw -LiteralPath (Join-Path $post.path 'verification.json')|ConvertFrom-Json
  $restore=Get-Content -Raw -LiteralPath (Join-Path $post.path 'restore-verification.json')|ConvertFrom-Json
  if($post.state-ne'VERIFIED'-or$verification.sourceMigrationHead-ne'067_postgres_cycle_evidence_compaction'-or
      $restore.migrationHead-ne'067_postgres_cycle_evidence_compaction'-or$restore.structureParity-ne'PASS'-or
      $restore.dataRowcountParity-ne'PASS'-or$restore.criticalDataVerification-ne'PASS'){
    throw 'POST_MIGRATION_CONTINUATION_RESTORE_PARITY_FAILED'
  }
  $receipt=[ordered]@{contractVersion='theta-post-migration-continuation-v1';state='PASS';completedAt=[DateTimeOffset]::UtcNow.ToString('o');
    sourceSha=$head;originalRollbackBackupId=$RollbackBackupId;originalRollbackArchiveSha256=$RollbackArchiveSha256;
    schemaHead='067_postgres_cycle_evidence_compaction';soakReceiptHash=$soak.receiptHash;
    postMigrationBackupId=$post.backupId;postMigrationArchiveSha256=$post.archiveSha256;postMigrationRestoreParity='PASS'}
  Write-ThetaJson (Join-Path $root ('logs\post-migration-continuation-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')) $receipt
  $receipt|ConvertTo-Json -Compress
}catch{
  $code=$_.Exception.Message-replace'postgres(ql)?://[^ ]+','[REDACTED_DATABASE_URL]'
  Write-ThetaJson (Join-Path $root ('logs\post-migration-continuation-failed-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')) `
    ([ordered]@{contractVersion='theta-post-migration-continuation-v1';state='FAILED';failedAt=[DateTimeOffset]::UtcNow.ToString('o');reason=$code;
      postMigrationBackupId=$(if($post){$post.backupId}else{$null});soakReceiptHash=$(if($soak){$soak.receiptHash}else{$null})})
  throw $code
}finally{if($pushed){Pop-Location};if($owned){$mutex.ReleaseMutex()};$mutex.Dispose()}
