# Sequence parity for a LIVE source: restored values may lag the later-captured source values, never lead them.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')
function S([string]$name, $value) { [pscustomobject]@{ name = $name; lastValue = $value } }
function J([object[]]$items) { ConvertTo-Json -InputObject $items -Compress }
function Expect([string]$name, [bool]$expected, [string]$source, [string]$restored) {
  $actual = Test-ThetaSequenceStateParity -SourceRaw $source -RestoredRaw $restored
  if ($actual -ne $expected) { throw "SEQUENCE_PARITY_UNEXPECTED:$name expected=$expected actual=$actual" }
}
$base = J @((S 'a.s1' 10), (S 'a.s2' $null), (S 'b.s3' 5))
Expect 'identical' $true $base $base
Expect 'restored lags a live source' $true (J @((S 'a.s1' 60), (S 'a.s2' 3), (S 'b.s3' 5))) $base
Expect 'restored unused sequence, source used' $true (J @((S 'a.s1' 1))) (J @((S 'a.s1' $null)))
Expect 'restored AHEAD of source' $false (J @((S 'a.s1' 10))) (J @((S 'a.s1' 11)))
Expect 'restored used but source unused' $false (J @((S 'a.s1' $null))) (J @((S 'a.s1' 1)))
Expect 'sequence missing from restore' $false (J @((S 'a.s1' 1), (S 'a.s2' 1))) (J @((S 'a.s1' 1)))
Expect 'extra sequence in restore' $false (J @((S 'a.s1' 1))) (J @((S 'a.s1' 1), (S 'a.s2' 1)))
Expect 'renamed sequence' $false (J @((S 'a.s1' 1))) (J @((S 'a.s9' 1)))
Expect 'empty both' $true '[]' '[]'
'THETA_SEQUENCE_PARITY_TEST=PASS'
