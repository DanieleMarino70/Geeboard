<#
.SYNOPSIS
  Runs the Geeboard node agent as a scheduled task that starts when you sign in.

.DESCRIPTION
  On Windows the agent drives Docker Desktop, which itself runs in the signed-in
  user's session — so the agent runs there too: a scheduled task, in this
  account, started at logon and restarted if it stops. It runs `npm.cmd start`
  in this checkout's daemon\ directory, which reads the settings `join` saved
  in %LOCALAPPDATA%\Geeboard\agent.json. Nothing here holds a token.

  This is one step of the Windows node installation, and install-node.ps1 is
  the whole of it — the checks, the dependencies, the join, this, and a look
  at whether the agent came up. That is the command the panel writes:

    powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel '<panel>' -Token '<token>'

  Run this one on its own when the machine has already joined and only the
  task needs replacing. Running it again replaces the task (that is the
  upgrade, after git pull and npm.cmd install). Remove it with
  uninstall-agent.ps1.

.PARAMETER TaskName
  The task's name in Task Scheduler. Default: Geeboard Agent.

.PARAMETER NoStart
  Register the task without starting it now.
#>
[CmdletBinding()]
param(
  [string]$TaskName = "Geeboard Agent",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$daemon = (Resolve-Path (Join-Path $PSScriptRoot "..\..\daemon")).Path
$agentFile = Join-Path $env:LOCALAPPDATA "Geeboard\agent.json"

if (-not (Test-Path (Join-Path $daemon "node_modules"))) {
  throw "Run npm.cmd install in $daemon first, or use install-node.ps1, which does it for you."
}
if (-not (Test-Path $agentFile)) {
  throw "No $agentFile yet: this machine has not joined a panel. Nodes -> Add a node in the panel writes the command, which is install-node.ps1 with a token."
}
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm.cmd is not on PATH. Install Node.js." }

# A wrapper script rather than a long argument line: the task's command
# stays readable in Task Scheduler, and the working directory is set where
# npm expects it.
$wrapper = Join-Path $env:LOCALAPPDATA "Geeboard\run-agent.ps1"
@"
# Written by deploy\windows\install-agent.ps1. Starts the Geeboard agent from the
# settings join saved beside this file. No secret lives in here.
Set-Location '$daemon'
& '$npm' start
"@ | Set-Content -Path $wrapper -Encoding utf8

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$wrapper`"" `
  -WorkingDirectory $daemon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description "Geeboard node agent: drives Docker Desktop for the panel. Reads $agentFile." | Out-Null

if (-not $NoStart) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
}
$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "Task '$TaskName' registered for $env:USERNAME, at logon, restarting on failure. State: $state"
Write-Host "  Get-ScheduledTask '$TaskName' | Get-ScheduledTaskInfo    last run and result"
Write-Host "  .\deploy\windows\uninstall-agent.ps1                     to remove it"
