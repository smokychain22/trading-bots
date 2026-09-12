param([string]$TaskName = 'THETA Local Shadow Worker')
$ErrorActionPreference = 'Stop'
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryPath

if ((& git branch --show-current).Trim() -ne 'main') { throw 'THETA_INSTALL_REQUIRES_MAIN' }
if ((& git status --porcelain).Count -gt 0) { throw 'THETA_INSTALL_REQUIRES_CLEAN_TREE' }
$buildSha = (& git rev-parse HEAD).Trim()
$remoteSha = (& git rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $buildSha -ne $remoteSha) { throw 'THETA_INSTALL_REQUIRES_TESTED_ORIGIN_MAIN' }
$projectFile = Join-Path $repositoryPath '.vercel\project.json'
if (!(Test-Path -LiteralPath $projectFile)) { throw 'VERCEL_PROJECT_LINK_REQUIRED' }
$project = Get-Content -Raw -LiteralPath $projectFile | ConvertFrom-Json
if ($project.projectName -ne 'trading-bots') { throw 'WRONG_VERCEL_PROJECT_LINK' }

& npm run build
if ($LASTEXITCODE -ne 0) { throw 'THETA_BUILD_FAILED' }
$stateRoot = Join-Path $repositoryPath '.theta-local-worker'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
if (!(Test-Path -LiteralPath (Join-Path $stateRoot 'worker.token'))) { throw 'THETA_LOCAL_WORKER_TOKEN_NOT_PROVISIONED' }
@{ repositoryPath=$repositoryPath;buildSha=$buildSha;installedAt=(Get-Date).ToUniversalTime().ToString('o');
  mode='THETA_LOCAL_SHADOW';projectName=$project.projectName;workerId=('local-'+[guid]::NewGuid().ToString());
  endpoint='https://trading-bots-one.vercel.app/api/theta-runtime' } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot 'runtime.json') -Encoding utf8

$workerScript = Join-Path $PSScriptRoot 'theta-local-worker.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$workerScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description "Pinned THETA read-only shadow worker at $buildSha. No broker mutation surface." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output (@{installed=$true;task=$TaskName;buildSha=$buildSha;mode='THETA_LOCAL_SHADOW';executionGate='LOCKED'} | ConvertTo-Json -Compress)
