param([string]$TaskName = 'THETA Master Paper Worker')
$ErrorActionPreference = 'Stop'
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$info=if($null-ne$task){Get-ScheduledTaskInfo -TaskName $TaskName}else{$null}
$repositoryPath=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statusFile=Join-Path $repositoryPath '.theta-local-worker\status.json'
$health=if(Test-Path -LiteralPath $statusFile){Get-Content -Raw -LiteralPath $statusFile|ConvertFrom-Json}else{$null}
$settings=if($null-ne$task){$task.Settings}else{$null}
Write-Output (@{installed=$null-ne$task;taskState=if($null-ne$task){[string]$task.State}else{'NOT_INSTALLED'};
  lastRunTime=if($null-ne$info){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null};
  lastTaskResult=if($null-ne$info){$info.LastTaskResult}else{$null};health=$health;
  triggerCount=if($null-ne$task){@($task.Triggers).Count}else{0};
  startWhenAvailable=if($null-ne$settings){[bool]$settings.StartWhenAvailable}else{$false};
  restartCount=if($null-ne$settings){[int]$settings.RestartCount}else{0};
  runOnlyIfNetworkAvailable=if($null-ne$settings){[bool]$settings.RunOnlyIfNetworkAvailable}else{$false};
  wakeToRun=if($null-ne$settings){[bool]$settings.WakeToRun}else{$false};
  multipleInstances=if($null-ne$settings){[string]$settings.MultipleInstances}else{'UNKNOWN'};
  executionGate='EXTERNAL_QUOTE_BLOCKER'} | ConvertTo-Json -Depth 6 -Compress)
