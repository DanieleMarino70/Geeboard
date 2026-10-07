<#
.SYNOPSIS
  Removes the Geeboard agent's scheduled task and stops the agent; with -Purge and -PurgeData, takes away what it keeps.

.DESCRIPTION
  Stops the task, its wrapper and the agent that is listening on this node's port, unregisters the
  task, and takes away the firewall rule the installer made. It stops this node's agent and no other:
  a second node on this PC has its own wrapper and its own port, and is left running. It names what
  it stopped.

  By default it leaves what the agent keeps, and says what that is: the settings
  (%LOCALAPPDATA%\Geeboard\agent.json, which holds the agent's token), the log, and every server's
  files under the data root. Delete the servers from the panel first if the machine is being retired,
  then remove the node there.

    -Purge       also deletes the settings, the wrapper, the log and the panel's authority it was
                 given. The node in the panel can no longer be reached from this PC until it joins
                 again, and the token is gone from the disk
    -PurgeData   also deletes the data root: every world, backup and upload. It refuses while a
                 Geeboard game server's container exists, and asks for the node's name

  Both ask, in words: type the node's name, or give -Yes.

.PARAMETER TaskName
  The task's name in Task Scheduler. Default: Geeboard Agent.

.PARAMETER Purge
  Delete the agent's settings, wrapper, log and the panel's authority it was given.

.PARAMETER PurgeData
  Delete the data root, with every server's files, backups and uploads.

.PARAMETER Yes
  Take the question that -Purge and -PurgeData ask as answered.
#>
[CmdletBinding()]
param(
  [string]$TaskName = "Geeboard Agent",
  [switch]$Purge,
  [switch]$PurgeData,
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib.ps1")

$settings = Get-AgentSettings
$agent = Read-AgentFile $settings.AgentFile
$port = Get-AgentPort $agent
$nodeName = if ($agent -and $agent.nodeName) { [string]$agent.nodeName } else { "" }
$dataRoot = if ($agent -and $agent.dataRoot) { [string]$agent.dataRoot } else { "" }

# Asked before anything is touched, so that a refusal leaves everything as it was.
if ($PurgeData) {
  if (-not $dataRoot) {
    Write-Host "There is no data root to delete: no settings in $($settings.AgentFile) say where it is."
    exit 1
  }
  if ($dataRoot.Length -lt 4 -or -not (Split-Path $dataRoot -Parent)) {
    Write-Host "$dataRoot looks like a whole drive, and this will not delete one."
    exit 1
  }
  if (Test-DockerAnswers) {
    $containers = @(Get-ContainersUsingDataRoot $dataRoot)
    if ($containers.Count -gt 0) {
      Write-Host "$($containers.Count) Geeboard game server container(s) on this PC keep their files in $dataRoot."
      Write-Host "Delete those servers from the panel first: a container that is running is using them, and a stopped one would lose its world."
      exit 1
    }
  } else {
    Write-Host "Docker is not answering, so this cannot tell whether a game server's container still exists. Going on only if you say so."
  }
}
if (($Purge -or $PurgeData) -and -not $Yes) {
  $what = @()
  if ($PurgeData) { $what += "everything in $dataRoot (every world, backup and upload)" }
  if ($Purge) { $what += "the agent's settings, which hold its token" }
  $name = if ($nodeName) { $nodeName } else { "yes" }
  $answer = Read-Host "This deletes $($what -join " and "). Type '$name' to go on"
  if ($answer.Trim() -ne $name) {
    Write-Host "Not typed, so nothing was deleted and nothing was stopped."
    exit 1
  }
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

# Whether or not there is a task: an agent started by hand, or one a task left behind, is this node's too.
$stopped = @(Stop-GeeboardAgent -TaskName $TaskName -Wrapper $settings.Wrapper -Port $port)
if ($task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
foreach ($one in $stopped) { Write-Host "Stopped $one" }
if ($task) { Write-Host "Removed task '$TaskName'." }
if (-not $task -and $stopped.Count -eq 0) { Write-Host "No task named '$TaskName', and nothing of this node running." }

# The rule the installer made, when it made one.
if (Test-FirewallRuleExists $port) {
  if (Test-Elevated) {
    Remove-NetFirewallRule -DisplayName (Get-FirewallRuleName $port)
    Write-Host "Removed the firewall rule '$(Get-FirewallRuleName $port)'."
  } else {
    Write-Host "The firewall rule '$(Get-FirewallRuleName $port)' is still there; in PowerShell run as administrator:"
    Write-Host "  Remove-NetFirewallRule -DisplayName '$(Get-FirewallRuleName $port)'"
  }
}

$left = @()
if ($Purge) {
  foreach ($file in @($settings.AgentFile, $settings.Wrapper, $settings.Log, "$($settings.Log).1", $settings.CaFile)) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  }
  # The folder too, when that was all it held: it may be shared with a second node's files.
  if ((Test-Path -LiteralPath $settings.Directory) -and -not (Get-ChildItem -LiteralPath $settings.Directory -Force -ErrorAction SilentlyContinue)) {
    Remove-Item -LiteralPath $settings.Directory -Force
  }
  Write-Host "Deleted the agent's settings, wrapper, log and the panel's authority it was given ($($settings.Directory))."
} else {
  $left += "the settings, with the agent's token: $($settings.AgentFile)   (-Purge deletes them)"
}
if ($PurgeData) {
  # cmd's rmdir: it removes a link as a link, where a recursive Remove-Item on 5.1 can follow one into somewhere else.
  & cmd.exe /d /c "rmdir /s /q `"$dataRoot`" 2>nul" | Out-Null
  if (Test-Path -LiteralPath $dataRoot) {
    Write-Host "Not all of $dataRoot could be deleted: something in it is open. Close it and run this again with -PurgeData."
  } else {
    Write-Host "Deleted the data root, $dataRoot."
  }
} elseif ($dataRoot) {
  $left += "every server's files, backups and uploads: $dataRoot   (-PurgeData deletes them)"
}
if ($left.Count -gt 0) {
  Write-Host "Left in place:"
  foreach ($one in $left) { Write-Host "  - $one" }
}
if ($nodeName -and -not $Purge) {
  Write-Host "If the machine is being retired, remove the node '$nodeName' in the panel too."
}
