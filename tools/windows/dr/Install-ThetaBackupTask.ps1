#Requires -Version 7
param([string]$BackupRoot, [string]$RunAt = '02:15')
. (Join-Path $PSScriptRoot 'ThetaBackup.Common.ps1')
$root = Get-ThetaBackupRoot $BackupRoot
$credentialPath = Join-Path $root 'config\aiven-url.dpapi'
if (-not (Test-Path -LiteralPath $credentialPath)) { throw 'BACKUP_CREDENTIAL_NOT_CONFIGURED' }
if ($RunAt -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw 'TASK_TIME_INVALID' }
$taskName = 'THETA-Aiven-Verified-Backup'
$script = Join-Path $PSScriptRoot 'Backup-Theta.ps1'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$action = New-ScheduledTaskAction -Execute (Get-Command pwsh).Source -Argument "-NoProfile -File `"$script`" -BackupRoot `"$root`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($RunAt,'HH:mm',[Globalization.CultureInfo]::InvariantCulture))
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
@{state='INSTALLED'; taskName=$taskName; timeLocal=$RunAt; userScope='CURRENT_LOGGED_IN_USER'; networkRequired=$true; credentialStorage='WINDOWS_USER_DPAPI'} | ConvertTo-Json -Compress
