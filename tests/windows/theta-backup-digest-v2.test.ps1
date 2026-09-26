#Requires -Version 7
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')

$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')
if ($source -notmatch 'BOUNDED_INTEGRITY_PROJECTION_V2') { throw 'DIGEST_V2_METHOD_MISSING' }
if ($source -notmatch "'trade\.fusion_snapshot'") { throw 'FUSION_PROJECTION_MISSING' }
if ($source -notmatch "'market\.optionomics_raw_observation'") { throw 'OPTIONOMICS_PROJECTION_MISSING' }
if ($source -notmatch "'trade\.candidate_point_in_time_evidence'") { throw 'CANDIDATE_PROJECTION_MISSING' }
if ($source -notmatch 'CRITICAL_DIGEST_QUERY_FAILED:\$name') { throw 'DIGEST_TABLE_FAILURE_IDENTITY_MISSING' }
if ($source -notmatch 'unexpected eof') { throw 'TRANSIENT_TLS_RETRY_CLASSIFICATION_MISSING' }

$backup = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\dr\Backup-Theta.ps1')
if ($backup -notmatch "criticalDigestMethod='BOUNDED_INTEGRITY_PROJECTION_V2'") {
  throw 'BACKUP_MANIFEST_DIGEST_V2_MISSING'
}
$verify = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\dr\Verify-ThetaBackup.ps1')
if ($verify -notmatch 'BOUNDED_INTEGRITY_PROJECTION_V2') { throw 'VERIFY_DIGEST_V2_MISSING' }
$checkpoint = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\..\tools\windows\dr\Invoke-ThetaProductionMigration.ps1')
if ($checkpoint -notmatch 'previousKnownGoodBackupPreserved') { throw 'KNOWN_GOOD_PRESERVATION_RECEIPT_MISSING' }
if ($checkpoint -match 'previousBackupPreserved=\(\$null -ne \$before\)') {
  throw 'AMBIGUOUS_PREVIOUS_BACKUP_RECEIPT_REMAINS'
}

$script:CapturedDigestSql = $null
function Invoke-ThetaSql {
  param([object]$Connection, [string]$Sql)
  $script:CapturedDigestSql = $Sql
  return ('a' * 32)
}
$structure = [pscustomobject]@{
  tables = @([pscustomobject]@{ name='trade.fusion_snapshot' })
  columns = @(
    [pscustomobject]@{ name='trade.fusion_snapshot.fusion_snapshot_id' },
    [pscustomobject]@{ name='trade.fusion_snapshot.content_hash' },
    [pscustomobject]@{ name='trade.fusion_snapshot.snapshot_json' },
    [pscustomobject]@{ name='trade.fusion_snapshot.evidence_archive_gzip' },
    [pscustomobject]@{ name='trade.fusion_snapshot.evidence_archive_hash' }
  )
}
$digest = Get-ThetaCriticalDigest -Connection ([pscustomobject]@{}) -Structure $structure
if ($digest['trade.fusion_snapshot'] -ne ('a' * 32)) { throw 'DIGEST_V2_RESULT_INVALID' }
if ($script:CapturedDigestSql -notmatch 'jsonb_build_object') { throw 'DIGEST_V2_BOUNDED_PROJECTION_NOT_USED' }
if ($script:CapturedDigestSql -notmatch 'evidence_archive_hash') { throw 'DIGEST_V2_ARCHIVE_HASH_OMITTED' }
if ($script:CapturedDigestSql -match 'snapshot_json|evidence_archive_gzip|to_jsonb\(t\)') {
  throw 'DIGEST_V2_LARGE_PAYLOAD_REINTRODUCED'
}

Write-Output 'theta backup bounded digest v2 test passed'
