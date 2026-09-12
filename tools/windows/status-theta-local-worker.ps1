param([string]$TaskName = 'THETA Local Shadow Worker')
$ErrorActionPreference = 'Stop'
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$info=if($null-ne$task){Get-ScheduledTaskInfo -TaskName $TaskName}else{$null}
$repositoryPath=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statusFile=Join-Path $repositoryPath '.theta-local-worker\status.json'
$health=if(Test-Path -LiteralPath $statusFile){Get-Content -Raw -LiteralPath $statusFile|ConvertFrom-Json}else{$null}
Write-Output (@{installed=$null-ne$task;taskState=if($null-ne$task){[string]$task.State}else{'NOT_INSTALLED'};
  lastRunTime=if($null-ne$info){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null};
  lastTaskResult=if($null-ne$info){$info.LastTaskResult}else{$null};health=$health;executionGate='LOCKED'} | ConvertTo-Json -Depth 6 -Compress)
