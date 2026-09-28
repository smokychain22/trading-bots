#Requires -Version 7
param([Parameter(Mandatory)][string]$BackupDirectory, [string]$BackupRoot)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
. (Join-Path $PSScriptRoot '..\ThetaProcess.Common.ps1')
$root = Get-ThetaBackupRoot $BackupRoot
Initialize-ThetaBackupRoot $root
$dbName = 'theta_dr_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss') + '_' + [guid]::NewGuid().ToString('N').Substring(0,6)
$databaseCreated = $false
$assetTarget = $null
$result = $null
$primaryFailure = $null
$cleanupFailures = [Collections.Generic.List[string]]::new()
$ready = Invoke-ThetaBoundedProcess -Executable 'wsl.exe' -TimeoutSeconds 30 -Arguments @(
  '-d','Ubuntu','--exec','/usr/lib/postgresql/18/bin/pg_isready','-h','/var/run/postgresql','-p','5433')
if ($ready.State -ne 'COMPLETED' -or $ready.ExitCode -ne 0) { throw 'LOCAL_POSTGRES_18_TEST_CLUSTER_UNAVAILABLE' }
$create = Invoke-ThetaBoundedProcess -Executable 'wsl.exe' -TimeoutSeconds 60 -Arguments @(
  '-d','Ubuntu','--exec','/usr/lib/postgresql/18/bin/createdb','-h','/var/run/postgresql','-p','5433',$dbName)
if ($create.State -ne 'COMPLETED' -or $create.ExitCode -ne 0) { throw 'LOCAL_TEST_DATABASE_CREATE_FAILED' }
$databaseCreated = $true
try {
  $userResult = Invoke-ThetaBoundedProcess -Executable 'wsl.exe' -TimeoutSeconds 30 -Arguments @('-d','Ubuntu','--exec','id','-un')
  if ($userResult.State -ne 'COMPLETED' -or $userResult.ExitCode -ne 0) { throw 'LOCAL_TEST_USER_UNAVAILABLE' }
  $user = (($userResult.Output -join "`n").Trim())
  if ($user -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'LOCAL_TEST_USER_INVALID' }
  $env:THETA_RESTORE_TARGET_URL = "postgresql://${user}:unused@wsl-socket:5433/${dbName}?sslmode=disable"
  $assetTarget = Join-Path (Join-Path $root 'restore-tests') ($dbName + '-assets')
  $raw = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Restore-Theta.ps1') -BackupDirectory $BackupDirectory -BackupRoot $root -AllowLocalTest -ExternalAssetsTarget $assetTarget
  if ($LASTEXITCODE -ne 0) { throw 'LOCAL_TEST_RESTORE_FAILED' }
  $receipt = $raw | ConvertFrom-Json
  if ($receipt.state -ne 'RESTORED_VERIFIED' -or $receipt.tableCount -lt 1) { throw 'LOCAL_TEST_RESTORE_NOT_VERIFIED' }
  $result = [ordered]@{state='REAL_LOCAL_RESTORE_VERIFIED'; testedAt=(Get-Date).ToUniversalTime().ToString('o');
    testDatabase=$dbName; backupId=$receipt.backupId;
    schemaCount=$receipt.schemaCount; tableCount=$receipt.tableCount; migrationHead=$receipt.migrationHead;
    customerIdentities=$receipt.customerIdentities; encryptedBrokerCredentials=$receipt.encryptedBrokerCredentials;
    legacyArtifacts=$receipt.legacyArtifacts; externalAssets=$receipt.externalAssets;
    sourceStructureFingerprint=$receipt.sourceStructureFingerprint; restoredStructureFingerprint=$receipt.restoredStructureFingerprint;
    structureParity=$receipt.structureParity; dataRowcountParity=$receipt.dataRowcountParity;
    criticalDataVerification=$receipt.criticalDataVerification;
    restoredCriticalRowCounts=$receipt.criticalRowCountsVerified;
    isolatedDatabaseRetained=$false; restoredAssetCopyRetained=$false;
    brokerMutations=0; productionDatabaseMutations=0}
} catch {
  $primaryFailure = $_
} finally {
  Remove-Item Env:THETA_RESTORE_TARGET_URL -ErrorAction SilentlyContinue
  if ($assetTarget -and (Test-Path -LiteralPath $assetTarget)) {
    $assetRoot = [IO.Path]::GetFullPath((Join-Path $root 'restore-tests')).TrimEnd([char[]]@('\','/'))
    $fullAssetTarget = [IO.Path]::GetFullPath($assetTarget)
    if (-not $fullAssetTarget.StartsWith(($assetRoot + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($fullAssetTarget) -notmatch '^theta_dr_[0-9]{14}_[0-9a-f]{6}-assets$') {
      $cleanupFailures.Add('LOCAL_TEST_RESTORE_ASSET_CLEANUP_PATH_UNSAFE')
    } else {
      try { Remove-Item -LiteralPath $fullAssetTarget -Recurse -Force -ErrorAction Stop }
      catch { $cleanupFailures.Add('LOCAL_TEST_RESTORE_ASSET_CLEANUP_FAILED') }
    }
  }
  if ($databaseCreated) {
    if ($dbName -notmatch '^theta_dr_[0-9]{14}_[0-9a-f]{6}$') {
      $cleanupFailures.Add('LOCAL_TEST_DATABASE_CLEANUP_NAME_UNSAFE')
    } else {
      try {
        $drop = Invoke-ThetaBoundedProcess -Executable 'wsl.exe' -TimeoutSeconds 60 -Arguments @(
          '-d','Ubuntu','--exec','/usr/lib/postgresql/18/bin/dropdb','--if-exists','--force',
          '-h','/var/run/postgresql','-p','5433',$dbName)
        if ($drop.State -ne 'COMPLETED' -or $drop.ExitCode -ne 0) {
          $cleanupFailures.Add('LOCAL_TEST_DATABASE_CLEANUP_FAILED')
        }
      } catch {
        $cleanupFailures.Add('LOCAL_TEST_DATABASE_CLEANUP_FAILED')
      }
    }
  }
}
if ($null -ne $primaryFailure -and $cleanupFailures.Count -gt 0) {
  throw ('LOCAL_TEST_RESTORE_PRIMARY_AND_CLEANUP_FAILED:' + ($cleanupFailures -join ','))
}
if ($null -ne $primaryFailure) { throw $primaryFailure }
if ($cleanupFailures.Count -gt 0) { throw ($cleanupFailures -join ',') }
if ($null -eq $result) { throw 'LOCAL_TEST_RESTORE_RECEIPT_MISSING' }
$result | ConvertTo-Json -Compress
