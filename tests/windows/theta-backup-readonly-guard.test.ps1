#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')

$cases = @(
  @{ Name = 'select'; Sql = 'SELECT 1'; Expected = $true },
  @{ Name = 'show'; Sql = 'SHOW transaction_read_only'; Expected = $true },
  @{ Name = 'commented CTE'; Sql = "-- inventory query`nWITH inventory AS (SELECT 1 AS value) SELECT value FROM inventory"; Expected = $true },
  @{ Name = 'block-commented CTE'; Sql = '/* inventory query */ WITH inventory AS (SELECT 1 AS value) SELECT value FROM inventory'; Expected = $true },
  @{ Name = 'quoted copy schema'; Sql = 'SELECT count(*) FROM "copy"."alpaca_oauth_token"'; Expected = $true },
  @{ Name = 'mutation word in string'; Sql = "SELECT 'DELETE FROM audit_log'"; Expected = $true },
  @{ Name = 'mutation word in trailing comment'; Sql = 'SELECT 1 /* DROP TABLE audit_log */'; Expected = $true },
  @{ Name = 'mutation word in dollar-quoted value'; Sql = 'SELECT $$ALTER TABLE audit_log$$'; Expected = $true },
  @{ Name = 'insert'; Sql = 'INSERT INTO audit_log DEFAULT VALUES'; Expected = $false },
  @{ Name = 'data-modifying CTE'; Sql = 'WITH changed AS (DELETE FROM audit_log RETURNING id) SELECT id FROM changed'; Expected = $false },
  @{ Name = 'select containing mutation'; Sql = 'SELECT 1; DELETE FROM audit_log'; Expected = $false },
  @{ Name = 'create'; Sql = 'CREATE TABLE unsafe_test(id integer)'; Expected = $false }
)

foreach ($case in $cases) {
  $actual = Test-ThetaReadOnlySql -Sql $case.Sql
  if ($actual -ne $case.Expected) {
    throw "READONLY_GUARD_CASE_FAILED:$($case.Name):expected=$($case.Expected):actual=$actual"
  }
}

foreach ($queryFile in @('ThetaStructure.sql', 'ThetaGlobalState.sql')) {
  $path = Join-Path $PSScriptRoot "..\..\tools\windows\dr\$queryFile"
  $query = Get-Content -Raw -LiteralPath $path
  if (-not (Test-ThetaReadOnlySql -Sql $query)) {
    throw "PRODUCTION_INVENTORY_QUERY_REJECTED:$queryFile"
  }
}

