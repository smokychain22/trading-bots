#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:ThetaBackupSnapshotId = $null

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

function Enter-ThetaBackupProcessLock {
  param([string]$Root)
  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\','/'))
  $lockPath = Join-Path $fullRoot 'backup.lock'
  $rootPrefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $lockPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BACKUP_LOCK_PATH_UNSAFE'
  }
  try {
    $stream = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $payload = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json ([ordered]@{
      processId = $PID
      acquiredAt = (Get-Date).ToUniversalTime().ToString('o')
    }) -Compress))
    $stream.SetLength(0)
    $stream.Write($payload, 0, $payload.Length)
    $stream.Flush($true)
    return $stream
  } catch [IO.IOException] {
    throw 'BACKUP_ALREADY_RUNNING'
  }
}

function Exit-ThetaBackupProcessLock {
  param([IO.FileStream]$LockStream)
  if ($null -ne $LockStream) { $LockStream.Dispose() }
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

function ConvertTo-ThetaPgDiagnostic {
  param([object]$Connection, [string]$Diagnostic)
  $sanitized = [string]$Diagnostic
  if ($Connection.Password) { $sanitized = $sanitized.Replace([string]$Connection.Password, '[REDACTED]') }
  $sanitized = $sanitized -replace '(?i)(password\s*[=:]\s*)\S+', '$1[REDACTED]'
  $sanitized = $sanitized.Trim()
  if ($sanitized.Length -gt 2000) { $sanitized = $sanitized.Substring($sanitized.Length - 2000) }
  return $sanitized
}

function Get-ThetaPgFailureClass {
  param([string]$Diagnostic)
  if ($Diagnostic -match '(?i)exceeded (?:the )?data transfer quota') { return 'AIVEN_DATA_TRANSFER_QUOTA_EXCEEDED' }
  if ($Diagnostic -match '(?i)(remaining connection slots|too many clients|SQLSTATE\s*53000)') { return 'POSTGRES_53000' }
  if ($Diagnostic -match '(?i)(database system is starting up|cannot connect now|SQLSTATE\s*57P03)') { return 'POSTGRES_57P03' }
  if ($Diagnostic -match '(?i)(unexpected eof|connection to server was lost|server closed the connection unexpectedly|SSL SYSCALL|could not receive data|could not send data|ECONNRESET)') {
    return 'POSTGRES_CONNECTION_LOST'
  }
  return 'POSTGRES_TOOL_ERROR'
}

function Get-ThetaBackupFailureCode {
  param([Parameter(Mandatory)][string]$Message)
  if ($Message -match '(?i)class=([A-Z][A-Z0-9_]{2,127})(?:\s|$)') {
    return $Matches[1].ToUpperInvariant()
  }
  $postgresClass = Get-ThetaPgFailureClass $Message
  if ($postgresClass -ne 'POSTGRES_TOOL_ERROR') { return $postgresClass }
  if ($Message -cmatch '^([A-Z][A-Z0-9_]{2,127})(?::|\s|$)') {
    return $Matches[1]
  }
  return 'BACKUP_FAILURE_UNCLASSIFIED'
}

function Invoke-ThetaPg {
  param(
    [ValidateSet('pg_dump','pg_restore','psql')][string]$Tool,
    [object]$Connection,
    [string[]]$Arguments,
    [ValidateRange(1,86400)][int]$TimeoutSeconds = $(if ($Tool -eq 'psql') { 600 } else { 14400 }),
    [string]$ProgressFilePath,
    [ValidateRange(0,86400)][int]$NoProgressTimeoutSeconds = 0
  )
  $keys = @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME','PGTZ',
    'PGKEEPALIVES','PGKEEPALIVESIDLE','PGKEEPALIVESINTERVAL','PGKEEPALIVESCOUNT','PGTCPUSER_TIMEOUT','WSLENV')
  if ($NoProgressTimeoutSeconds -gt 0 -and -not $ProgressFilePath) { throw 'POSTGRES_TOOL_PROGRESS_PATH_REQUIRED' }
  $progressPath = if ($ProgressFilePath) { [IO.Path]::GetFullPath($ProgressFilePath) } else { $null }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  if ($Connection.Host -eq 'wsl-socket') {
    $startInfo.FileName = 'wsl.exe'
    foreach ($argument in @('-d','Ubuntu','--exec',"/usr/lib/postgresql/18/bin/$Tool") + $Arguments) {
      [void]$startInfo.ArgumentList.Add($argument)
    }
  } else {
    $startInfo.FileName = Get-ThetaNativePgTool $Tool
    foreach ($argument in $Arguments) { [void]$startInfo.ArgumentList.Add($argument) }
  }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $environment = @{
    PGHOST=$(if ($Connection.Host -eq 'wsl-socket') { '/var/run/postgresql' } else { $Connection.Host })
    PGPORT=$Connection.Port; PGUSER=$Connection.User; PGPASSWORD=$Connection.Password
    PGDATABASE=$Connection.Database; PGSSLMODE=$Connection.SslMode; PGCONNECT_TIMEOUT='15'
    PGAPPNAME='theta-disaster-recovery'; PGTZ='UTC'; PGKEEPALIVES='1'; PGKEEPALIVESIDLE='30'
    PGKEEPALIVESINTERVAL='10'; PGKEEPALIVESCOUNT='6'; PGTCPUSER_TIMEOUT='120000'
  }
  if ($Connection.Host -eq 'wsl-socket') {
    $existingWslEnv = [Environment]::GetEnvironmentVariable('WSLENV')
    $environment.WSLENV = (($existingWslEnv | ForEach-Object { if ($_) { $_ + ':' } else { '' } }) +
      (($keys | Where-Object { $_ -ne 'WSLENV' } | ForEach-Object { $_ + '/u' }) -join ':'))
  }
  foreach ($entry in $environment.GetEnumerator()) { $startInfo.Environment[$entry.Key] = [string]$entry.Value }
  $process = $null
  try {
    $process = [Diagnostics.Process]::Start($startInfo)
    if ($null -eq $process) { throw "POSTGRES_TOOL_START_FAILED:$Tool" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $startedAt = [DateTimeOffset]::UtcNow
    $lastProgressAt = $startedAt
    $lastProgressBytes = if ($progressPath -and (Test-Path -LiteralPath $progressPath -PathType Leaf)) {
      [long](Get-Item -LiteralPath $progressPath).Length
    } else { 0L }
    $timeoutReason = $null
    while (-not $process.WaitForExit(1000)) {
      $now = [DateTimeOffset]::UtcNow
      if (($now - $startedAt).TotalSeconds -ge $TimeoutSeconds) {
        $timeoutReason = 'HARD_DEADLINE'
        break
      }
      if ($progressPath -and $NoProgressTimeoutSeconds -gt 0) {
        $currentBytes = if (Test-Path -LiteralPath $progressPath -PathType Leaf) {
          [long](Get-Item -LiteralPath $progressPath).Length
        } else { 0L }
        if ($currentBytes -ne $lastProgressBytes) {
          $lastProgressBytes = $currentBytes
          $lastProgressAt = $now
        } elseif (($now - $lastProgressAt).TotalSeconds -ge $NoProgressTimeoutSeconds) {
          $timeoutReason = 'NO_PROGRESS'
          break
        }
      }
    }
    if ($timeoutReason) {
      try { if (-not $process.HasExited) { $process.Kill($true) } } catch {}
      if (-not $process.WaitForExit(10000)) {
        throw "POSTGRES_TOOL_TERMINATION_FAILED:$Tool reason=$timeoutReason"
      }
    } else {
      $process.WaitForExit()
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    $diagnostic = ConvertTo-ThetaPgDiagnostic -Connection $Connection -Diagnostic $stderr
    if ($timeoutReason) {
      throw "POSTGRES_TOOL_TIMEOUT:$Tool reason=$timeoutReason timeoutSeconds=$(if($timeoutReason -eq 'NO_PROGRESS'){$NoProgressTimeoutSeconds}else{$TimeoutSeconds}) progressBytes=$lastProgressBytes diagnostic=$diagnostic"
    }
    if ($process.ExitCode -ne 0) {
      $failureClass = Get-ThetaPgFailureClass $diagnostic
      throw "POSTGRES_TOOL_FAILED:$Tool class=$failureClass exit=$($process.ExitCode) diagnostic=$diagnostic"
    }
    if (-not $stdout) { return @() }
    return @($stdout -split "\r?\n" | Where-Object { $_ -ne '' })
  } finally {
    if ($null -ne $process) { $process.Dispose() }
  }
}

function Test-ThetaReadOnlySql {
  param([Parameter(Mandatory)][string]$Sql)
  $normalized = $Sql.TrimStart([char]0xFEFF).TrimStart()
  do {
    $before = $normalized
    $normalized = $normalized -replace '^(?:--[^\r\n]*(?:\r?\n|$)|/\*[\s\S]*?\*/)\s*', ''
  } while ($normalized -ne $before)
  if ($normalized -notmatch '^(?i:SELECT|SHOW|WITH)\b') { return $false }
  # WITH is accepted for the fixed structure inventories, but data-modifying
  # CTEs and every other mutation family remain forbidden. Remove quoted
  # values, quoted identifiers, and comments before scanning SQL keywords so
  # a read such as SELECT count(*) FROM "copy"."account" is not mistaken for
  # the COPY statement. The initial statement-family check above still runs
  # against the original normalized SQL.
  $keywordSurface = [regex]::Replace($normalized, "'(?:''|[^'])*'", ' ')
  $keywordSurface = [regex]::Replace($keywordSurface, '"(?:""|[^"])*"', ' ')
  $keywordSurface = [regex]::Replace($keywordSurface,
    '\$(?<tag>[A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?\$\k<tag>\$', ' ')
  $keywordSurface = [regex]::Replace($keywordSurface, '\$\$[\s\S]*?\$\$', ' ')
  $keywordSurface = [regex]::Replace($keywordSurface, '--[^\r\n]*(?:\r?\n|$)', ' ')
  $keywordSurface = [regex]::Replace($keywordSurface, '/\*[\s\S]*?\*/', ' ')
  return $keywordSurface -notmatch '(?i)\b(INSERT|UPDATE|DELETE|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL|DO|COPY|VACUUM|ANALYZE|REFRESH|LOCK)\b'
}

function Invoke-ThetaSql {
  param([object]$Connection, [string]$Sql)
  $safeRead = Test-ThetaReadOnlySql $Sql
  if ($script:ThetaBackupSnapshotId) {
    if ($script:ThetaBackupSnapshotId -notmatch '^[0-9A-Fa-f-]+$' -or -not $safeRead) {
      throw 'BACKUP_SNAPSHOT_QUERY_INVALID'
    }
    $Sql = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET TRANSACTION SNAPSHOT '$script:ThetaBackupSnapshotId'; $Sql; COMMIT;"
  }
  # An exported snapshot remains valid for fresh read-only sessions while its
  # keeper transaction is alive. A transient TLS/client disconnect must not
  # discard a two-hour dump after the archive itself completed. Retry only
  # known connection/admission failures. SQL, permission, and snapshot errors
  # remain single-attempt failures.
  $attempts = if ($safeRead) { 3 } else { 1 }
  $delays = @(0, 2, 10)
  for ($attempt = 1; $attempt -le $attempts; $attempt++) {
    if ($delays[$attempt - 1] -gt 0) { Start-Sleep -Seconds $delays[$attempt - 1] }
    try {
      $result = Invoke-ThetaPg -Tool psql -Connection $Connection -Arguments @('--no-psqlrc','--quiet','--no-align','--tuples-only','--set','ON_ERROR_STOP=1','--command',$Sql)
      return (($result | Out-String).Trim())
    } catch {
      $message = [string]$_.Exception.Message
      $retryable = $message -match '(?i)(unexpected eof|connection to server was lost|server closed the connection unexpectedly|SSL SYSCALL|could not receive data|could not send data|connection timed out|timeout expired|could not connect|remaining connection slots|too many clients|POSTGRES_53000|POSTGRES_57P03)'
      if ($attempt -eq $attempts -or -not $retryable) { throw }
    }
  }
}

function Start-ThetaExportedSnapshot {
  param([Parameter(Mandatory)][object]$Connection)
  if ($Connection.Host -eq 'wsl-socket') { throw 'EXPORTED_SNAPSHOT_NATIVE_CONNECTION_REQUIRED' }
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = Get-ThetaNativePgTool psql
  foreach ($argument in @('--no-psqlrc','--quiet','--no-align','--tuples-only','--set','ON_ERROR_STOP=1','--dbname',$Connection.Database)) {
    [void]$startInfo.ArgumentList.Add($argument)
  }
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($entry in @{
    PGHOST=$Connection.Host; PGPORT=$Connection.Port; PGUSER=$Connection.User; PGPASSWORD=$Connection.Password
    PGDATABASE=$Connection.Database; PGSSLMODE=$Connection.SslMode; PGCONNECT_TIMEOUT='15'; PGTZ='UTC'
    PGAPPNAME='theta-disaster-recovery-snapshot'
  }.GetEnumerator()) { $startInfo.Environment[$entry.Key] = [string]$entry.Value }
  $process = [Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) { throw 'BACKUP_SNAPSHOT_KEEPER_START_FAILED' }
  try {
    $process.StandardInput.WriteLine('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')
    $process.StandardInput.WriteLine("SELECT 'THETA_SNAPSHOT:' || pg_export_snapshot();")
    $process.StandardInput.Flush()
    $lineTask = $process.StandardOutput.ReadLineAsync()
    if (-not $lineTask.Wait(30000)) { throw 'BACKUP_SNAPSHOT_KEEPER_TIMEOUT' }
    $line = $lineTask.Result
    if ($line -notmatch '^THETA_SNAPSHOT:([0-9A-Fa-f-]+)$') { throw 'BACKUP_SNAPSHOT_ID_INVALID' }
    return [pscustomobject]@{ Process=$process; SnapshotId=$Matches[1] }
  } catch {
    if (-not $process.HasExited) { $process.Kill() }
    $process.Dispose()
    throw
  }
}

function Stop-ThetaExportedSnapshot {
  param([object]$Keeper)
  if ($null -eq $Keeper) { return }
  $process = $Keeper.Process
  try {
    if (-not $process.HasExited) {
      $process.StandardInput.WriteLine('ROLLBACK;')
      $process.StandardInput.WriteLine('\q')
      $process.StandardInput.Flush()
      if (-not $process.WaitForExit(10000)) { $process.Kill() }
    }
  } finally { $process.Dispose() }
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

function Test-ThetaVerifiedBackupDirectory {
  param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$ExpectedBackupId,
    [Parameter(Mandatory)][string]$ExpectedArchiveSha256
  )
  if ($ExpectedBackupId -notmatch '^\d{4}-\d{2}-\d{2}_\d{6}-[0-9a-f]{8}$' -or
      $ExpectedArchiveSha256 -notmatch '^[0-9a-f]{64}$' -or
      -not (Test-Path -LiteralPath $BackupDirectory -PathType Container)) { return $false }
  try {
    $manifestPath = Join-Path $BackupDirectory 'backup-manifest.json'
    $verificationPath = Join-Path $BackupDirectory 'verification.json'
    $restorePath = Join-Path $BackupDirectory 'restore-verification.json'
    $archivePath = Join-Path $BackupDirectory 'database.backup'
    foreach ($path in @($manifestPath,$verificationPath,$restorePath,$archivePath)) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $verification = Get-Content -Raw -LiteralPath $verificationPath | ConvertFrom-Json
    $restore = Get-Content -Raw -LiteralPath $restorePath | ConvertFrom-Json
    return (
      [string]$manifest.state -eq 'COMPLETE' -and
      [string]$manifest.backupId -eq $ExpectedBackupId -and
      [string]$verification.state -eq 'VERIFIED' -and
      [string]$verification.backupId -eq $ExpectedBackupId -and
      [string]$verification.archiveSha256 -eq $ExpectedArchiveSha256 -and
      [string]$restore.state -eq 'REAL_LOCAL_RESTORE_VERIFIED' -and
      [string]$restore.backupId -eq $ExpectedBackupId -and
      [string]$restore.structureParity -eq 'PASS' -and
      [string]$restore.dataRowcountParity -eq 'PASS' -and
      [string]$restore.criticalDataVerification -eq 'PASS'
    )
  } catch { return $false }
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
    [ValidateSet('SORTED_ROW_MD5_V1','ORDER_INDEPENDENT_DUAL_SUM_V1','BOUNDED_INTEGRITY_PROJECTION_V2')]
    [string]$Method = 'BOUNDED_INTEGRITY_PROJECTION_V2'
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
    $rowExpression = 'to_jsonb(t)'
    if ($Method -eq 'BOUNDED_INTEGRITY_PROJECTION_V2') {
      # Wrap the switch result explicitly. PowerShell unwraps an empty pipeline
      # to $null, so an ordinary critical table with no bounded projection used
      # to fail at `.Count` after the full archive had already completed.
      $boundedColumns = @(switch ($name) {
        'trade.fusion_snapshot' { @(
          'fusion_snapshot_id','bot_instance_id','decision_time','trigger_type','universe_version_id',
          'strategy_version_id','feature_version_id','risk_limit_version_id','execution_version_id',
          'cost_model_version_id','account_snapshot_id','content_hash','created_at','storage_contract_version',
          'snapshot_projection_hash','evidence_archive_hash','evidence_archive_uncompressed_bytes',
          'evidence_archive_compressed_bytes','full_contract_count','projected_contract_count'
        ); break }
        'market.optionomics_raw_observation' { @(
          'observation_id','fusion_snapshot_id','operation_alias','underlying','provider_timestamp',
          'ingestion_timestamp','as_of','contract_version','data_quality','response_hash','created_at',
          'requested_at','request_path','request_parameters_json','http_status','rate_limit_json',
          'documentation_reference','credential_identity_ref_hash','session_date'
        ); break }
        'trade.candidate_point_in_time_evidence' { @(
          'candidate_id','decision_id','fusion_snapshot_id','decision_time','branch','rank_at_decision',
          'selected','hard_status','soft_status','rejection_reason','strategy_version','risk_version',
          'feature_version','cost_model_version','regime_version','execution_model_version','content_hash','created_at'
        ); break }
        default { @() }
      })
      if ($boundedColumns.Count -gt 0) {
        $available = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        $prefix = $name + '.'
        foreach ($column in $Structure.columns) {
          $fullName = [string]$column.name
          if ($fullName.StartsWith($prefix, [StringComparison]::Ordinal)) {
            [void]$available.Add($fullName.Substring($prefix.Length))
          }
        }
        $selected = @($boundedColumns | Where-Object { $available.Contains($_) })
        if ($selected.Count -eq 0 -or -not ($selected -contains 'content_hash' -or $selected -contains 'response_hash')) {
          throw "CRITICAL_DIGEST_PROJECTION_INCOMPLETE:$name"
        }
        $arguments = @()
        foreach ($columnName in $selected) {
          $quoted = '"' + $columnName.Replace('"','""') + '"'
          $literal = $columnName.Replace("'", "''")
          $arguments += "'$literal'"
          $arguments += "t.$quoted"
        }
        $rowExpression = 'jsonb_build_object(' + ($arguments -join ',') + ')'
      }
    }
    $digestSql = if ($Method -eq 'SORTED_ROW_MD5_V1') {
      "SELECT md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) FROM (SELECT md5(($rowExpression)::text) AS row_hash FROM $qualified t) hashes"
    } else {
      "SELECT md5(count(*)::text || ':' || coalesce(sum((('x'||substr(row_hash,1,16))::bit(64)::bigint)::numeric)::text,'0') || ':' || coalesce(sum((('x'||substr(row_hash,17,16))::bit(64)::bigint)::numeric)::text,'0')) FROM (SELECT md5(($rowExpression)::text) AS row_hash FROM $qualified t) hashes"
    }
    try { $digests[$name] = Invoke-ThetaSql -Connection $Connection -Sql $digestSql }
    catch { throw "CRITICAL_DIGEST_QUERY_FAILED:$name $($_.Exception.Message)" }
    if ($digests[$name] -notmatch '^[0-9a-f]{32}$') { throw "CRITICAL_DIGEST_INVALID:$name" }
  }
  return $digests
}
