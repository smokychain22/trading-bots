param([string]$TaskName = 'THETA Local Shadow Worker')
$ErrorActionPreference = 'Stop'
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stopFile = Join-Path $repositoryPath '.theta-local-worker\stop.request'
if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile -Force }
if (!(Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { throw 'THETA_LOCAL_WORKER_NOT_INSTALLED' }
Start-ScheduledTask -TaskName $TaskName
Write-Output (@{started=$true;task=$TaskName;executionGate='LOCKED'} | ConvertTo-Json -Compress)
