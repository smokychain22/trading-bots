#Requires -Version 7
param([string]$BackupRoot, [switch]$FromEnvironment)
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$root = Get-ThetaBackupRoot $BackupRoot
Initialize-ThetaBackupRoot $root
$secure = if ($FromEnvironment) {
  $value = [Environment]::GetEnvironmentVariable('AIVEN_DATABASE_URL')
  if (-not $value -or $value -eq '[SENSITIVE]') { throw 'AIVEN_SOURCE_ENVIRONMENT_UNAVAILABLE' }
  ConvertTo-SecureString -String $value -AsPlainText -Force
} else {
  Read-Host 'Enter the Aiven PostgreSQL service URI. Input is masked and stays on this Windows account' -AsSecureString
}
$plain = [Net.NetworkCredential]::new('', $secure).Password
$connection = ConvertTo-ThetaPgConnection $plain
if (-not $connection.Host.EndsWith('.aivencloud.com', [StringComparison]::OrdinalIgnoreCase)) { throw 'AIVEN_BACKUP_HOST_MISMATCH' }
$version = Invoke-ThetaSql $connection 'SHOW server_version_num'
if ($version -notmatch '^\d+$' -or [int]$version -lt 180000) { throw 'AIVEN_POSTGRES_18_REQUIRED' }
$path = Join-Path $root 'config\aiven-url.dpapi'
if (Test-Path -LiteralPath $path) { throw 'BACKUP_CREDENTIAL_ALREADY_CONFIGURED: refusing to overwrite without explicit rotation' }
$encrypted = ConvertFrom-SecureString $secure
[IO.File]::WriteAllText($path, ($encrypted + "`n"), [Text.UTF8Encoding]::new($false))
$plain = $null
@{state='CONFIGURED'; storage='WINDOWS_USER_DPAPI'; backupRoot=$root; sourcePostgresVersion=$version; credentialPrinted=$false} | ConvertTo-Json -Compress
