#Requires -Version 7
param([string]$BackupRoot)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$root = Get-ThetaBackupRoot $BackupRoot
$pwsh = Join-Path $PSHOME 'pwsh.exe'
$before = $null
$after = $null
$storage = $null
$soak = $null
$oldAuthority = $env:DATABASE_RUNTIME_AUTHORITY
$oldAiven = $env:AIVEN_DATABASE_URL
$oldDatabase = $env:DATABASE_URL
$oldCheckpoint = $env:THETA_MIGRATION_CHECKPOINT_ACTIVE
try {
  $beforeRaw = & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Backup-Theta.ps1') -BackupRoot $root
  if ($LASTEXITCODE -ne 0) { throw 'PRE_MIGRATION_VERIFIED_BACKUP_FAILED' }
  $before = $beforeRaw | ConvertFrom-Json
  if ($before.state -ne 'VERIFIED') { throw 'PRE_MIGRATION_VERIFIED_BACKUP_FAILED' }
  $proof = Get-Content -Raw -LiteralPath (Join-Path $before.path 'restore-verification.json') | ConvertFrom-Json
  if ($proof.structureParity -ne 'PASS' -or $proof.dataRowcountParity -ne 'PASS' -or
      $proof.criticalDataVerification -ne 'PASS') { throw 'PRE_MIGRATION_RESTORE_PARITY_FAILED' }
  $env:DATABASE_RUNTIME_AUTHORITY = 'AIVEN'
  $env:AIVEN_DATABASE_URL = Get-ThetaSourceUrl $root
  $env:DATABASE_URL = $env:AIVEN_DATABASE_URL
  $env:THETA_MIGRATION_CHECKPOINT_ACTIVE = 'VERIFIED_LOCAL_BACKUP'
  Push-Location $repoRoot
  try {
    & node tools/database-migrate.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PRODUCTION_MIGRATION_FAILED_PRE_BACKUP_PRESERVED' }
    & node tools/database-verify.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'POST_MIGRATION_SCHEMA_INVARIANT_FAILED_PRE_BACKUP_PRESERVED' }
    $storageRaw = & node --import tsx tools/theta-storage-audit.ts --environment-file=.env.local
    if ($LASTEXITCODE -ne 0) { throw 'POST_MIGRATION_STORAGE_AUDIT_FAILED_PRE_BACKUP_PRESERVED' }
    $storage = ($storageRaw | Select-Object -Last 1) | ConvertFrom-Json
    if ($storage.state -ne 'PASS' -or $storage.unknownClassificationCount -ne 0) {
      throw 'POST_MIGRATION_STORAGE_AUDIT_INCOMPLETE_PRE_BACKUP_PRESERVED'
    }
    $soakRaw = & node --import tsx tools/theta-postgres-stability-soak.ts --environment-file=.env.local --duration-seconds=900
    $soakExitCode = $LASTEXITCODE
    $soakLog = Join-Path $root ('logs\database-stability-soak-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.jsonl')
    [IO.File]::WriteAllLines($soakLog, [string[]]$soakRaw, [Text.UTF8Encoding]::new($false))
    if ($soakExitCode -ne 0) { throw 'POST_MIGRATION_DATABASE_SOAK_FAILED_PRE_BACKUP_PRESERVED' }
    $soak = ($soakRaw | Select-Object -Last 1) | ConvertFrom-Json
    if ($soak.result -ne 'PASS' -or $soak.requestedDurationSeconds -lt 900) {
      throw 'POST_MIGRATION_DATABASE_SOAK_INCOMPLETE_PRE_BACKUP_PRESERVED'
    }
  } finally { Pop-Location }
  $afterRaw = & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Backup-Theta.ps1') -BackupRoot $root
  if ($LASTEXITCODE -ne 0) { throw 'POST_MIGRATION_VERIFIED_BACKUP_FAILED_PRE_BACKUP_PRESERVED' }
  $after = $afterRaw | ConvertFrom-Json
  if ($after.state -ne 'VERIFIED') { throw 'POST_MIGRATION_VERIFIED_BACKUP_FAILED_PRE_BACKUP_PRESERVED' }
  $receipt = [ordered]@{state='PRODUCTION_MIGRATION_VERIFIED';completedAt=(Get-Date).ToUniversalTime().ToString('o');
    preMigrationBackupId=$before.backupId;postMigrationBackupId=$after.backupId;
    preMigrationArchiveSha256=$before.archiveSha256;postMigrationArchiveSha256=$after.archiveSha256;
    schemaInvariantVerification='PASS';storageAudit='PASS';storageAuditObservedAt=$storage.observedAt;
    databaseStabilitySoak='PASS';databaseStabilitySoakReceiptHash=$soak.receiptHash;
    preMigrationRestoreParity='PASS';postMigrationRestoreParity='PASS'}
  Write-ThetaJson (Join-Path $root ('logs\migration-checkpoint-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) $receipt
  $receipt | ConvertTo-Json -Compress
} catch {
  $code = $_.Exception.Message -replace 'postgres(ql)?://[^ ]+','[REDACTED_DATABASE_URL]'
  $latestPointerPath = Join-Path $root 'latest\current.json'
  $previousKnownGoodBackupId = $null
  $previousKnownGoodBackupPreserved = $false
  if (Test-Path -LiteralPath $latestPointerPath -PathType Leaf) {
    try {
      $latestPointer = Get-Content -Raw -LiteralPath $latestPointerPath | ConvertFrom-Json
      $previousKnownGoodBackupId = [string]$latestPointer.backupId
      $previousKnownGoodPath = Join-Path $root ([string]$latestPointer.relativePath -replace '/', '\')
      $previousKnownGoodBackupPreserved = $previousKnownGoodBackupId -ne ''
        -and (Test-Path -LiteralPath $previousKnownGoodPath -PathType Container)
        -and (Test-Path -LiteralPath (Join-Path $previousKnownGoodPath 'backup-manifest.json') -PathType Leaf)
        -and (Test-Path -LiteralPath (Join-Path $previousKnownGoodPath 'restore-verification.json') -PathType Leaf)
    } catch { $previousKnownGoodBackupPreserved = $false }
  }
  $failure = [ordered]@{state='MIGRATION_CHECKPOINT_FAILED';failedAt=(Get-Date).ToUniversalTime().ToString('o');
    reason=$code;preMigrationBackupId=$(if($before){$before.backupId}else{$null});
    postMigrationBackupId=$(if($after){$after.backupId}else{$null});
    newPreMigrationBackupVerified=($null -ne $before);
    previousKnownGoodBackupId=$previousKnownGoodBackupId;
    previousKnownGoodBackupPreserved=$previousKnownGoodBackupPreserved}
  Write-ThetaJson (Join-Path $root ('logs\migration-checkpoint-failed-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) $failure
  throw $code
} finally {
  $env:DATABASE_RUNTIME_AUTHORITY = $oldAuthority
  $env:AIVEN_DATABASE_URL = $oldAiven
  $env:DATABASE_URL = $oldDatabase
  $env:THETA_MIGRATION_CHECKPOINT_ACTIVE = $oldCheckpoint
}
