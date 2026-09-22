[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = 'Stop'

function ConvertTo-DotEnvValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value -match "[\r\n]") {
    throw 'Environment values must be single-line.'
  }

  $escaped = $Value.Replace('\', '\\').Replace('"', '\"')
  return '"' + $escaped + '"'
}

function Read-OwnerBundle {
  param([Parameter(Mandatory = $true)][string]$Path)

  $entries = [Collections.Generic.Dictionary[string, Collections.Generic.List[string]]]::new(
    [StringComparer]::OrdinalIgnoreCase
  )
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -notmatch '^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$') {
      throw 'The owner bundle contains an unparseable non-empty line.'
    }

    $label = $matches[1].Trim().ToLowerInvariant()
    $value = $matches[2].Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "The owner bundle contains an empty value for label '$label'."
    }

    if (-not $entries.ContainsKey($label)) {
      $entries[$label] = [Collections.Generic.List[string]]::new()
    }
    $entries[$label].Add($value)
  }

  return $entries
}

function Assert-GitIgnoredTarget {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ([IO.Path]::GetFileName($Path) -ne '.env.local') {
    throw 'The target must be a .env.local file.'
  }

  $targetDirectory = Split-Path -Parent $Path
  $repositoryRoot = (& git -C $targetDirectory rev-parse --show-toplevel 2>$null).Trim()
  if ([string]::IsNullOrWhiteSpace($repositoryRoot)) {
    throw 'The target must be inside a Git repository.'
  }

  $relativeTarget = [IO.Path]::GetRelativePath($repositoryRoot, $Path)
  & git -C $repositoryRoot check-ignore --quiet -- $relativeTarget
  if ($LASTEXITCODE -ne 0) {
    throw 'The target .env.local is not ignored by Git.'
  }
}

function Read-DotEnvLines {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    $empty = [Collections.Generic.List[string]]::new()
    return ,$empty
  }
  $result = [Collections.Generic.List[string]](Get-Content -LiteralPath $Path)
  return ,$result
}

