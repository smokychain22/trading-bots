#Requires -Version 7
param([string]$BackupRoot)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$root = Get-ThetaBackupRoot $BackupRoot
$pwsh = Join-Path $PSHOME 'pwsh.exe'
$before = $null
$after = $null
$oldAuthority = $env:DATABASE_RUNTIME_AUTHORITY
$oldAiven = $env:AIVEN_DATABASE_URL
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
  $env:THETA_MIGRATION_CHECKPOINT_ACTIVE = 'VERIFIED_LOCAL_BACKUP'
  Push-Location $repoRoot
  try {
    & node tools/database-migrate.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PRODUCTION_MIGRATION_FAILED_PRE_BACKUP_PRESERVED' }
    & node tools/database-verify.mjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'POST_MIGRATION_SCHEMA_INVARIANT_FAILED_PRE_BACKUP_PRESERVED' }
  } finally { Pop-Location }
  $afterRaw = & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Backup-Theta.ps1') -BackupRoot $root
  if ($LASTEXITCODE -ne 0) { throw 'POST_MIGRATION_VERIFIED_BACKUP_FAILED_PRE_BACKUP_PRESERVED' }
  $after = $afterRaw | ConvertFrom-Json
  if ($after.state -ne 'VERIFIED') { throw 'POST_MIGRATION_VERIFIED_BACKUP_FAILED_PRE_BACKUP_PRESERVED' }
  $receipt = [ordered]@{state='PRODUCTION_MIGRATION_VERIFIED';completedAt=(Get-Date).ToUniversalTime().ToString('o');
    preMigrationBackupId=$before.backupId;postMigrationBackupId=$after.backupId;
    preMigrationArchiveSha256=$before.archiveSha256;postMigrationArchiveSha256=$after.archiveSha256;
    schemaInvariantVerification='PASS';preMigrationRestoreParity='PASS';postMigrationRestoreParity='PASS'}
  Write-ThetaJson (Join-Path $root ('logs\migration-checkpoint-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) $receipt
  $receipt | ConvertTo-Json -Compress
} catch {
  $code = $_.Exception.Message -replace 'postgres(ql)?://[^ ]+','[REDACTED_DATABASE_URL]'
  $failure = [ordered]@{state='MIGRATION_CHECKPOINT_FAILED';failedAt=(Get-Date).ToUniversalTime().ToString('o');
    reason=$code;preMigrationBackupId=$(if($before){$before.backupId}else{$null});
    postMigrationBackupId=$(if($after){$after.backupId}else{$null});
    previousBackupPreserved=($null -ne $before)}
  Write-ThetaJson (Join-Path $root ('logs\migration-checkpoint-failed-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) $failure
  throw $code
} finally {
  $env:DATABASE_RUNTIME_AUTHORITY = $oldAuthority
  $env:AIVEN_DATABASE_URL = $oldAiven
  $env:THETA_MIGRATION_CHECKPOINT_ACTIVE = $oldCheckpoint
}