$checkpointPath = Join-Path $PSScriptRoot '..\..\tools\windows\dr\Invoke-ThetaProductionMigration.ps1'
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($checkpointPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'PRODUCTION_MIGRATION_CHECKPOINT_PARSE_FAILED' }
$checkpoint = Get-Content -Raw -LiteralPath $checkpointPath
$orderedMarkers = @(
  "'Backup-Theta.ps1'",
  'tools/database-migrate.mjs',
  'tools/database-verify.mjs',
  'tools/theta-storage-audit.ts',
  'tools/theta-postgres-stability-soak.ts',
  "'Backup-Theta.ps1'"
)
$cursor = 0
foreach ($marker in $orderedMarkers) {
  $next = $checkpoint.IndexOf($marker, $cursor, [StringComparison]::Ordinal)
  if ($next -lt 0) { throw "MIGRATION_CHECKPOINT_STAGE_MISSING_OR_OUT_OF_ORDER:$marker" }
  $cursor = $next + $marker.Length
}
if ($checkpoint -notmatch '--duration-seconds=900') { throw 'MIGRATION_CHECKPOINT_SOAK_DURATION_NOT_CERTIFIED' }
if ($checkpoint -notmatch '\$insideBackupRoot') { throw 'PREVIOUS_BACKUP_PATH_CONTAINMENT_NOT_CHECKED' }
if ($checkpoint -match "-replace '/', '\\\\'") { throw 'PREVIOUS_BACKUP_PATH_USES_PLATFORM_FRAGILE_REWRITE' }
if ($checkpoint -notmatch 'Invoke-ThetaBoundedProcess') { throw 'MIGRATION_CHECKPOINT_CHILD_PROCESS_OWNER_MISSING' }
if ($checkpoint -notmatch 'PRE_MIGRATION_BACKUP_PROCESS_TIMEOUT_PREVIOUS_BACKUP_PRESERVED') {
  throw 'PRE_MIGRATION_BACKUP_TIMEOUT_NOT_TYPED'
}
if ($checkpoint -notmatch 'POST_MIGRATION_DATABASE_SOAK_PROCESS_TIMEOUT_PRE_BACKUP_PRESERVED') {
  throw 'DATABASE_SOAK_TIMEOUT_NOT_TYPED'
}
if ($checkpoint -notmatch 'POST_MIGRATION_BACKUP_PROCESS_TIMEOUT_PRE_BACKUP_PRESERVED') {
  throw 'POST_MIGRATION_BACKUP_TIMEOUT_NOT_TYPED'
}
if ($checkpoint -match '2>&1') { throw 'MIGRATION_CHECKPOINT_CHILD_STDERR_EXPOSURE_REINTRODUCED' }
if ($checkpoint -notmatch 'Get-ThetaBoundedFailureCode') {
  throw 'MIGRATION_CHECKPOINT_TYPED_CHILD_FAILURE_NOT_PROPAGATED'
}
if ($checkpoint -notmatch 'BACKUP_FAILURE_RECEIPT_MISSING') {
  throw 'MIGRATION_CHECKPOINT_MISSING_FAILURE_RECEIPT_NOT_TYPED'
}
foreach ($required in @('theta-migration-process-receipt-v1','migration-child-','sanitizedStdout','sanitizedStderr',
    'schemaHeadBefore','schemaHeadAfter','migrationLedgerChanged','migrationChildReceiptPath','migrationChildFailureCode')) {
  if ($checkpoint -notmatch [regex]::Escape($required)) {
    throw "MIGRATION_CHILD_OBSERVABILITY_FIELD_MISSING:$required"
  }
}
$resume = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\dr\Invoke-ThetaPostMigrationContinuation.ps1')
foreach ($required in @('theta-post-migration-resume-preflight','duration-seconds=900','ORIGINAL_SCHEMA_064_ROLLBACK_ANCHOR_INVALID',
    'POST_MIGRATION_RECOVERY_GATE_INVALID_OR_STALE','Enter-ThetaBackupProcessLock','Backup-Theta.ps1','postMigrationRestoreParity')) {
  if ($resume -notmatch [regex]::Escape($required)) { throw "POST_MIGRATION_RESUME_GUARD_MISSING:$required" }
}
if ($resume -match 'database-migrate\.mjs|migrations[\\/].*06[5-7]_') { throw 'POST_MIGRATION_RESUME_REAPPLIES_MIGRATIONS' }

$backupPath = Join-Path $PSScriptRoot '..\..\tools\windows\dr\Backup-Theta.ps1'
$backupSource = Get-Content -Raw -LiteralPath $backupPath
if ($backupSource -notmatch '\$customDumpComplete = \$true') { throw 'CUSTOM_DUMP_COMPLETION_NOT_TRACKED' }
if ($backupSource -notmatch '\(\$customDumpComplete -or \$dumpComplete\)') {
  throw 'COMPLETED_CUSTOM_DUMP_NOT_PRESERVED_AFTER_LATER_FAILURE'
}
$failureReceiptPattern = [regex]::Escape("state='FAILED';reasonCode=`$failureCode")
if ($backupSource -notmatch $failureReceiptPattern) {
  throw 'BACKUP_STRUCTURED_FAILURE_RECEIPT_MISSING'
}

