#Requires -Version 7
# The data platform scheduled-task definitions: dry run only (nothing is registered). Checks times, arguments, safety properties and that no credential appears.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\..\tools\windows\register-theta-data-platform-tasks.ps1'
$json = & pwsh -NoProfile -File $script -ReleasePath 'C:\theta\releases\abc' -DryRun | Out-String
$plan = $json | ConvertFrom-Json
if ($plan.Count -ne 4) { throw "THETA_DP_TASKS_COUNT:$($plan.Count)" }
$modes = ($plan | ForEach-Object { $_.Mode }) -join ','
if ($modes -ne 'pre-session,post-session,slo,weekly') { throw "THETA_DP_TASKS_MODES:$modes" }
foreach ($task in $plan) {
  if ($task.Arguments -notmatch '--import tsx tools/theta-data-platform.ts --mode=') { throw "THETA_DP_TASK_ARGUMENTS:$($task.Name)" }
  if ($task.Arguments -match 'postgres://|PASSWORD|TOKEN|SECRET') { throw "THETA_DP_TASK_CONTAINS_SECRET:$($task.Name)" }
  if ($task.WorkingDirectory -ne 'C:\theta\releases\abc') { throw "THETA_DP_TASK_WORKDIR:$($task.Name)" }
  if ($task.MultipleInstances -ne 'IgnoreNew') { throw "THETA_DP_TASK_OVERLAP:$($task.Name)" }
  if ($task.StartWhenAvailable -ne $true) { throw "THETA_DP_TASK_CATCHUP:$($task.Name)" }
  if ($task.LocalTime -notmatch '^\d{2}:\d{2}$') { throw "THETA_DP_TASK_TIME:$($task.Name)" }
}
$post = $plan | Where-Object { $_.Mode -eq 'post-session' }
if ($post.EasternTime -ne '16:30') { throw 'THETA_DP_POST_SESSION_TIME' }
$pre = $plan | Where-Object { $_.Mode -eq 'pre-session' }
if (@($pre.DaysOfWeek).Count -ne 7) { throw 'THETA_DP_PRE_SESSION_MUST_RUN_DAILY' }
$slo = $plan | Where-Object { $_.Mode -eq 'slo' }
if ([datetime]::ParseExact($slo.EasternTime, 'HH:mm', $null) -le [datetime]::ParseExact($post.EasternTime, 'HH:mm', $null)) { throw 'THETA_DP_SLO_BEFORE_POST_SESSION' }
if ([datetime]::ParseExact($pre.EasternTime, 'HH:mm', $null) -ge [datetime]::ParseExact('09:30', 'HH:mm', $null)) { throw 'THETA_DP_PRE_SESSION_AFTER_OPEN' }
'THETA_DATA_PLATFORM_TASKS_TEST=PASS'
