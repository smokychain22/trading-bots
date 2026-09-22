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
  $keys = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME','PGTZ',
    'PGKEEPALIVES','PGKEEPALIVESIDLE','PGKEEPALIVESINTERVAL','PGKEEPALIVESCOUNT','PGTCPUSER_TIMEOUT','WSLENV')
  $previous = @{}
  foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key) }
  try {
    $env:PGHOST = if ($Connection.Host -eq 'wsl-socket') { '/var/run/postgresql' } else { $Connection.Host }
    $env:PGPORT = $Connection.Port; $env:PGUSER = $Connection.User
    $env:PGPASSWORD = $Connection.Password; $env:PGDATABASE = $Connection.Database; $env:PGSSLMODE = $Connection.SslMode
    $env:PGCONNECT_TIMEOUT = '15'; $env:PGAPPNAME = 'theta-disaster-recovery'
    $env:PGKEEPALIVES = '1'; $env:PGKEEPALIVESIDLE = '30'; $env:PGKEEPALIVESINTERVAL = '10'
    $env:PGKEEPALIVESCOUNT = '6'; $env:PGTCPUSER_TIMEOUT = '120000'
    # JSON row digests must use the same timestamp representation on Aiven and
    # on a restore target whose default PostgreSQL timezone may differ.
    $env:PGTZ = 'UTC'
    if ($Connection.Host -eq 'wsl-socket') {
      $env:WSLENV = (($previous['WSLENV'] | ForEach-Object { if ($_) { $_ + ':' } else { '' } }) + (($keys | Where-Object { $_ -ne 'WSLENV' } | ForEach-Object { $_ + '/u' }) -join ':'))
      $result = & wsl.exe -d Ubuntu --exec "/usr/lib/postgresql/18/bin/$Tool" @Arguments 2>&1
    } else {
      $result = & (Get-ThetaNativePgTool $Tool) @Arguments 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
      $diagnostic = (($result | Select-Object -Last 20 | Out-String).Trim())
      if ($Connection.Password) { $diagnostic = $diagnostic.Replace([string]$Connection.Password, '[REDACTED]') }
      $diagnostic = $diagnostic -replace '(?i)(password\s*[=:]\s*)\S+', '$1[REDACTED]'
      if ($diagnostic.Length -gt 2000) { $diagnostic = $diagnostic.Substring($diagnostic.Length - 2000) }
      throw "POSTGRES_TOOL_FAILED:$Tool exit=$LASTEXITCODE diagnostic=$diagnostic"
    }
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

function Get-ThetaStringSha256 {
  param([Parameter(Mandatory)][string]$Value)
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
    [Text.Encoding]::UTF8.GetBytes($Value))).ToLowerInvariant()
}

function Get-ThetaStructure {
  param([Parameter(Mandatory)][object]$Connection)
  $sql = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ThetaStructure.sql')
  $raw = Invoke-ThetaSql -Connection $Connection -Sql $sql
  if (-not $raw -or ($raw | ConvertFrom-Json).formatVersion -ne 1) { throw 'DATABASE_STRUCTURE_INVALID' }
  return $raw
}

function Get-ThetaGlobalState {
  param([Parameter(Mandatory)][object]$Connection)
  $sql = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ThetaGlobalState.sql')
  $raw = Invoke-ThetaSql -Connection $Connection -Sql $sql
  if (-not $raw -or ($raw | ConvertFrom-Json).formatVersion -ne 1) { throw 'DATABASE_GLOBAL_STATE_INVALID' }
  return $raw
}

function Get-ThetaTableCounts {
  param([Parameter(Mandatory)][object]$Connection, [Parameter(Mandatory)][object]$Structure)
  $counts = [ordered]@{}
  $relations = @($Structure.tables) + @($Structure.views | Where-Object kind -eq 'm')
  foreach ($table in $relations) {
    $parts = [string]$table.name -split '\.', 2
    if ($parts.Count -ne 2) { throw 'DATABASE_TABLE_NAME_INVALID' }
    $qualified = '"' + $parts[0].Replace('"','""') + '"."' + $parts[1].Replace('"','""') + '"'
    $counts[[string]$table.name] = [long](Invoke-ThetaSql -Connection $Connection -Sql "SELECT count(*) FROM $qualified")
  }
  return $counts
}

function Get-ThetaSequenceState {
  param([Parameter(Mandatory)][object]$Connection)
  $sql = @'
SELECT coalesce(jsonb_agg(jsonb_build_object('name',schemaname||'.'||sequencename,
  'lastValue',last_value) ORDER BY schemaname,sequencename),'[]'::jsonb)::text
FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema'
'@
  return Invoke-ThetaSql -Connection $Connection -Sql $sql
}

function Get-ThetaCriticalDigest {
  param(
    [Parameter(Mandatory)][object]$Connection,
    [Parameter(Mandatory)][object]$Structure,
    [ValidateSet('SORTED_ROW_MD5_V1','ORDER_INDEPENDENT_DUAL_SUM_V1')][string]$Method = 'ORDER_INDEPENDENT_DUAL_SUM_V1'
  )
  $names = @(
    'core.schema_migration','iam.customer_identity','copy.alpaca_oauth_token',
    'trade.order_intent','trade.broker_order','trade.fill','trade.broker_activity_fact',
    'trade.decision','trade.fusion_snapshot','trade.candidate_point_in_time_evidence',
    'market.optionomics_raw_observation','legacy_neon.import_batch','legacy_neon.artifact_record'
  )
  $present = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($table in $Structure.tables) { [void]$present.Add([string]$table.name) }
  $digests = [ordered]@{}
  foreach ($name in $names) {
    if (-not $present.Contains($name)) { continue }
    $parts = $name -split '\.', 2
    $qualified = '"' + $parts[0].Replace('"','""') + '"."' + $parts[1].Replace('"','""') + '"'
    # Only a digest leaves PostgreSQL. The production form avoids a temporary sort file,
    # which can fail when Aiven is near its storage limit. Numeric sums are exact and
    # order-independent; the archive SHA-256 remains the complete byte-integrity proof.
    $digestSql = if ($Method -eq 'SORTED_ROW_MD5_V1') {
      "SELECT md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM $qualified t) hashes"
    } else {
      "SELECT md5(count(*)::text || ':' || coalesce(sum((('x'||substr(row_hash,1,16))::bit(64)::bigint)::numeric)::text,'0') || ':' || coalesce(sum((('x'||substr(row_hash,17,16))::bit(64)::bigint)::numeric)::text,'0')) FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM $qualified t) hashes"
    }
    $digests[$name] = Invoke-ThetaSql -Connection $Connection -Sql $digestSql
    if ($digests[$name] -notmatch '^[0-9a-f]{32}$') { throw "CRITICAL_DIGEST_INVALID:$name" }
  }
  return $digests
}