$failureCases = @(
  @{Message='POSTGRES_TOOL_FAILED:pg_dump class=AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED exit=1 diagnostic=redacted';Expected='AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED'},
  @{Message='POSTGRES_TOOL_FAILED:psql class=POSTGRES_53000 exit=1 diagnostic=redacted';Expected='POSTGRES_53000'},
  @{Message='BACKUP_DISK_SPACE_TOO_LOW:requiredBytes=100 freeBytes=1';Expected='BACKUP_DISK_SPACE_TOO_LOW'},
  @{Message='arbitrary provider detail';Expected='BACKUP_FAILURE_UNCLASSIFIED'}
)
foreach ($case in $failureCases) {
  $actual = Get-ThetaBackupFailureCode -Message $case.Message
  if ($actual -ne $case.Expected) {
    throw "BACKUP_FAILURE_CLASSIFICATION_FAILED:expected=$($case.Expected):actual=$actual"
  }
}

$lockRoot = Join-Path ([IO.Path]::GetTempPath()) ('theta-backup-lock-test-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $lockRoot)
$firstLock = $null
$secondLock = $null
try {
  $firstLock = Enter-ThetaBackupProcessLock $lockRoot
  try {
    $secondLock = Enter-ThetaBackupProcessLock $lockRoot
    throw 'BACKUP_LOCK_ALLOWED_CONCURRENT_OWNER'
  } catch {
    if ($_.Exception.Message -ne 'BACKUP_ALREADY_RUNNING') { throw }
  }
  Exit-ThetaBackupProcessLock $firstLock
  $firstLock = $null
  $secondLock = Enter-ThetaBackupProcessLock $lockRoot
} finally {
  Exit-ThetaBackupProcessLock $secondLock
  Exit-ThetaBackupProcessLock $firstLock
  Remove-Item -LiteralPath $lockRoot -Recurse -Force
}

$verifiedRoot = Join-Path ([IO.Path]::GetTempPath()) ('theta-verified-backup-test-' + [guid]::NewGuid().ToString('N'))
$verifiedId = '2026-09-27_120000-abcdef12'
$verifiedSha = 'a' * 64
[void](New-Item -ItemType Directory -Path $verifiedRoot)
try {
  [IO.File]::WriteAllBytes((Join-Path $verifiedRoot 'database.backup'), [byte[]](1,2,3))
  Write-ThetaJson (Join-Path $verifiedRoot 'backup-manifest.json') ([ordered]@{state='COMPLETE';backupId=$verifiedId})
  Write-ThetaJson (Join-Path $verifiedRoot 'verification.json') ([ordered]@{
    state='VERIFIED';backupId=$verifiedId;archiveSha256=$verifiedSha
  })
  Write-ThetaJson (Join-Path $verifiedRoot 'restore-verification.json') ([ordered]@{
    state='REAL_LOCAL_RESTORE_VERIFIED';backupId=$verifiedId;structureParity='PASS';
    dataRowcountParity='PASS';criticalDataVerification='PASS'
  })
  if (-not (Test-ThetaVerifiedBackupDirectory -BackupDirectory $verifiedRoot `
      -ExpectedBackupId $verifiedId -ExpectedArchiveSha256 $verifiedSha)) {
    throw 'VERIFIED_BACKUP_DIRECTORY_NOT_RECOGNIZED'
  }
  Write-ThetaJson (Join-Path $verifiedRoot 'restore-verification.json') ([ordered]@{
    state='REAL_LOCAL_RESTORE_VERIFIED';backupId=$verifiedId;structureParity='FAIL';
    dataRowcountParity='PASS';criticalDataVerification='PASS'
  })
  if (Test-ThetaVerifiedBackupDirectory -BackupDirectory $verifiedRoot `
      -ExpectedBackupId $verifiedId -ExpectedArchiveSha256 $verifiedSha) {
    throw 'FAILED_RESTORE_PARITY_RECOGNIZED_AS_VERIFIED_BACKUP'
  }
} finally {
  Remove-Item -LiteralPath $verifiedRoot -Recurse -Force
}

Write-Output 'THETA_BACKUP_READONLY_GUARD_TEST=PASS'
