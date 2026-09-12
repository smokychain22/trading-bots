param([string]$TaskName = 'THETA Local Shadow Worker')
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'stop-theta-local-worker.ps1') -TaskName $TaskName -GraceSeconds 30
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
$repositoryPath=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stateRoot=[IO.Path]::GetFullPath((Join-Path $repositoryPath '.theta-local-worker'))
if ($stateRoot.StartsWith($repositoryPath,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $stateRoot)) {
  Remove-Item -LiteralPath $stateRoot -Recurse -Force
}
Write-Output (@{uninstalled=$true;task=$TaskName;credentialsRemoved=$false} | ConvertTo-Json -Compress)
