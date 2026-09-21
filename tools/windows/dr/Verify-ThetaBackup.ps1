#Requires -Version 7
param(
  [Parameter(Mandatory)][string]$BackupDirectory,
  [switch]$WriteReceipt
)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$backup = [IO.Path]::GetFullPath($BackupDirectory)
$manifestPath = Join-Path $backup 'backup-manifest.json'
$checksumsPath = Join-Path $backup 'SHA256SUMS.txt'
$archivePath = Join-Path $backup 'database.backup'
$schemaPath = Join-Path $backup 'schema.sql'
foreach ($path in @($manifestPath, $checksumsPath, $archivePath, $schemaPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "BACKUP_REQUIRED_FILE_MISSING:$([IO.Path]::GetFileName($path))" }
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.formatVersion -ne 1 -or $manifest.state -ne 'COMPLETE' -or $manifest.databaseArchiveFormat -ne 'CUSTOM') { throw 'BACKUP_MANIFEST_INVALID' }
$lines = @(Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -ne '' })
if ($lines.Count -lt 4) { throw 'BACKUP_CHECKSUM_SET_INCOMPLETE' }
$seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($line in $lines) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw 'BACKUP_CHECKSUM_LINE_INVALID' }
  $relative = $Matches[2]
  if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|/)\.\.(/|$)' -or -not $seen.Add($relative)) { throw 'BACKUP_CHECKSUM_PATH_INVALID' }
  $path = [IO.Path]::GetFullPath((Join-Path $backup ($relative -replace '/', '\')))
  if (-not $path.StartsWith(($backup.TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'BACKUP_CHECKSUM_PATH_ESCAPE' }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-ThetaSha256 $path) -ne $Matches[1]) { throw "BACKUP_CHECKSUM_MISMATCH:$relative" }
}
if (-not $seen.Contains('database.backup') -or -not $seen.Contains('schema.sql') -or -not $seen.Contains('backup-manifest.json')) { throw 'BACKUP_CORE_CHECKSUM_MISSING' }
if ((Get-Item -LiteralPath $archivePath).Length -lt 1024 -or (Get-Item -LiteralPath $schemaPath).Length -lt 100) { throw 'BACKUP_CORE_FILE_TOO_SMALL' }
$bundlePath = Join-Path $backup 'source-code.bundle'
if (-not (Test-Path -LiteralPath $bundlePath -PathType Leaf) -or -not $seen.Contains('source-code.bundle')) { throw 'BACKUP_SOURCE_BUNDLE_MISSING' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$heads = & git -C $repoRoot bundle list-heads $bundlePath 2>&1
if ($LASTEXITCODE -ne 0 -or -not (($heads | Out-String).Contains([string]$manifest.sourceGitSha))) { throw 'BACKUP_SOURCE_BUNDLE_SHA_MISMATCH' }
& git -C $repoRoot bundle verify $bundlePath 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'BACKUP_SOURCE_BUNDLE_INVALID' }
$archiveWsl = ConvertTo-ThetaWslPath $archivePath
$toc = & wsl.exe -d Ubuntu --exec /usr/lib/postgresql/18/bin/pg_restore --list $archiveWsl 2>&1
if ($LASTEXITCODE -ne 0 -or @($toc).Count -lt 10) { throw 'BACKUP_CUSTOM_ARCHIVE_UNREADABLE' }
$receipt = [ordered]@{
  state = 'VERIFIED'; verifiedAt = (Get-Date).ToUniversalTime().ToString('o');
  backupId = $manifest.backupId; checksumEntries = $lines.Count;
  archiveSha256 = Get-ThetaSha256 $archivePath; archiveTocLines = @($toc).Count;
  databaseSizeBytesAtSource = $manifest.databaseSizeBytes; schemaCountAtSource = $manifest.inventory.schemaCount;
  tableCountAtSource = $manifest.inventory.tableCount; sourceMigrationHead = $manifest.inventory.migrationHead
}
if ($WriteReceipt) { Write-ThetaJson -Path (Join-Path $backup 'verification.json') -Value $receipt }
$receipt | ConvertTo-Json -Depth 6 -Compress
