param([string]$TaskName = 'THETA Master Paper Worker')
$ErrorActionPreference = 'Stop'
$task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$info=if($null-ne$task){Get-ScheduledTaskInfo -TaskName $TaskName}else{$null}
$repositoryPath=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statusFile=Join-Path $repositoryPath '.theta-local-worker\status.json'
$runtimeFile=Join-Path $repositoryPath '.theta-local-worker\runtime.json'
$health=if(Test-Path -LiteralPath $statusFile){Get-Content -Raw -LiteralPath $statusFile|ConvertFrom-Json}else{$null}
$runtime=if(Test-Path -LiteralPath $runtimeFile){Get-Content -Raw -LiteralPath $runtimeFile|ConvertFrom-Json}else{$null}
$workspaceSha=(& git -C $repositoryPath rev-parse HEAD 2>$null).Trim()
$releasePath=if($null-ne$runtime-and$null-ne$runtime.releasePath){[string]$runtime.releasePath}else{$null}
$releaseSha=if($null-ne$releasePath-and(Test-Path -LiteralPath $releasePath)){(& git -C $releasePath rev-parse HEAD 2>$null).Trim()}else{$null}
$runtimeShaAligned=$null-ne$runtime-and$releaseSha-eq[string]$runtime.buildSha
$healthShaAligned=$null-ne$health-and$null-ne$runtime-and[string]$health.buildSha-eq[string]$runtime.buildSha
$taskRunning=$null-ne$task-and[string]$task.State-eq'Running'
$supervisorProcesses=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $null-ne$_.CommandLine-and$_.CommandLine-match'(?i)[\\/]theta-local-worker\.ps1(?:"|\s|$)'
})
$supervisorCount=$supervisorProcesses.Count
$healthTimestamp=$null
foreach($field in @('observedAt','lastCycle','lastFailure','lastShutdown')){
  if($null-ne$health-and$null-ne$health.$field){$healthTimestamp=[DateTimeOffset]::Parse([string]$health.$field);break}
}
$healthAgeSeconds=if($null-ne$healthTimestamp){[Math]::Max(0,[Math]::Round(([DateTimeOffset]::UtcNow-$healthTimestamp).TotalSeconds))}else{$null}
$healthFresh=$null-ne$healthAgeSeconds-and$healthAgeSeconds-le420
$effectiveState=if($taskRunning){if($supervisorCount-eq0){'WORKER_ABSENT'}
  elseif($supervisorCount-gt1){'DUPLICATE_SUPERVISOR'}
  elseif(-not$runtimeShaAligned){'BLOCKED_RUNTIME_SHA_MISMATCH'}
  elseif(-not$healthShaAligned){'STARTING_NEW_RELEASE'}
  elseif([string]$health.state-eq'SCHEMA_INCOMPATIBLE'){'SCHEMA_INCOMPATIBLE'}
  elseif(-not$healthFresh){'STALE_HEARTBEAT'}else{[string]$health.state}}
  elseif($null-ne$runtime-and-not$runtimeShaAligned){'BLOCKED_RUNTIME_SHA_MISMATCH'}
  elseif($null-ne$task){'NOT_RUNNING'}else{'NOT_INSTALLED'}
$settings=if($null-ne$task){$task.Settings}else{$null}
Write-Output (@{installed=$null-ne$task;taskState=if($null-ne$task){[string]$task.State}else{'NOT_INSTALLED'};
  lastRunTime=if($null-ne$info){$info.LastRunTime.ToUniversalTime().ToString('o')}else{$null};
  lastTaskResult=if($null-ne$info){$info.LastTaskResult}else{$null};
  triggerCount=if($null-ne$task){@($task.Triggers).Count}else{0};
  startWhenAvailable=if($null-ne$settings){[bool]$settings.StartWhenAvailable}else{$false};
  restartCount=if($null-ne$settings){[int]$settings.RestartCount}else{0};
  runOnlyIfNetworkAvailable=if($null-ne$settings){[bool]$settings.RunOnlyIfNetworkAvailable}else{$false};
  wakeToRun=if($null-ne$settings){[bool]$settings.WakeToRun}else{$false};
  multipleInstances=if($null-ne$settings){[string]$settings.MultipleInstances}else{'UNKNOWN'};
  reportedHealth=$health;effectiveState=$effectiveState;runtimeSha=if($null-ne$runtime){[string]$runtime.buildSha}else{$null};
  workspaceSha=$workspaceSha;releasePath=$releasePath;releaseSha=$releaseSha;runtimeShaAligned=$runtimeShaAligned;
  healthShaAligned=$healthShaAligned;supervisorProcessCount=$supervisorCount;
  supervisorProcessIds=@($supervisorProcesses|ForEach-Object{[int]$_.ProcessId});healthAgeSeconds=$healthAgeSeconds;
  healthFresh=$healthFresh;leaseState='UNVERIFIED_BY_LOCAL_STATUS';
  executionGate=if($taskRunning-and$healthShaAligned-and$healthFresh){[string]$health.executionGate}else{'LOCKED'}} | ConvertTo-Json -Depth 6 -Compress)
