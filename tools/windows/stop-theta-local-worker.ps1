param([string]$TaskName = 'THETA Local Shadow Worker',[int]$GraceSeconds = 30)
$ErrorActionPreference = 'Stop'
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stateRoot = Join-Path $repositoryPath '.theta-local-worker'
if (!(Test-Path -LiteralPath $stateRoot)) { throw 'THETA_LOCAL_WORKER_NOT_INSTALLED' }
$stopFile = Join-Path $stateRoot 'stop.request'
New-Item -ItemType File -Force -Path $stopFile | Out-Null
for($attempt=0;$attempt -lt $GraceSeconds;$attempt++){
  $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($null -eq $task -or $task.State -ne 'Running') { break }
  Start-Sleep -Seconds 1
}
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName }
Write-Output (@{stopped=$true;task=$TaskName;gracefulRequested=$true;executionGate='LOCKED'} | ConvertTo-Json -Compress)
