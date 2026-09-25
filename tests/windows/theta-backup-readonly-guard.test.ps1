#Requires -Version 7
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')

$cases = @(
  @{ Name = 'select'; Sql = 'SELECT 1'; Expected = $true },
  @{ Name = 'show'; Sql = 'SHOW transaction_read_only'; Expected = $true },
  @{ Name = 'commented CTE'; Sql = "-- inventory query`nWITH inventory AS (SELECT 1 AS value) SELECT value FROM inventory"; Expected = $true },
  @{ Name = 'block-commented CTE'; Sql = '/* inventory query */ WITH inventory AS (SELECT 1 AS value) SELECT value FROM inventory'; Expected = $true },
  @{ Name = 'insert'; Sql = 'INSERT INTO audit_log DEFAULT VALUES'; Expected = $false },
  @{ Name = 'data-modifying CTE'; Sql = 'WITH changed AS (DELETE FROM audit_log RETURNING id) SELECT id FROM changed'; Expected = $false },
  @{ Name = 'select containing mutation'; Sql = 'SELECT 1; DELETE FROM audit_log'; Expected = $false },
  @{ Name = 'create'; Sql = 'CREATE TABLE unsafe_test(id integer)'; Expected = $false }
)

foreach ($case in $cases) {
  $actual = Test-ThetaReadOnlySql -Sql $case.Sql
  if ($actual -ne $case.Expected) {
    throw "READONLY_GUARD_CASE_FAILED:$($case.Name):expected=$($case.Expected):actual=$actual"
  }
}

foreach ($queryFile in @('ThetaStructure.sql', 'ThetaGlobalState.sql')) {
  $path = Join-Path $PSScriptRoot "..\..\tools\windows\dr\$queryFile"
  $query = Get-Content -Raw -LiteralPath $path
  if (-not (Test-ThetaReadOnlySql -Sql $query)) {
    throw "PRODUCTION_INVENTORY_QUERY_REJECTED:$queryFile"
  }
}

$checkpointPath = Join-Path $PSScriptRoot '..\..\tools\windows\dr\Invoke-ThetaProductionMigration.ps1'
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($checkpointPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'PRODUCTION_MIGRATION_CHECKPOINT_PARSE_FAILED' }
$checkpoint = Get-Content -Raw -LiteralPath $checkpointPath
$orderedMarkers = @(
  "'Backup-Theta.ps1'",
  'tools/database-migrate.mjs',
  'tools/database-verify.mjs',
  'tools/theta-storage-audit.ts',
  'tools/theta-postgres-stability-soak.ts',
  "'Backup-Theta.ps1'"
)
$cursor = 0
foreach ($marker in $orderedMarkers) {
  $next = $checkpoint.IndexOf($marker, $cursor, [StringComparison]::Ordinal)
  if ($next -lt 0) { throw "MIGRATION_CHECKPOINT_STAGE_MISSING_OR_OUT_OF_ORDER:$marker" }
  $cursor = $next + $marker.Length
}
if ($checkpoint -notmatch '--duration-seconds=900') { throw 'MIGRATION_CHECKPOINT_SOAK_DURATION_NOT_CERTIFIED' }

Write-Output 'THETA_BACKUP_READONLY_GUARD_TEST=PASS'
