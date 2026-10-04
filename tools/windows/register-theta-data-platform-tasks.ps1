#Requires -Version 7
<#
Registers (or with -DryRun only prints) the THETA data platform scheduled tasks. The owner does nothing after this is installed.
  THETA-DataPlatform-PreSession   every day 08:30 America/New_York  READY | NEW_RISK_STORAGE_LOCK, pressure state, repairs default partitions, ensures upcoming partitions exist (daily so the pressure
                                  state a writer reads is never older than its 36 hour validity, weekends and holidays included)
  THETA-DataPlatform-PostSession  weekdays 16:30 America/New_York  close, archive, verify, retire past-window partitions, measure, receipt
  THETA-DataPlatform-Slo          weekdays 17:15 America/New_York  production storage SLO (post-archive slope, hot bytes per decision, queue, lag)
  THETA-DataPlatform-Weekly       Saturday 10:00 America/New_York  archive + Parquet integrity sweep and sampled replay
Times are converted from America/New_York to the machine's local time. Tasks run the data platform tool from the immutable release folder (-ReleasePath) and never
touch broker, order, fill or reconciliation tables. No credential is placed in the task definition: the tool reads the canonical environment file path named in -EnvironmentFile.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ReleasePath,
  [string]$EnvironmentFile = '.env.local',
  [string]$NodePath = 'node',
  [switch]$DryRun
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$eastern = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
function ConvertTo-LocalClock([string]$easternClock) {
  $parts = $easternClock.Split(':')
  $today = [datetime]::Today
  $easternWall = [datetime]::new($today.Year, $today.Month, $today.Day, [int]$parts[0], [int]$parts[1], 0, [DateTimeKind]::Unspecified)
  $utc = [TimeZoneInfo]::ConvertTimeToUtc($easternWall, $eastern)
  return [TimeZoneInfo]::ConvertTimeFromUtc($utc, [TimeZoneInfo]::Local).ToString('HH:mm')
}

$definitions = @(
  [pscustomobject]@{ Name = 'THETA-DataPlatform-PreSession';  Mode = 'pre-session';  Eastern = '08:30'; Days = @('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday') },
  [pscustomobject]@{ Name = 'THETA-DataPlatform-PostSession'; Mode = 'post-session'; Eastern = '16:30'; Days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday') },
  [pscustomobject]@{ Name = 'THETA-DataPlatform-Slo';         Mode = 'slo';          Eastern = '17:15'; Days = @('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday') },
  [pscustomobject]@{ Name = 'THETA-DataPlatform-Weekly';      Mode = 'weekly';       Eastern = '10:00'; Days = @('Saturday') }
)

$plan = foreach ($definition in $definitions) {
  [pscustomobject]@{
    Name = $definition.Name
    Mode = $definition.Mode
    EasternTime = $definition.Eastern
    LocalTime = ConvertTo-LocalClock $definition.Eastern
    DaysOfWeek = $definition.Days
    Execute = $NodePath
    Arguments = "--import tsx tools/theta-data-platform.ts --mode=$($definition.Mode) --environment-file=$EnvironmentFile"
    WorkingDirectory = $ReleasePath
    ExecutionTimeLimitHours = 3
    MultipleInstances = 'IgnoreNew'
    StartWhenAvailable = $true
    RunOnlyIfOnAC = $true
  }
}

if ($DryRun) {
  $plan | ConvertTo-Json -Depth 4
  return
}

foreach ($task in $plan) {
  $action = New-ScheduledTaskAction -Execute $task.Execute -Argument $task.Arguments -WorkingDirectory $task.WorkingDirectory
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $task.DaysOfWeek -At $task.LocalTime
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours $task.ExecutionTimeLimitHours) -MultipleInstances IgnoreNew -StartWhenAvailable -DontStopIfGoingOnBatteries:$false
  Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Description 'THETA data platform automation (storage lifecycle). Never touches broker, order or fill tables.' -Force | Out-Null
}
Get-ScheduledTask -TaskName 'THETA-DataPlatform-*' | Select-Object TaskName, State | ConvertTo-Json