function Get-AlpacaPaperAccountStatus {
  param(
    [Parameter(Mandatory = $true)][string]$ApiKey,
    [Parameter(Mandatory = $true)][string]$SecretKey
  )

  try {
    $response = Invoke-WebRequest `
      -Uri 'https://paper-api.alpaca.markets/v2/account' `
      -Method Get `
      -Headers @{
        'APCA-API-KEY-ID' = $ApiKey
        'APCA-API-SECRET-KEY' = $SecretKey
      } `
      -SkipHttpErrorCheck `
      -TimeoutSec 15
    return [int]$response.StatusCode
  } catch {
    if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

function Set-DotEnvEntry {
  param(
    [Parameter(Mandatory = $true)][Collections.Generic.List[string]]$Lines,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $replacement = "$Name=$(ConvertTo-DotEnvValue -Value $Value)"
  $indices = @()
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match ('^\s*' + [regex]::Escape($Name) + '\s*=')) { $indices += $index }
  }

  if ($indices.Count -eq 0) {
    $Lines.Add($replacement)
    return
  }

  $Lines[$indices[0]] = $replacement
  for ($index = $indices.Count - 1; $index -ge 1; $index--) {
    $Lines.RemoveAt($indices[$index])
  }
}

$source = (Resolve-Path -LiteralPath $SourcePath).Path
$target = [IO.Path]::GetFullPath($TargetPath)
Assert-GitIgnoredTarget -Path $target

$bundle = Read-OwnerBundle -Path $source
$requiredLabels = @(
  'alpaca secret',
  'alpaca api key',
  'alpaca endpoint',
  'theta token',
  'fred api key',
  'sec_user_agent',
  'open figi api',
  'open fda api',
  'optionomics_email',
  'optionomics_api_key',
  'aiven database url'
)
foreach ($label in $requiredLabels) {
  if (-not $bundle.ContainsKey($label) -or $bundle[$label].Count -ne 1) {
    throw "Expected exactly one owner-bundle value for '$label'."
  }
}

$alpacaEndpoint = [Uri]$bundle['alpaca endpoint'][0]
if ($alpacaEndpoint.Scheme -ne 'https' -or $alpacaEndpoint.Host -ne 'paper-api.alpaca.markets') {
  throw 'The Alpaca endpoint is not the authorized Paper host.'
}
$normalizedAlpacaEndpoint = "https://$($alpacaEndpoint.Host)"

# Owner-managed text files can have human labels reversed. Resolve the role of
# the pair using a read-only Paper account probe, never by printing or guessing
# from the credential values.
$labelledApiKey = $bundle['alpaca api key'][0]
$labelledSecret = $bundle['alpaca secret'][0]
$directAlpacaStatus = Get-AlpacaPaperAccountStatus -ApiKey $labelledApiKey -SecretKey $labelledSecret
$swappedAlpacaStatus = 0
if ($directAlpacaStatus -ne 200) {
  $swappedAlpacaStatus = Get-AlpacaPaperAccountStatus -ApiKey $labelledSecret -SecretKey $labelledApiKey
}
if ($directAlpacaStatus -eq 200) {
  $alpacaApiKey = $labelledApiKey
  $alpacaSecretKey = $labelledSecret
  $alpacaLabelRoles = 'DIRECT'
} elseif ($swappedAlpacaStatus -eq 200) {
  $alpacaApiKey = $labelledSecret
  $alpacaSecretKey = $labelledApiKey
  $alpacaLabelRoles = 'SWAPPED_BY_AUTHENTICATED_READ_ONLY_PROBE'
} else {
  throw 'Neither owner-bundle Alpaca label mapping authenticated to the Paper account.'
}

$optionomicsEmail = $bundle['optionomics_email'][0]
if ($optionomicsEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  throw 'The Optionomics email is malformed.'
}

$aivenUrl = [Uri]$bundle['aiven database url'][0]
if ($aivenUrl.Scheme -notin @('postgres', 'postgresql')) {
  throw 'The Aiven URL is not a PostgreSQL connection URL.'
}

$feedValues = @($bundle['alpaca_options_feed'] | ForEach-Object { $_.Trim().ToLowerInvariant() } | Select-Object -Unique)
$feedConflict = $feedValues.Count -gt 1

$lines = Read-DotEnvLines -Path $target
$updates = [ordered]@{
  ALPACA_API_KEY = $alpacaApiKey
  ALPACA_SECRET_KEY = $alpacaSecretKey
  ALPACA_BASE_URL = $normalizedAlpacaEndpoint
  THETA_READINESS_TOKEN = $bundle['theta token'][0]
  FRED_API_KEY = $bundle['fred api key'][0]
  SEC_USER_AGENT = $bundle['sec_user_agent'][0]
  OPENFIGI_API_KEY = $bundle['open figi api'][0]
  OPENFDA_API_KEY = $bundle['open fda api'][0]
  OPTIONOMICS_EMAIL = $optionomicsEmail
  OPTIONOMICS_API_KEY = $bundle['optionomics_api_key'][0]
  AIVEN_DATABASE_URL = $bundle['aiven database url'][0]
  MASTER_PAPER_EXECUTION_ENABLED = 'false'
  FOLLOWER_PAPER_EXECUTION_ENABLED = 'false'
  PAPER_PAUSE_NEW_ORDERS = 'true'
}

foreach ($updateName in @($updates.Keys)) {
  $updateValue = [string]$updates[$updateName]
  Set-DotEnvEntry -Lines $lines -Name ([string]$updateName) -Value $updateValue
}

# The supplied bundle contains two contradictory feed labels. The existing THETA
# value remains authoritative until entitlement is proven by a sanitized provider
# probe, so the importer never silently promotes OPRA semantics.
$existingFeed = $null
foreach ($line in $lines) {
  if ($line -match '^\s*ALPACA_OPTIONS_FEED\s*=\s*["'']?([^"''#\s]+)') {
    $existingFeed = $matches[1].Trim().ToLowerInvariant()
    break
  }
}
if ($existingFeed -notin @('indicative', 'opra')) {
  Set-DotEnvEntry -Lines $lines -Name 'ALPACA_OPTIONS_FEED' -Value 'indicative'
  $existingFeed = 'indicative'
}

$targetDirectory = Split-Path -Parent $target
$temporaryPath = Join-Path $targetDirectory ('.env.local.' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
  [IO.File]::WriteAllLines($temporaryPath, $lines, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporaryPath -Destination $target -Force
} finally {
  if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
}

[ordered]@{
  sourceRead = $true
  targetGitIgnored = $true
  updatedVariables = @($updates.Keys)
  alpacaHost = $alpacaEndpoint.Host
  alpacaAuthenticationHttpStatus = 200
  alpacaLabelRoles = $alpacaLabelRoles
  selectedAlpacaCredentialLengths = @{
    apiKey = $alpacaApiKey.Length
    secretKey = $alpacaSecretKey.Length
  }
  updateCredentialLengths = @{
    apiKey = ([string]$updates['ALPACA_API_KEY']).Length
    secretKey = ([string]$updates['ALPACA_SECRET_KEY']).Length
  }
  alpacaEndpointNormalizedToOrigin = $true
  alpacaOptionsFeed = $existingFeed
  sourceFeedConflictDetected = $feedConflict
  excludedUnsupportedSecretLabels = @('option password', 'aiven mail')
  masterPaperExecutionEnabled = $false
  followerPaperExecutionEnabled = $false
  paperPauseNewOrders = $true
} | ConvertTo-Json -Depth 4
