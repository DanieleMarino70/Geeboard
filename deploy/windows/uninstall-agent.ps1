<#
.SYNOPSIS
  Removes the Geeboard agent's scheduled task and stops the agent.

.DESCRIPTION
  Stops the task, its wrapper and the agent that is listening on this node's port, and
  unregisters the task. It stops this node's agent and no other: a second node on this
  PC has its own wrapper and its own port, and is left running. It names what it stopped.

  The agent's settings (%LOCALAPPDATA%\Geeboard\agent.json, which holds the agent's token),
  its log and the servers under %ProgramData%\Geeboard stay; delete servers from the panel
  first if the machine is being retired, then remove the node there.
#>
[CmdletBinding()]
param([string]$TaskName = "Geeboard Agent")

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$settings = Get-AgentSettings
$port = Get-AgentPort (Read-AgentFile $settings.AgentFile)
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

# Whether or not there is a task: an agent started by hand, or one a task left behind, is this node's too.
$stopped = @(Stop-GeeboardAgent -TaskName $TaskName -Wrapper $settings.Wrapper -Port $port)
if ($task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }

if (-not $task -and $stopped.Count -eq 0) {
  Write-Host "No task named '$TaskName', and nothing of this node running."
  exit 0
}
foreach ($one in $stopped) { Write-Host "Stopped $one" }
if ($task) { Write-Host "Removed task '$TaskName'." }
Write-Host "Left in place: the settings with the agent's token ($($settings.AgentFile)), the log, and the servers' files."
