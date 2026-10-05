$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\tools\windows\ThetaProcess.Common.ps1')

function Assert-Equal($Actual, $Expected, $Name) {
  if ($Actual -ne $Expected) { throw "$Name expected $Expected, received $Actual" }
}

$normal = Get-ThetaHostResourceGuard -TotalMemoryBytes 32GB -FreeMemoryBytes 9GB -FreeDiskBytes 55GB
Assert-Equal $normal.MemoryState 'NORMAL' 'normal memory'
Assert-Equal $normal.StorageState 'NORMAL' 'normal storage'
Assert-Equal $normal.AllowHeavyResearch $true 'normal research'

$throttle = Get-ThetaHostResourceGuard -TotalMemoryBytes 32GB -FreeMemoryBytes 7GB -FreeDiskBytes 40GB
Assert-Equal $throttle.MemoryState 'HOST_MEMORY_THROTTLE_NONCRITICAL' 'throttled memory'
Assert-Equal $throttle.StorageState 'HOST_STORAGE_THROTTLE_NONCRITICAL' 'throttled storage'
Assert-Equal $throttle.AllowHeavyResearch $false 'throttled research'

$pause = Get-ThetaHostResourceGuard -TotalMemoryBytes 32GB -FreeMemoryBytes 4GB -FreeDiskBytes 25GB
Assert-Equal $pause.MemoryState 'HOST_MEMORY_PAUSE_NONCRITICAL' 'paused memory'
Assert-Equal $pause.StorageState 'HOST_STORAGE_ARCHIVES_DISABLED' 'disabled archives'
Assert-Equal $pause.PauseNonCritical $true 'paused background work'

$emergency = Get-ThetaHostResourceGuard -TotalMemoryBytes 32GB -FreeMemoryBytes 2GB -FreeDiskBytes 15GB
Assert-Equal $emergency.MemoryState 'HOST_MEMORY_PRESSURE' 'emergency memory'
Assert-Equal $emergency.StorageState 'EMERGENCY_STORAGE_PRESSURE' 'emergency storage'
Assert-Equal $emergency.AllowHeavyResearch $false 'emergency research'

'PASS'
