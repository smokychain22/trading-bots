#Requires -Version 7
param([Parameter(Mandatory)][string]$BackupDirectory, [string]$BackupRoot)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$root = Get-ThetaBackupRoot $BackupRoot
Initialize-ThetaBackupRoot $root
$dbName = 'theta_dr_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss') + '_' + [guid]::NewGuid().ToString('N').Substring(0,6)
$ready = & wsl.exe -d Ubuntu --exec /usr/lib/postgresql/18/bin/pg_isready -h /var/run/postgresql -p 5433 2>&1
if ($LASTEXITCODE -ne 0) { throw 'LOCAL_POSTGRES_18_TEST_CLUSTER_UNAVAILABLE' }
& wsl.exe -d Ubuntu --exec /usr/lib/postgresql/18/bin/createdb -h /var/run/postgresql -p 5433 $dbName | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'LOCAL_TEST_DATABASE_CREATE_FAILED' }
$user = (& wsl.exe -d Ubuntu --exec id -un | Out-String).Trim()
if ($user -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'LOCAL_TEST_USER_INVALID' }
$env:THETA_RESTORE_TARGET_URL = "postgresql://${user}:unused@wsl-socket:5433/${dbName}?sslmode=disable"
try {
  $assetTarget = Join-Path (Join-Path $root 'restore-tests') ($dbName + '-assets')
  $raw = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Restore-Theta.ps1') -BackupDirectory $BackupDirectory -BackupRoot $root -AllowLocalTest -ExternalAssetsTarget $assetTarget
  if ($LASTEXITCODE -ne 0) { throw 'LOCAL_TEST_RESTORE_FAILED' }
  $receipt = $raw | ConvertFrom-Json
  if ($receipt.state -ne 'RESTORED_VERIFIED' -or $receipt.tableCount -lt 1) { throw 'LOCAL_TEST_RESTORE_NOT_VERIFIED' }
  @{state='REAL_LOCAL_RESTORE_VERIFIED'; testedAt=(Get-Date).ToUniversalTime().ToString('o');
    testDatabase=$dbName; backupId=$receipt.backupId;
    schemaCount=$receipt.schemaCount; tableCount=$receipt.tableCount; migrationHead=$receipt.migrationHead;
    customerIdentities=$receipt.customerIdentities; encryptedBrokerCredentials=$receipt.encryptedBrokerCredentials;
    legacyArtifacts=$receipt.legacyArtifacts; externalAssets=$receipt.externalAssets;
    sourceStructureFingerprint=$receipt.sourceStructureFingerprint; restoredStructureFingerprint=$receipt.restoredStructureFingerprint;
    structureParity=$receipt.structureParity; dataRowcountParity=$receipt.dataRowcountParity;
    criticalDataVerification=$receipt.criticalDataVerification;
    restoredCriticalRowCounts=$receipt.criticalRowCountsVerified;
    brokerMutations=0; productionDatabaseMutations=0} | ConvertTo-Json -Compress
} finally { Remove-Item Env:THETA_RESTORE_TARGET_URL -ErrorAction SilentlyContinue }
