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
$granularCodes = @(
  $contractFailures | ForEach-Object { $_.reasons } |
    Where-Object { $_.code -and $_.code -ne 'CONTRACT_NOT_EXECUTABLE' } |
    ForEach-Object { $_.code }
)
$granularReasonCounts = @($granularCodes | Group-Object | Sort-Object Count -Descending | ForEach-Object {
  [pscustomobject]@{ code = $_.Name; count = $_.Count }
})
$granularRows = @($contractFailures | Where-Object {
  @($_.reasons | Where-Object { $_.code -and $_.code -ne 'CONTRACT_NOT_EXECUTABLE' }).Count -gt 0
}).Count
$pitSql = "SELECT jsonb_build_object('total',count(*),'notEvaluated',count(*) FILTER (WHERE aegis_json->>'state' IS NULL),'evaluated',count(*) FILTER (WHERE aegis_json->>'state' IS NOT NULL))::text FROM trade.candidate_point_in_time_evidence WHERE decision_time::date='$SessionDate'"
$pit = (Invoke-ThetaSql -Connection $connection -Sql $pitSql) | ConvertFrom-Json
$timingSql = "SELECT jsonb_build_object('decision',decision_time,'provider',provider_timestamp,'received',ingestion_timestamp,'underlying',underlying,'dte',dte,'feed',feed)::text FROM research.option_contract_risk_history WHERE decision_time::date='$SessionDate'"
$timingRaw = @(Invoke-ThetaPg -Tool psql -Connection $connection -Arguments @(
  '--no-psqlrc','--no-align','--tuples-only','--set','ON_ERROR_STOP=1','--command',$timingSql))
if ($timingRaw.Count -gt 100000) { throw 'QUOTE_TIMING_SAMPLE_TOO_LARGE' }
$timingRows = @($timingRaw | Where-Object { $_ -and $_.StartsWith('{') } | ForEach-Object { $_ | ConvertFrom-Json })
$quoteAges = [Collections.Generic.List[double]]::new()
$ingestionLags = [Collections.Generic.List[double]]::new()
$timingInvalid = 0
$timingMissing = 0
foreach ($row in $timingRows) {
  if (-not $row.decision -or -not $row.provider -or -not $row.received) { $timingMissing++; continue }
  $decisionTime = [DateTimeOffset]::MinValue
  $providerTime = [DateTimeOffset]::MinValue
  $receivedTime = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse([string]$row.decision,[ref]$decisionTime) -or
      -not [DateTimeOffset]::TryParse([string]$row.provider,[ref]$providerTime) -or
      -not [DateTimeOffset]::TryParse([string]$row.received,[ref]$receivedTime)) {
    $timingInvalid++; continue
  }
  $age = ($decisionTime - $providerTime).TotalSeconds
  $ingestionLag = ($receivedTime - $providerTime).TotalSeconds
  if ($age -lt 0 -or $ingestionLag -lt 0) { $timingInvalid++; continue }
  $quoteAges.Add($age)
  $ingestionLags.Add($ingestionLag)
}
function Get-ThetaTimingPercentiles {
  param([Collections.Generic.List[double]]$Values)
  if ($Values.Count -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $result = [ordered]@{ count = $sorted.Count }
  foreach ($percentile in @(50,90,95,99)) {
    $index = [Math]::Ceiling(($percentile / 100) * $sorted.Count) - 1
    $result["p$percentile"] = [Math]::Round([double]$sorted[$index],3)
  }
  return [pscustomobject]$result
}
[pscustomobject]@{
  sessionDate = $SessionDate
  source = 'AIVEN_READ_ONLY_PERSISTED_EVIDENCE'
  shadowRows = $rows.Count
  categoryCounts = $categoryCounts
  contractNotExecutableCount = $contractFailures.Count
  contractNotExecutableDetails = $reasonCounts
  contractNotExecutableGranularReasonCounts = $granularReasonCounts
  contractNotExecutableGranularRows = $granularRows
  contractNotExecutableLegacyRows = $contractFailures.Count - $granularRows
  pitCandidateCount = $pit.total
  aegisNotEvaluatedCount = $pit.notEvaluated
  aegisEvaluatedCount = $pit.evaluated
  quoteTimingRows = $timingRows.Count
  quoteTimingMissingRows = $timingMissing
  quoteTimingInvalidRows = $timingInvalid
  quoteAgeAtDecisionSeconds = Get-ThetaTimingPercentiles $quoteAges
  providerToIngestionSeconds = Get-ThetaTimingPercentiles $ingestionLags
  note = 'Granular causes can overlap. Legacy rows retain original detail only. Provider-to-ingestion is persistence lag, not necessarily candidate receipt lag. Quote age at decision cannot alone separate feed latency from scan-pipeline latency. A NULL candidate AEGIS state proves no persisted assessment, not an AEGIS failure or pass.'
} | ConvertTo-Json -Depth 8
