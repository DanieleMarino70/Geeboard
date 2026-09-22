<#
.SYNOPSIS
  Removes the Geeboard agent's scheduled task.

.DESCRIPTION
  Stops the task and unregisters it. The agent's settings
  (%LOCALAPPDATA%\Geeboard\agent.json) and the servers under
  %ProgramData%\Geeboard stay; delete servers from the panel first if the
  machine is being retired, then remove the node there.
#>
[CmdletBinding()]
param([string]$TaskName = "Geeboard Agent")

$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No task named '$TaskName'."
  exit 0
}
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
# The agent itself: the task's stop ends powershell, not always node underneath it.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*daemon*src\index.ts*" -or $_.CommandLine -like "*daemon*src/index.ts*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "Removed task '$TaskName'. Settings and servers were left in place."
