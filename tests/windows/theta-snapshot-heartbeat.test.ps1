# The exported-snapshot keeper must keep its session active during the multi-hour dump and must record its own death.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\tools\windows\dr\ThetaBackup.Common.ps1')
Initialize-ThetaSnapshotHeartbeat
function New-Echo {
  $si = [Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
  foreach ($a in @('-NoProfile','-Command','while($l=[Console]::In.ReadLine()){ [Console]::Out.WriteLine($l) }')) { [void]$si.ArgumentList.Add($a) }
  $si.RedirectStandardInput = $true; $si.RedirectStandardOutput = $true; $si.UseShellExecute = $false
  return [Diagnostics.Process]::Start($si)
}
$p = New-Echo
$hb = [ThetaSnapshotHeartbeat]::new($p, 1)
Start-Sleep -Seconds 4
$hb.Stop()
if ($hb.FailureMessage) { throw "HEARTBEAT_UNEXPECTED_FAILURE:$($hb.FailureMessage)" }
$p.StandardInput.Close()
$out = $p.StandardOutput.ReadToEnd(); [void]$p.WaitForExit(5000)
if (([regex]::Matches($out, 'SELECT 1;')).Count -lt 2) { throw 'HEARTBEAT_NOT_SENT' }
$dead = New-Echo; $dead.Kill(); $dead.WaitForExit()
$hb2 = [ThetaSnapshotHeartbeat]::new($dead, 1); Start-Sleep -Seconds 2; $hb2.Stop()
if ($hb2.FailureMessage -notmatch '^KEEPER_EXITED') { throw 'DEAD_KEEPER_NOT_RECORDED' }
'THETA_SNAPSHOT_HEARTBEAT_TEST=PASS'
