#Requires -Version 7
param(
  [string]$BackupRoot,
  [switch]$UseFreshVerifiedLatest,
  [ValidateRange(1,24)][int]$MaximumPreMigrationBackupAgeHours = 6
)
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
  if ($UseFreshVerifiedLatest) {
    $pointerPath = Join-Path $root 'latest\current.json'
    if (-not (Test-Path -LiteralPath $pointerPath -PathType Leaf)) { throw 'PRE_MIGRATION_LATEST_POINTER_MISSING' }
    $pointer = Get-Content -Raw -LiteralPath $pointerPath | ConvertFrom-Json
    if ([string]$pointer.relativePath -notmatch '^daily/[A-Za-z0-9_.-]+$') { throw 'PRE_MIGRATION_LATEST_POINTER_INVALID' }
    $beforePath = [IO.Path]::GetFullPath((Join-Path $root ([string]$pointer.relativePath -replace '/', '\')))
    $dailyRoot = [IO.Path]::GetFullPath((Join-Path $root 'daily')) + '\'
    if (-not $beforePath.StartsWith($dailyRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'PRE_MIGRATION_LATEST_PATH_UNSAFE' }
    $manifestPath = Join-Path $beforePath 'backup-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'PRE_MIGRATION_MANIFEST_MISSING' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($manifest.state -ne 'COMPLETE' -or $manifest.sourceAuthority -ne 'AIVEN' -or (([string]$manifest.backupId) -ne ([string]$pointer.backupId))) {
      throw 'PRE_MIGRATION_MANIFEST_IDENTITY_INVALID'
    }
    $createdAt = [DateTimeOffset]::Parse([string]$manifest.createdAt)
    $age = [DateTimeOffset]::UtcNow - $createdAt.ToUniversalTime()
    if ($age.TotalHours -lt 0 -or $age.TotalHours -gt $MaximumPreMigrationBackupAgeHours) { throw 'PRE_MIGRATION_LATEST_NOT_FRESH' }
    $gitSha = (& git -C $repoRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $gitSha -notmatch '^[0-9a-f]{40}$') { throw 'PRE_MIGRATION_GIT_SHA_UNAVAILABLE' }
    if ([string]$manifest.sourceGitSha -ne $gitSha) { throw 'PRE_MIGRATION_BACKUP_SOURCE_SHA_MISMATCH' }
    $verifyRaw = & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Verify-ThetaBackup.ps1') -BackupDirectory $beforePath
    if ($LASTEXITCODE -ne 0) { throw 'PRE_MIGRATION_LATEST_VERIFICATION_FAILED' }
    $verify = $verifyRaw | ConvertFrom-Json
    if ($verify.state -ne 'VERIFIED') { throw 'PRE_MIGRATION_LATEST_VERIFICATION_FAILED' }
    if ([string]$verify.archiveSha256 -ne [string]$pointer.archiveSha256) {
      throw 'PRE_MIGRATION_LATEST_ARCHIVE_HASH_MISMATCH'
    }
    $before = [pscustomobject]@{
      state = 'VERIFIED'; backupId = [string]$manifest.backupId; path = $beforePath
      archiveSha256 = [string]$pointer.archiveSha256; migrationHead = [string]$manifest.inventory.migrationHead
    }
  } else {
    $beforeRaw = & $pwsh -NoProfile -File (Join-Path $PSScriptRoot 'Backup-Theta.ps1') -BackupRoot $root
    if ($LASTEXITCODE -ne 0) { throw 'PRE_MIGRATION_VERIFIED_BACKUP_FAILED' }
    $before = $beforeRaw | ConvertFrom-Json
    if ($before.state -ne 'VERIFIED') { throw 'PRE_MIGRATION_VERIFIED_BACKUP_FAILED' }
  }
  $proof = Get-Content -Raw -LiteralPath (Join-Path $before.path 'restore-verification.json') | ConvertFrom-Json
  if ($proof.structureParity -ne 'PASS' -or $proof.dataRowcountParity -ne 'PASS' -or
      $proof.criticalDataVerification -ne 'PASS') { throw 'PRE_MIGRATION_RESTORE_PARITY_FAILED' }
  $source = ConvertTo-ThetaPgConnection (Get-ThetaSourceUrl $root)
  $liveMigrationHead = (Invoke-ThetaSql $source 'SELECT max(version) FROM core.schema_migration').Trim()
  if (-not $liveMigrationHead -or [string]$before.migrationHead -ne $liveMigrationHead) {
    throw 'PRE_MIGRATION_BACKUP_DATABASE_HEAD_MISMATCH'
  }
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
    preMigrationBackupReused=[bool]$UseFreshVerifiedLatest;
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
