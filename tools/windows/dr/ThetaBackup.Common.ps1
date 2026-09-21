#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ThetaBackupRoot {
  param([string]$ConfiguredRoot)
  $fixed = @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 -and $_.DeviceID -match '^[A-Z]:$' } | Sort-Object FreeSpace -Descending)
  if ($fixed.Count -eq 0) { throw 'NO_HEALTHY_FIXED_LOCAL_DRIVE' }
  $root = if ($ConfiguredRoot) { [IO.Path]::GetFullPath($ConfiguredRoot) } else { Join-Path ($fixed[0].DeviceID + '\') 'ProjectBackups\trading-bots' }
  $drive = $fixed | Where-Object { $root.StartsWith(($_.DeviceID + '\'), [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
  if (-not $drive) { throw 'BACKUP_ROOT_MUST_BE_ON_FIXED_LOCAL_DRIVE' }
  $forbidden = @((Get-Location).Path, $env:TEMP, (Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop'))
  foreach ($path in $forbidden) {
    $full = [IO.Path]::GetFullPath($path).TrimEnd('\')
    if ($root.Equals($full, [StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith(($full + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'BACKUP_ROOT_IN_FORBIDDEN_LOCATION' }
  }
  if ($root -notmatch '^[A-Z]:\\ProjectBackups\\[^\\]+$') { throw 'BACKUP_ROOT_MUST_USE_PROJECTBACKUPS_PROJECT_LAYOUT' }
  return $root
}

function Initialize-ThetaBackupRoot {
  param([string]$Root)
  foreach ($name in @('', 'latest', 'daily', 'weekly', 'monthly', 'restore-tests', 'logs', 'config')) {
    $path = if ($name) { Join-Path $Root $name } else { $Root }
    [void](New-Item -ItemType Directory -Path $path -Force)
  }
  $principal = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls.exe $Root /inheritance:r /grant:r "${principal}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'BACKUP_ROOT_ACL_FAILED' }
}

function Get-ThetaSourceUrl {
  param([string]$Root)
  $value = [Environment]::GetEnvironmentVariable('AIVEN_DATABASE_URL')
  if (-not $value -or $value -eq '[SENSITIVE]') {
    $credentialPath = Join-Path $Root 'config\aiven-url.dpapi'
    if (-not (Test-Path -LiteralPath $credentialPath)) { throw 'AIVEN_BACKUP_CREDENTIAL_UNAVAILABLE: secure local DPAPI source is not configured' }
    $encrypted = (Get-Content -Raw -LiteralPath $credentialPath).Trim()
    if ($encrypted -notmatch '^[0-9a-f]+$') { throw 'AIVEN_BACKUP_CREDENTIAL_FILE_INVALID' }
    $secure = ConvertTo-SecureString -String $encrypted
    $value = [Net.NetworkCredential]::new('', $secure).Password
  }
  if ($value -notmatch '^postgres(ql)?://') { throw 'AIVEN_BACKUP_CREDENTIAL_INVALID' }
  $uri = [Uri]$value
  if (-not $uri.Host.EndsWith('.aivencloud.com', [StringComparison]::OrdinalIgnoreCase)) { throw 'AIVEN_BACKUP_HOST_MISMATCH' }
  return $value
}

function ConvertTo-ThetaPgConnection {
  param([string]$ConnectionUrl)
  if ($ConnectionUrl -notmatch '^postgres(ql)?://') { throw 'POSTGRES_URL_INVALID' }
  $uri = [Uri]$ConnectionUrl
  $parts = $uri.UserInfo.Split(':', 2)
  if ($parts.Count -ne 2 -or -not $uri.Host -or -not $uri.AbsolutePath.Trim('/')) { throw 'POSTGRES_URL_INCOMPLETE' }
  $query = [Web.HttpUtility]::ParseQueryString($uri.Query)
  $sslMode = if ($query['sslmode']) { $query['sslmode'] } else { 'require' }
  if ($sslMode -notin @('require', 'verify-ca', 'verify-full', 'disable')) { throw 'POSTGRES_SSLMODE_UNSUPPORTED' }
  return [pscustomobject]@{
    Host = $uri.Host; Port = $(if ($uri.IsDefaultPort) { '5432' } else { [string]$uri.Port });
    User = [Uri]::UnescapeDataString($parts[0]); Password = [Uri]::UnescapeDataString($parts[1]);
    Database = [Uri]::UnescapeDataString($uri.AbsolutePath.Trim('/')); SslMode = $sslMode
  }
}

function ConvertTo-ThetaWslPath {
  param([string]$WindowsPath)
  $full = [IO.Path]::GetFullPath($WindowsPath)
  if ($full -notmatch '^([A-Z]):\\(.*)$') { throw 'WSL_REQUIRES_LOCAL_DRIVE_PATH' }
  return '/mnt/' + $Matches[1].ToLowerInvariant() + '/' + ($Matches[2] -replace '\\', '/')
}

function Get-ThetaPgFilePath {
  param([string]$WindowsPath, [object]$Connection)
  if ($Connection -and $Connection.Host -eq 'wsl-socket') { return ConvertTo-ThetaWslPath $WindowsPath }
  return [IO.Path]::GetFullPath($WindowsPath)
}

function Get-ThetaNativePgTool {
  param([ValidateSet('pg_dump','pg_restore','psql')][string]$Tool)
  $path = Join-Path 'C:\Tools\PostgreSQL\18.6\pgsql\bin' ($Tool + '.exe')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'POSTGRES_18_WINDOWS_CLIENT_TOOLS_REQUIRED' }
  return $path
}

function Invoke-ThetaPg {
  param([ValidateSet('pg_dump','pg_restore','psql')][string]$Tool, [object]$Connection, [string[]]$Arguments)
  $keys = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME','WSLENV')
  $previous = @{}
  foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key) }
  try {
    $env:PGHOST = if ($Connection.Host -eq 'wsl-socket') { '/var/run/postgresql' } else { $Connection.Host }
    $env:PGPORT = $Connection.Port; $env:PGUSER = $Connection.User
    $env:PGPASSWORD = $Connection.Password; $env:PGDATABASE = $Connection.Database; $env:PGSSLMODE = $Connection.SslMode
    $env:PGCONNECT_TIMEOUT = '15'; $env:PGAPPNAME = 'theta-disaster-recovery'
    if ($Connection.Host -eq 'wsl-socket') {
      $env:WSLENV = (($previous['WSLENV'] | ForEach-Object { if ($_) { $_ + ':' } else { '' } }) + (($keys | Where-Object { $_ -ne 'WSLENV' } | ForEach-Object { $_ + '/u' }) -join ':'))
      $result = & wsl.exe -d Ubuntu --exec "/usr/lib/postgresql/18/bin/$Tool" @Arguments 2>&1
    } else {
      $result = & (Get-ThetaNativePgTool $Tool) @Arguments 2>&1
    }
    if ($LASTEXITCODE -ne 0) { throw "POSTGRES_TOOL_FAILED:$Tool exit=$LASTEXITCODE" }
    return $result
  } finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key]) }
  }
}

function Invoke-ThetaSql {
  param([object]$Connection, [string]$Sql)
  $result = Invoke-ThetaPg -Tool psql -Connection $Connection -Arguments @('--no-psqlrc','--no-align','--tuples-only','--set','ON_ERROR_STOP=1','--command',$Sql)
  return (($result | Out-String).Trim())
}

function Write-ThetaJson {
  param([string]$Path, [object]$Value)
  $json = ConvertTo-Json -InputObject $Value -Depth 30
  [IO.File]::WriteAllText($Path, ($json + "`n"), [Text.UTF8Encoding]::new($false))
}

function Get-ThetaSha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
