#Requires -Version 7
param(
  [Parameter(Mandatory)][ValidatePattern('^\d{4}-\d{2}-\d{2}$')][string]$SessionDate,
  [string]$BackupRoot = 'C:\ProjectBackups\trading-bots'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')

$parsedDate = [DateTime]::MinValue
if (-not [DateTime]::TryParseExact($SessionDate, 'yyyy-MM-dd',
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None,
    [ref]$parsedDate)) { throw 'INVALID_SESSION_DATE' }
$connection = ConvertTo-ThetaPgConnection (Get-ThetaSourceUrl $BackupRoot)
$sql = "SELECT jsonb_build_object('category',rejection_category,'reasons',reasons_json,'contract',contract_symbol)::text FROM trade.shadow_opportunity WHERE observed_at::date='$SessionDate'"
$raw = @(Invoke-ThetaPg -Tool psql -Connection $connection -Arguments @(
  '--no-psqlrc','--no-align','--tuples-only','--set','ON_ERROR_STOP=1','--command',$sql))
if ($raw.Count -gt 100000) { throw 'CANDIDATE_FUNNEL_SAMPLE_TOO_LARGE' }
$rows = @($raw | Where-Object { $_ -and $_.StartsWith('{') } | ForEach-Object { $_ | ConvertFrom-Json })
$categoryCounts = @($rows | Group-Object category | Sort-Object Name | ForEach-Object {
  [pscustomobject]@{ category = $_.Name; count = $_.Count }
})
$contractFailures = @($rows | Where-Object category -eq 'CONTRACT_NOT_EXECUTABLE')
$details = @($contractFailures | ForEach-Object { $_.reasons } |
  Where-Object code -eq 'CONTRACT_NOT_EXECUTABLE' | ForEach-Object { $_.detail })
$reasonCounts = @($details | Group-Object | Sort-Object Count -Descending | ForEach-Object {
  [pscustomobject]@{ detail = $_.Name; count = $_.Count }
})
$pitSql = "SELECT jsonb_build_object('total',count(*),'notEvaluated',count(*) FILTER (WHERE aegis_json->>'state' IS NULL),'evaluated',count(*) FILTER (WHERE aegis_json->>'state' IS NOT NULL))::text FROM trade.candidate_point_in_time_evidence WHERE decision_time::date='$SessionDate'"
$pit = (Invoke-ThetaSql -Connection $connection -Sql $pitSql) | ConvertFrom-Json
[pscustomobject]@{
  sessionDate = $SessionDate
  source = 'AIVEN_READ_ONLY_PERSISTED_EVIDENCE'
  shadowRows = $rows.Count
  categoryCounts = $categoryCounts
  contractNotExecutableCount = $contractFailures.Count
  contractNotExecutableDetails = $reasonCounts
  pitCandidateCount = $pit.total
  aegisNotEvaluatedCount = $pit.notEvaluated
  aegisEvaluatedCount = $pit.evaluated
  note = 'A NULL candidate AEGIS state proves no persisted assessment, not an AEGIS failure or pass.'
} | ConvertTo-Json -Depth 8
