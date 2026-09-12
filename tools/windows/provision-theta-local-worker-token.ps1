$ErrorActionPreference = 'Stop'
$repositoryPath=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $repositoryPath
$projectFile=Join-Path $repositoryPath '.vercel\project.json'
if(!(Test-Path -LiteralPath $projectFile)){throw 'VERCEL_PROJECT_LINK_REQUIRED'}
$project=Get-Content -Raw -LiteralPath $projectFile|ConvertFrom-Json
if($project.projectName-ne'trading-bots'){throw 'WRONG_VERCEL_PROJECT_LINK'}
$stateRoot=Join-Path $repositoryPath '.theta-local-worker'
New-Item -ItemType Directory -Force -Path $stateRoot|Out-Null
$bytes=New-Object byte[] 48
$generator=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$generator.GetBytes($bytes)}finally{$generator.Dispose()}
$token=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
$tokenFile=Join-Path $stateRoot 'worker.token'
Set-Content -LiteralPath $tokenFile -Value $token -Encoding ascii -NoNewline
$token|& vercel.cmd env update CRON_SECRET production --sensitive --yes|Out-Null
if($LASTEXITCODE-ne 0){Remove-Item -LiteralPath $tokenFile -Force;throw 'VERCEL_CRON_SECRET_UPDATE_FAILED'}
Write-Output (@{provisioned=$true;project=$project.projectName;environment='Production';redeployRequired=$true;secretPrinted=$false}|ConvertTo-Json -Compress)
