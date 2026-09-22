#Requires -Version 7
param(
  [string]$BackupRoot,
  [string]$SourceUrlEnvironmentVariable = 'AIVEN_DATABASE_URL',
  [switch]$TestMode,
  [switch]$SkipExternalAssets
)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$root = Get-ThetaBackupRoot $BackupRoot
if ($TestMode -and -not $root.EndsWith('\trading-bots-test', [StringComparison]::OrdinalIgnoreCase)) { throw 'TEST_BACKUP_ROOT_MUST_BE_TRADING_BOTS_TEST' }
if (-not $TestMode -and $SourceUrlEnvironmentVariable -ne 'AIVEN_DATABASE_URL') { throw 'PRODUCTION_SOURCE_MUST_BE_AIVEN' }
if (-not $TestMode -and $SkipExternalAssets) { throw 'PRODUCTION_BACKUP_CANNOT_SKIP_EXTERNAL_ASSETS' }
Initialize-ThetaBackupRoot $root
$logPath = Join-Path $root ('logs\backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
function Log([string]$Message) { [IO.File]::AppendAllText($logPath, "$(Get-Date -Format o) $Message`n") }
function Invoke-VerifiedDumpWithRetry([string[]]$Arguments, [string]$OutputPath, [string]$Label) {
  $delays = @(0, 5, 20)
  for ($attempt = 1; $attempt -le $delays.Count; $attempt++) {
    if ($delays[$attempt - 1] -gt 0) { Start-Sleep -Seconds $delays[$attempt - 1] }
    Remove-Item -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
    try {
      Invoke-ThetaPg pg_dump $source $Arguments | Out-Null
      Log "$Label`_COMPLETE attempt=$attempt"
      return
    } catch {
      $diagnostic = $_.Exception.Message -replace '[\r\n]+',' '
      Log "$Label`_ATTEMPT_FAILED attempt=$attempt diagnostic=$diagnostic"
      if ($attempt -eq $delays.Count) { throw }
    }
  }
}
$stage = $null
$backupId = $null
$dumpComplete = $false
try {
  if (-not $TestMode) {
    $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($battery -and $battery.BatteryStatus -eq 1 -and $battery.EstimatedChargeRemaining -lt 40) {
      throw 'BACKUP_BATTERY_BELOW_40_PERCENT_AND_DISCHARGING'
    }
  }
  $url = if ($TestMode) { [Environment]::GetEnvironmentVariable($SourceUrlEnvironmentVariable) } else { Get-ThetaSourceUrl $root }
  if (-not $url) { throw 'BACKUP_SOURCE_URL_UNAVAILABLE' }
  $source = ConvertTo-ThetaPgConnection $url
  if (-not $TestMode -and -not $source.Host.EndsWith('.aivencloud.com', [StringComparison]::OrdinalIgnoreCase)) { throw 'BACKUP_SOURCE_NOT_AIVEN' }
  $version = (Invoke-ThetaSql $source 'SHOW server_version_num').Trim()
  if ($version -notmatch '^\d+$' -or [int]$version -lt 180000) { throw 'BACKUP_REQUIRES_POSTGRES_18_SOURCE' }
  $sourceSize = [long](Invoke-ThetaSql $source 'SELECT pg_database_size(current_database())')
  $assetsEstimate = 0L
  if (-not $SkipExternalAssets) {
    foreach ($relative in @('research_exports','research_outputs','.theta-local-worker/evidence','.theta-local-worker/receipts')) {
      $path = Join-Path $repoRoot $relative
      if (Test-Path -LiteralPath $path) {
        foreach ($assetFile in (Get-ChildItem -LiteralPath $path -Recurse -File)) {
          $assetsEstimate += [long]$assetFile.Length
        }
      }
    }
  }
  $drive = Get-PSDrive -Name $root.Substring(0,1)
  # Reserve for the staging/daily archive and independently copied weekly and monthly sets.
  $required = [long][Math]::Max(4GB, ((($sourceSize * 3) + $assetsEstimate) * 3) + 1GB)
  if ($drive.Free -lt $required) { throw "BACKUP_DISK_SPACE_TOO_LOW:requiredBytes=$required freeBytes=$($drive.Free)" }
  $backupId = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd_HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
  $stage = Join-Path $root ('daily\.staging-' + $backupId)
  [void](New-Item -ItemType Directory -Path $stage)
  Log "START backupId=$backupId source=AIVEN_OR_TEST sourceBytes=$sourceSize"
  $archive = Join-Path $stage 'database.backup'; $schema = Join-Path $stage 'schema.sql'
  Invoke-VerifiedDumpWithRetry -Arguments @('--format=custom','--file',(Get-ThetaPgFilePath $archive $source),'--dbname',$source.Database) -OutputPath $archive -Label 'CUSTOM_DUMP'
  Invoke-VerifiedDumpWithRetry -Arguments @('--schema-only','--file',(Get-ThetaPgFilePath $schema $source),'--dbname',$source.Database) -OutputPath $schema -Label 'SCHEMA_DUMP'
  Log 'DUMP_COMPLETE'
  $dumpComplete = $true
  $inventorySql = @'
SELECT jsonb_build_object(
  'databaseSizeBytes',pg_database_size(current_database()),
  'postgresVersion',current_setting('server_version'),
  'schemaCount',(SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'),
  'tableCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
  'viewCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
  'functionCount',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
  'triggerCount',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
  'indexCount',(SELECT count(*) FROM pg_indexes WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema'),
  'sequenceCount',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'),
  'migrationHead',(SELECT max(version) FROM core.schema_migration),
  'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'estimatedRows',greatest(c.reltuples::bigint,0),'totalBytes',pg_total_relation_size(c.oid)) ORDER BY n.nspname,c.relname),'[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema')
)::text
'@
  $inventory = Invoke-ThetaSql $source $inventorySql | ConvertFrom-Json
  Write-ThetaJson (Join-Path $stage 'database-inventory.json') $inventory
  $structureRaw = Get-ThetaStructure $source
  $structure = $structureRaw | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $stage 'database-structure.json'), ($structureRaw + "`n"), [Text.UTF8Encoding]::new($false))
  $globalRaw = Get-ThetaGlobalState $source
  [IO.File]::WriteAllText((Join-Path $stage 'global-state.json'), ($globalRaw + "`n"), [Text.UTF8Encoding]::new($false))
  $allRowCounts = Get-ThetaTableCounts $source $structure
  Write-ThetaJson (Join-Path $stage 'all-table-row-counts.json') $allRowCounts
  $sequenceState = Get-ThetaSequenceState $source
  [IO.File]::WriteAllText((Join-Path $stage 'sequence-state.json'), ($sequenceState + "`n"), [Text.UTF8Encoding]::new($false))
  $criticalDigests = Get-ThetaCriticalDigest $source $structure
  Write-ThetaJson (Join-Path $stage 'critical-data-digests.json') $criticalDigests
  Log "STRUCTURE_CAPTURED sha256=$(Get-ThetaStringSha256 $structureRaw) tables=$($structure.tables.Count)"
  $extensions = Invoke-ThetaSql $source "SELECT coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion,'schema',n.nspname) ORDER BY extname),'[]'::jsonb)::text FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace" | ConvertFrom-Json
  Write-ThetaJson (Join-Path $stage 'extensions.json') $extensions
  $critical = Join-Path $stage 'critical-data'; [void](New-Item -ItemType Directory -Path $critical)
  $criticalCounts = [ordered]@{}
  foreach ($table in @('core.schema_migration','trade.order_intent','trade.broker_order','trade.fill','trade.broker_activity_fact','legacy_neon.import_batch')) {
    $exists = Invoke-ThetaSql $source "SELECT to_regclass('$table') IS NOT NULL"
    if ($exists -ne 't') { continue }
    $criticalCounts[$table] = [long](Invoke-ThetaSql $source "SELECT count(*) FROM $table")
    $rows = Invoke-ThetaSql $source "SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)::text FROM $table t"
    [IO.File]::WriteAllText((Join-Path $critical ($table.Replace('.','-') + '.json')), ($rows + "`n"), [Text.UTF8Encoding]::new($false))
  }
  $assets = @()
  if (-not $SkipExternalAssets) {
    foreach ($item in @(@('research_exports','research_exports'),@('research_outputs','research_outputs'),@('.theta-local-worker/evidence','worker-evidence'),@('.theta-local-worker/receipts','worker-receipts'))) {
      $sourcePath = Join-Path $repoRoot $item[0]
      if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) { continue }
      $dest = Join-Path (Join-Path $stage 'external-assets') $item[1]
      [void](New-Item -ItemType Directory -Path $dest -Force)
      Get-ChildItem -LiteralPath $sourcePath -Force | Copy-Item -Destination $dest -Recurse -Force -ErrorAction Stop
      $assets += [ordered]@{ sourceClass=$item[1]; backedUp=$true }
    }
  }
  $assetInventory = [ordered]@{ formatVersion=1; categories=@(); externalServices=@(
    [ordered]@{name='VERCEL_CONFIGURATION_AND_SECRETS';classification='SECRET_RESTORE_SEPARATELY';included=$false},
    [ordered]@{name='ALPACA_BROKER_TRUTH';classification='PROVIDER_MANAGED_RECREATE';included=$false},
    [ordered]@{name='OPTIONOMICS_PROVIDER_HISTORY';classification='PROVIDER_MANAGED_RECREATE';included=$false},
    [ordered]@{name='NEON_LEGACY_HISTORY';classification='PROVIDER_MANAGED_RECREATE';included=$false}) }
  foreach ($item in @(@('research_exports','research_exports'),@('research_outputs','research_outputs'),
      @('.theta-local-worker/evidence','worker-evidence'),@('.theta-local-worker/receipts','worker-receipts'))) {
    $path = Join-Path (Join-Path $stage 'external-assets') $item[1]
    $filesInCategory = @(if (Test-Path -LiteralPath $path) { Get-ChildItem -LiteralPath $path -Recurse -File })
    $filesBytes = 0L
    foreach ($fileInCategory in $filesInCategory) { $filesBytes += [long]$fileInCategory.Length }
    $assetInventory.categories += [ordered]@{name=$item[1];sourceRelativePath=$item[0];included=(Test-Path -LiteralPath $path);
      fileCount=$filesInCategory.Count;bytes=$filesBytes}
  }
  Write-ThetaJson (Join-Path $stage 'external-assets-inventory.json') $assetInventory
  $gitSha = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $gitSha -notmatch '^[0-9a-f]{40}$') { throw 'GIT_SOURCE_SHA_UNAVAILABLE' }
  & git -C $repoRoot bundle create (Join-Path $stage 'source-code.bundle') --all | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GIT_BUNDLE_FAILED' }
  $manifest = [ordered]@{
    formatVersion=2; state='COMPLETE'; backupId=$backupId; createdAt=(Get-Date).ToUniversalTime().ToString('o');
    databaseArchiveFormat='CUSTOM'; sourceAuthority=$(if($TestMode){'LOCAL_TEST'}else{'AIVEN'});
    sourceHostSha256=([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($source.Host)) | ForEach-Object { $_.ToString('x2') }) -join '';
    sourceDatabase=$source.Database; sourcePostgresVersion=$version; databaseSizeBytes=$sourceSize;
    sourceGitSha=$gitSha; inventory=$inventory; criticalRowCounts=$criticalCounts;
    structureSha256=(Get-ThetaStringSha256 $structureRaw); allTableRowCounts=$allRowCounts;
    sequenceStateSha256=(Get-ThetaStringSha256 $sequenceState);
    criticalDataDigests=$criticalDigests; criticalDigestMethod='ORDER_INDEPENDENT_DUAL_SUM_V1'; externalAssets=$assets;
    secretsIncludedSeparately=$false; restoreRequiresEnvironmentVariables=$true
  }
  Write-ThetaJson (Join-Path $stage 'backup-manifest.json') $manifest
  $files = @(Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName)
  $checksums = foreach ($file in $files) {
    $relative = $file.FullName.Substring($stage.Length + 1).Replace('\','/')
    "$(Get-ThetaSha256 $file.FullName)  $relative"
  }
  [IO.File]::WriteAllLines((Join-Path $stage 'SHA256SUMS.txt'), $checksums, [Text.UTF8Encoding]::new($false))
  $receiptRaw = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Verify-ThetaBackup.ps1') -BackupDirectory $stage -WriteReceipt
  if ($LASTEXITCODE -ne 0) { throw 'BACKUP_VERIFICATION_FAILED' }
  $receipt = $receiptRaw | ConvertFrom-Json
  if ($receipt.state -ne 'VERIFIED') { throw 'BACKUP_VERIFICATION_FAILED' }
  $restoreRaw = & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Test-ThetaRestore.ps1') -BackupDirectory $stage -BackupRoot $root
  if ($LASTEXITCODE -ne 0) { throw 'BACKUP_TEST_RESTORE_FAILED' }
  $restoreReceipt = $restoreRaw | ConvertFrom-Json
  if ($restoreReceipt.state -ne 'REAL_LOCAL_RESTORE_VERIFIED' -or
      $restoreReceipt.structureParity -ne 'PASS' -or $restoreReceipt.dataRowcountParity -ne 'PASS' -or
      $restoreReceipt.criticalDataVerification -ne 'PASS') { throw 'BACKUP_TEST_RESTORE_PARITY_FAILED' }
  $restoreProofPath = Join-Path $stage 'restore-verification.json'
  Write-ThetaJson $restoreProofPath $restoreReceipt
  [IO.File]::AppendAllText((Join-Path $stage 'SHA256SUMS.txt'),
    "$(Get-ThetaSha256 $restoreProofPath)  restore-verification.json`n",[Text.UTF8Encoding]::new($false))
  & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Verify-ThetaBackup.ps1') -BackupDirectory $stage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'BACKUP_POST_RESTORE_VERIFICATION_FAILED' }
  Log "TEST_RESTORE_VERIFIED structure=$($restoreReceipt.structureParity) data=$($restoreReceipt.dataRowcountParity)"
  $final = Join-Path $root ('daily\' + $backupId)
  Move-Item -LiteralPath $stage -Destination $final
  $stage = $null
  $currentPointer = Join-Path $root 'latest\current.json'
  $previousPointer = Join-Path $root 'latest\previous.json'
  $prior = $null
  if (Test-Path -LiteralPath $currentPointer) {
    $prior = Get-Content -Raw -LiteralPath $currentPointer | ConvertFrom-Json
    $priorPath = [IO.Path]::GetFullPath((Join-Path $root ($prior.relativePath -replace '/', '\')))
    if (-not $priorPath.StartsWith((Join-Path $root 'daily\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'PREVIOUS_BACKUP_POINTER_UNSAFE' }
    if (Test-Path -LiteralPath $priorPath) { Copy-Item -LiteralPath $currentPointer -Destination $previousPointer -Force }
  }
  Write-ThetaJson (Join-Path $root 'latest\current.json') ([ordered]@{ backupId=$backupId; relativePath=('daily/' + $backupId); archiveSha256=$receipt.archiveSha256; verifiedAt=$receipt.verifiedAt })
  $trendPath = Join-Path $root 'logs\database-size-trend.jsonl'
  $capacity = [Environment]::GetEnvironmentVariable('AIVEN_DISK_CAPACITY_BYTES')
  $capacityBytes = if ($capacity -match '^[1-9][0-9]*$') { [long]$capacity } else { $null }
  $trend = [ordered]@{observedAt=(Get-Date).ToUniversalTime().ToString('o');backupId=$backupId;
    databaseSizeBytes=$sourceSize;archiveBytes=(Get-Item -LiteralPath (Join-Path $final 'database.backup')).Length;
    diskCapacityBytes=$capacityBytes;databaseFractionOfDisk=$(if($capacityBytes){[math]::Round($sourceSize/$capacityBytes,4)}else{$null});
    warning=$(if(-not $capacityBytes){'CAPACITY_UNVERIFIED'}elseif($sourceSize/$capacityBytes -ge 0.7){'DATABASE_SIZE_AT_LEAST_70_PERCENT_OF_DISK_EXCLUDING_WAL'}else{'NONE'})}
  [IO.File]::AppendAllText($trendPath, ((ConvertTo-Json $trend -Compress) + "`n"), [Text.UTF8Encoding]::new($false))
  foreach ($bucket in @('weekly','monthly')) {
    $period = if($bucket -eq 'weekly'){
      $today = Get-Date
      '{0}-W{1:D2}' -f [Globalization.ISOWeek]::GetYear($today), [Globalization.ISOWeek]::GetWeekOfYear($today)
    }else{(Get-Date).ToString('yyyy-MM')}
    $existing = @(Get-ChildItem -LiteralPath (Join-Path $root $bucket) -Directory | Where-Object Name -Like "$period-*")
    if ($existing.Count -eq 0) {
      $archiveCopy = Join-Path (Join-Path $root $bucket) "$period-$backupId"
      Copy-Item -LiteralPath $final -Destination $archiveCopy -Recurse
      & (Join-Path $PSHOME 'pwsh.exe') -NoProfile -File (Join-Path $PSScriptRoot 'Verify-ThetaBackup.ps1') -BackupDirectory $archiveCopy | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "BACKUP_PERIODIC_COPY_VERIFICATION_FAILED:$bucket" }
    }
  }
  foreach ($bucket in @(@('daily',7),@('weekly',4),@('monthly',3))) {
    $dir = Join-Path $root $bucket[0]
    $good = @(Get-ChildItem -LiteralPath $dir -Directory | Where-Object { $_.Name -notlike '.staging-*' } | Sort-Object Name -Descending)
    if ($good.Count -le [int]$bucket[1]) { continue }
    foreach ($old in ($good | Select-Object -Skip ([int]$bucket[1]))) {
      if ($bucket[0] -eq 'daily' -and $prior -and $old.Name -eq $prior.backupId) { continue }
      if (-not $old.FullName.StartsWith(($dir.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'RETENTION_PATH_ESCAPE' }
      Remove-Item -LiteralPath $old.FullName -Recurse -Force
      Log "RETAIN_PRUNE bucket=$($bucket[0]) id=$($old.Name)"
    }
  }
  Log "SUCCESS backupId=$backupId archiveSha256=$($receipt.archiveSha256)"
  [ordered]@{state='VERIFIED'; backupId=$backupId; path=$final; sourceBytes=$sourceSize; archiveSha256=$receipt.archiveSha256; tableCount=$inventory.tableCount; migrationHead=$inventory.migrationHead} | ConvertTo-Json -Compress
} catch {
  Log "FAIL code=$($_.Exception.Message -replace 'postgres(ql)?://[^ ]+','[REDACTED_DATABASE_URL]')"
  if ($stage -and (Test-Path -LiteralPath $stage)) {
    $allowed = Join-Path $root 'daily\.staging-'
    if (-not $stage.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'FAILED_STAGE_PATH_UNSAFE' }
    if ($dumpComplete -and $backupId) {
      $preserved = Join-Path $root ('restore-tests\incomplete-' + $backupId)
      if (Test-Path -LiteralPath $preserved) { throw 'INCOMPLETE_BACKUP_PRESERVATION_TARGET_EXISTS' }
      Move-Item -LiteralPath $stage -Destination $preserved
      Log "COMPLETED_DUMP_PRESERVED_AFTER_LATER_FAILURE path=$preserved"
    } else {
      Remove-Item -LiteralPath $stage -Recurse -Force
      Log 'FAILED_STAGING_FILES_REMOVED'
    }
  }
  throw
}
