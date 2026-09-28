Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ThetaFreshMachineTimestamp {
  param(
    [AllowNull()][AllowEmptyString()][string]$Timestamp,
    [DateTimeOffset]$NowUtc = [DateTimeOffset]::UtcNow,
    [ValidateRange(1, 86400)][int]$MaxAgeSeconds = 600,
    [ValidateRange(0, 300)][int]$MaxFutureSkewSeconds = 30
  )

  if ([string]::IsNullOrWhiteSpace($Timestamp)) {
    throw 'MACHINE_TIMESTAMP_MISSING'
  }
  if ($Timestamp -notmatch '(?i)(Z|[+-][0-9]{2}:[0-9]{2})$') {
    throw 'MACHINE_TIMESTAMP_OFFSET_REQUIRED'
  }

  $parsed = [DateTimeOffset]::MinValue
  $valid = [DateTimeOffset]::TryParse(
    $Timestamp,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::None,
    [ref]$parsed
  )
  if (-not $valid) { throw 'MACHINE_TIMESTAMP_MALFORMED' }

  $age = $NowUtc.ToUniversalTime() - $parsed.ToUniversalTime()
  if ($age.TotalSeconds -lt -$MaxFutureSkewSeconds) {
    throw 'MACHINE_TIMESTAMP_FUTURE'
  }
  if ($age.TotalSeconds -gt $MaxAgeSeconds) {
    throw 'MACHINE_TIMESTAMP_STALE'
  }

  return [pscustomobject]@{
    observedAtUtc = $parsed.ToUniversalTime().ToString('o')
    ageSeconds = $age.TotalSeconds
    maxAgeSeconds = $MaxAgeSeconds
    maxFutureSkewSeconds = $MaxFutureSkewSeconds
  }
}
