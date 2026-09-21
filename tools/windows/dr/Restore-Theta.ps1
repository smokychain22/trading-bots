#Requires -Version 7
param(
  [Parameter(Mandatory)][string]$BackupDirectory,
  [string]$TargetUrl,
  [string]$TargetUrlEnvironmentVariable = 'THETA_RESTORE_TARGET_URL',
  [string]$ExternalAssetsTarget,
  [string]$BackupRoot,
  [switch]$AllowLocalTest
)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$backup = [IO.Path]::GetFullPath($BackupDirectory)
$verifyRaw = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Verify-ThetaBackup.ps1') -BackupDirectory $backup
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_BACKUP_VERIFICATION_FAILED' }
$verified = $verifyRaw | ConvertFrom-Json
$manifest = Get-Content -Raw -LiteralPath (Join-Path $backup 'backup-manifest.json') | ConvertFrom-Json
$url = if ($TargetUrl) { $TargetUrl } else { [Environment]::GetEnvironmentVariable($TargetUrlEnvironmentVariable) }
if (-not $url) { throw 'RESTORE_TARGET_URL_MISSING' }
$target = ConvertTo-ThetaPgConnection $url
if ($target.Host -eq 'wsl-socket' -and -not $AllowLocalTest) { throw 'RESTORE_LOCAL_TEST_REQUIRES_EXPLICIT_FLAG' }
$targetHostHash = ([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($target.Host)) | ForEach-Object { $_.ToString('x2') }) -join ''
if ($targetHostHash -eq $manifest.sourceHostSha256 -and (-not $AllowLocalTest -or $target.Database -eq $manifest.sourceDatabase)) { throw 'RESTORE_TARGET_EQUALS_SOURCE_PROVIDER' }
$serverVersion = Invoke-ThetaSql $target 'SHOW server_version_num'
if ($serverVersion -notmatch '^\d+$' -or [int]$serverVersion -lt [int]$manifest.sourcePostgresVersion) { throw 'RESTORE_TARGET_POSTGRES_VERSION_TOO_OLD' }
$existing = [int](Invoke-ThetaSql $target "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')")
if ($existing -ne 0) { throw "RESTORE_TARGET_NOT_EMPTY:objects=$existing" }
$archivePath = Get-ThetaPgFilePath (Join-Path $backup 'database.backup') $target
Invoke-ThetaPg pg_restore $target @('--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname',$target.Database,$archivePath) | Out-Null
$restored = Invoke-ThetaSql $target "SELECT jsonb_build_object('schemaCount',(SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'),'tableCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),'viewCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),'functionCount',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),'triggerCount',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),'indexCount',(SELECT count(*) FROM pg_indexes WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema'),'sequenceCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),'migrationHead',(SELECT max(version) FROM core.schema_migration),'customerIdentities',(SELECT count(*) FROM iam.customer_identity),'encryptedBrokerCredentials',(SELECT count(*) FROM copy.alpaca_oauth_token),'legacyArtifacts',(SELECT count(*) FROM legacy_neon.artifact_record))::text" | ConvertFrom-Json
if ($restored.tableCount -ne $manifest.inventory.tableCount -or $restored.schemaCount -ne $manifest.inventory.schemaCount -or $restored.migrationHead -ne $manifest.inventory.migrationHead) { throw 'RESTORE_SCHEMA_OR_MIGRATION_MISMATCH' }
foreach ($field in @('viewCount','functionCount','triggerCount','indexCount','sequenceCount')) {
  if ($null -ne $manifest.inventory.$field -and $restored.$field -ne $manifest.inventory.$field) { throw "RESTORE_OBJECT_COUNT_MISMATCH:$field" }
}
$expectedExtensions = Get-Content -Raw -LiteralPath (Join-Path $backup 'extensions.json') | ConvertFrom-Json
$actualExtensions = Invoke-ThetaSql $target "SELECT coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'schema',n.nspname) ORDER BY extname),'[]'::jsonb)::text FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace" | ConvertFrom-Json
if ((ConvertTo-Json -InputObject $expectedExtensions -Compress -Depth 5) -ne (ConvertTo-Json -InputObject $actualExtensions -Compress -Depth 5)) { throw 'RESTORE_EXTENSION_INVENTORY_MISMATCH' }
$criticalCountsVerified = [ordered]@{}
foreach ($property in $manifest.criticalRowCounts.PSObject.Properties) {
  if ($property.Name -notmatch '^[a-z_]+\.[a-z_]+$') { throw 'RESTORE_CRITICAL_TABLE_NAME_INVALID' }
  $actual = [long](Invoke-ThetaSql $target "SELECT count(*) FROM $($property.Name)")
  if ($actual -ne [long]$property.Value) { throw "RESTORE_CRITICAL_ROW_COUNT_MISMATCH:$($property.Name)" }
  $criticalCountsVerified[$property.Name] = $actual
}
$assetsState = 'NOT_REQUESTED'
$assetFileCount = 0
if ($ExternalAssetsTarget) {
  $assetSource = Join-Path $backup 'external-assets'
  if (Test-Path -LiteralPath $ExternalAssetsTarget) { throw 'RESTORE_ASSET_DESTINATION_ALREADY_EXISTS' }
  if (Test-Path -LiteralPath $assetSource) {
    Copy-Item -LiteralPath $assetSource -Destination $ExternalAssetsTarget -Recurse
    $sourceAssets = @(Get-ChildItem -LiteralPath $assetSource -File -Recurse)
    foreach ($file in $sourceAssets) {
      $relative = $file.FullName.Substring($assetSource.Length + 1)
      $restoredPath = Join-Path $ExternalAssetsTarget $relative
      if (-not (Test-Path -LiteralPath $restoredPath -PathType Leaf) -or (Get-ThetaSha256 $file.FullName) -ne (Get-ThetaSha256 $restoredPath)) {
        throw "RESTORE_EXTERNAL_ASSET_MISMATCH:$relative"
      }
    }
    $assetFileCount = $sourceAssets.Count
    $assetsState = 'RESTORED_TO_SEPARATE_DIRECTORY'
  } else { $assetsState = 'NO_EXTERNAL_ASSETS_IN_BACKUP' }
}
$receipt = [ordered]@{
  state='RESTORED_VERIFIED'; restoredAt=(Get-Date).ToUniversalTime().ToString('o'); backupId=$manifest.backupId;
  archiveSha256=$verified.archiveSha256; sourceAuthority=$manifest.sourceAuthority;
  targetHostSha256=$targetHostHash; targetDatabase=$target.Database; targetPostgresVersion=$serverVersion;
  schemaCount=$restored.schemaCount; tableCount=$restored.tableCount; viewCount=$restored.viewCount;
  functionCount=$restored.functionCount; triggerCount=$restored.triggerCount;
  indexCount=$restored.indexCount; sequenceCount=$restored.sequenceCount; extensionCount=@($actualExtensions).Count;
  migrationHead=$restored.migrationHead;
  customerIdentities=$restored.customerIdentities; encryptedBrokerCredentials=$restored.encryptedBrokerCredentials;
  legacyArtifacts=$restored.legacyArtifacts; criticalRowCountsVerified=$criticalCountsVerified;
  externalAssets=$assetsState; externalAssetFileCount=$assetFileCount;
  secretsRestored=$false; applicationRedeployed=$false; brokerReconciled=$false
}
$root = Get-ThetaBackupRoot $BackupRoot
$receiptDir = Join-Path $root 'restore-tests'
[void](New-Item -ItemType Directory -Path $receiptDir -Force)
Write-ThetaJson (Join-Path $receiptDir ('restore-' + $manifest.backupId + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) $receipt
$receipt | ConvertTo-Json -Depth 8 -Compress
