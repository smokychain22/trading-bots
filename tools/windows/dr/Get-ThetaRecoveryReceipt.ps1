#Requires -Version 7
param([string]$BackupRoot)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$root = Get-ThetaBackupRoot $BackupRoot
$currentPath = Join-Path $root 'latest\current.json'
if (-not (Test-Path -LiteralPath $currentPath)) { throw 'NO_VERIFIED_LATEST_BACKUP' }
$current = Get-Content -Raw -LiteralPath $currentPath | ConvertFrom-Json
$backup = [IO.Path]::GetFullPath((Join-Path $root ($current.relativePath -replace '/', '\')))
if (-not $backup.StartsWith((Join-Path $root 'daily\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'BACKUP_POINTER_UNSAFE' }
$verifiedRaw = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Verify-ThetaBackup.ps1') -BackupDirectory $backup
if ($LASTEXITCODE -ne 0) { throw 'LATEST_BACKUP_CHECKSUM_VERIFICATION_FAILED' }
$verified = $verifiedRaw | ConvertFrom-Json
$manifest = Get-Content -Raw -LiteralPath (Join-Path $backup 'backup-manifest.json') | ConvertFrom-Json
if ($manifest.formatVersion -ne 2) { throw 'LATEST_BACKUP_LEGACY_FORMAT_NO_STRUCTURE_PARITY' }
$proofPath = Join-Path $backup 'restore-verification.json'
if (-not (Test-Path -LiteralPath $proofPath)) { throw 'LATEST_BACKUP_HAS_NO_REAL_RESTORE_PROOF' }
$proof = Get-Content -Raw -LiteralPath $proofPath | ConvertFrom-Json
$structure = Get-Content -Raw -LiteralPath (Join-Path $backup 'database-structure.json') | ConvertFrom-Json
$global = Get-Content -Raw -LiteralPath (Join-Path $backup 'global-state.json') | ConvertFrom-Json
$assets = Get-Content -Raw -LiteralPath (Join-Path $backup 'external-assets-inventory.json') | ConvertFrom-Json
$previousPath = Join-Path $root 'latest\previous.json'
$previousPreserved = $false
if (Test-Path -LiteralPath $previousPath) {
  $previous = Get-Content -Raw -LiteralPath $previousPath | ConvertFrom-Json
  $previousBackup = [IO.Path]::GetFullPath((Join-Path $root ($previous.relativePath -replace '/', '\')))
  $previousPreserved = $previousBackup.StartsWith((Join-Path $root 'daily\'),[StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath (Join-Path $previousBackup 'database.backup') -PathType Leaf)
}
$parityPass = $proof.state -eq 'REAL_LOCAL_RESTORE_VERIFIED' -and $proof.structureParity -eq 'PASS' -and
  $proof.dataRowcountParity -eq 'PASS' -and $proof.criticalDataVerification -eq 'PASS'
$capture = $(if($parityPass){'YES'}else{'NO'})
$receipt = [ordered]@{
  receiptVersion='theta-recovery-completeness-v1';generatedAt=(Get-Date).ToUniversalTime().ToString('o');
  ALL_APPLICATION_SCHEMAS_CAPTURED=$capture;ALL_APPLICATION_TABLES_CAPTURED=$capture;
  ALL_ROWS_CAPTURED=$capture;ALL_CONSTRAINTS_CAPTURED=$capture;ALL_INDEXES_CAPTURED=$capture;
  ALL_SEQUENCES_CAPTURED=$capture;ALL_VIEWS_CAPTURED=$capture;ALL_FUNCTIONS_CAPTURED=$capture;
  ALL_TRIGGERS_CAPTURED=$capture;ALL_TYPES_CAPTURED=$capture;ALL_RLS_POLICIES_CAPTURED=$capture;
  EXTENSION_INVENTORY_COMPLETE=$capture;
  GLOBAL_OBJECT_INVENTORY_COMPLETE=$(if($global.formatVersion -eq 1 -and $global.roles.Count -gt 0){'YES'}else{'NO'});
  EXTERNAL_ASSET_INVENTORY_COMPLETE=$(if($assets.formatVersion -eq 1 -and $assets.categories.Count -eq 4 -and
    $assets.externalServices.Count -eq 4){'YES'}else{'NO'});
  SOURCE_STRUCTURE_FINGERPRINT=$proof.sourceStructureFingerprint;
  RESTORED_STRUCTURE_FINGERPRINT=$proof.restoredStructureFingerprint;
  STRUCTURE_PARITY=$proof.structureParity;
  SOURCE_CRITICAL_ROW_COUNTS=$manifest.criticalRowCounts;
  RESTORED_CRITICAL_ROW_COUNTS=$proof.restoredCriticalRowCounts;
  DATA_ROWCOUNT_PARITY=$proof.dataRowcountParity;
  CRITICAL_DATA_VERIFICATION=$proof.criticalDataVerification;
  DATA_PARITY=$(if($proof.dataRowcountParity -eq 'PASS' -and $proof.criticalDataVerification -eq 'PASS'){'PASS'}else{'FAIL'});
  LAST_REAL_RESTORE_TEST=$proof.testedAt;
  LAST_VERIFIED_BACKUP=$current.backupId;
  PREVIOUS_VERIFIED_BACKUP_PRESERVED=$previousPreserved;
  ARCHIVE_SHA256=$verified.archiveSha256;
  SCHEMA_COUNT=$structure.schemas.Count;TABLE_COUNT=$structure.tables.Count;
  CONSTRAINT_COUNT=$structure.constraints.Count;INDEX_COUNT=$structure.indexes.Count;
  SEQUENCE_COUNT=$structure.sequences.Count;VIEW_COUNT=$structure.views.Count;
  ROUTINE_COUNT=$structure.routines.Count;TRIGGER_COUNT=$structure.triggers.Count;
  CUSTOM_TYPE_COUNT=$structure.types.Count;RLS_POLICY_COUNT=$structure.rlsPolicies.Count;
  EXTENSION_COUNT=$structure.extensions.Count;
  SECRETS_RESTORED='NO_RESTORE_SEPARATELY';
  ALPACA_BROKER_RECONCILED='NOT_PART_OF_DATABASE_RESTORE'
}
$receipt | ConvertTo-Json -Depth 12 -Compress
