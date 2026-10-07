<#
.SYNOPSIS
  Runs the Geeboard node agent as a scheduled task that starts when you sign in.

.DESCRIPTION
  On Windows the agent drives Docker Desktop, which itself runs in the signed-in
  user's session — so the agent runs there too: a scheduled task, in this
  account, started at logon. The task runs a small wrapper beside the agent's
  settings, and the wrapper runs `npm.cmd start` in this checkout's daemon\
  directory, which reads the settings `join` saved in
  %LOCALAPPDATA%\Geeboard\agent.json. Nothing here holds a token.

  What the wrapper does, and why it is not just `npm.cmd start`:

    - it writes what the agent says, and every time it stops and with what
      exit code, to agent.log beside the settings (rotated at 5 MB). A hidden
      window has nobody to read it, and every message, doc page and the
      Linux installer say "read the agent's log"
    - it starts the agent again when it stops, after 5 seconds and then after
      longer, up to five minutes, and never gives up. Task Scheduler's own
      restart gave up after ten and said nothing. The exception is the exit
      code the agent uses to say "another agent holds my port": starting it
      again would change nothing
    - it works under a checkout whose path has an apostrophe in it, or a
      letter that is not ASCII, which a script that quotes paths by hand does
      not

  And what running this does, in order:

    1  stops this node's agent, and only this node's (lib.ps1): the task, its
       wrapper, and whatever listens on this node's port. An agent started by
       hand, or one a stopped task left behind, would otherwise keep the port
       and answer as if all were well while the new one died of it
    2  refuses, naming who it is, when something else holds the port
    3  writes the wrapper and registers the task: at logon, and on battery too
    4  starts it and waits for it to answer, and says so when what answers is
       older than this checkout

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
. (Join-Path $PSScriptRoot "lib.ps1")

$daemon = (Resolve-Path (Join-Path $PSScriptRoot "..\..\daemon")).Path
# The settings the agent was joined with: GEEBOARD_AGENT_FILE when this PC keeps them somewhere of its own, the account's profile
# otherwise. The wrapper, the log and the panel's authority live beside that file, so a second node on one PC does not share them.
$settings = Get-AgentSettings
$agent = Read-AgentFile $settings.AgentFile
$port = Get-AgentPort $agent

if (-not (Test-Path (Join-Path $daemon "node_modules"))) {
  throw "Run npm.cmd install in $daemon first, or use install-node.ps1, which does it for you."
}
if (-not $agent) {
  throw "No settings in $($settings.AgentFile) yet: this machine has not joined a panel. Nodes -> Add a node in the panel writes the command, which is install-node.ps1 with a token."
}
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm.cmd is not on PATH. Install Node.js." }

# 1 — this node's agent, gone, and its port free.
foreach ($one in (Stop-GeeboardAgent -TaskName $TaskName -Wrapper $settings.Wrapper -Port $port)) {
  Write-Host "Stopped $one"
}

# 2 — something else on the port is not ours to stop.
$owner = Get-PortOwner $port
if ($owner) {
  $what = if ($owner.CommandLine) { " (started as: $($owner.CommandLine))" } else { "" }
  throw "Port $port is held by $($owner.Name), pid $($owner.Pid)$what, and it is not an agent of this node. Stop it, or join again with -Port <another port>: the panel is told the address, so a different port is a new join."
}

# 3 — the wrapper. The values go in as PowerShell literals with their apostrophes doubled, and through the environment into
# cmd.exe, which does the redirecting (see lib.ps1: 2>&1 on a native program under 5.1 turns every line into an error record).
$template = @'
# Written by deploy\windows\install-agent.ps1. Runs the Geeboard agent from the settings join saved beside this file, keeps it
# running, and writes what it says, and every time it stops, to agent.log. No secret lives in here.
$ErrorActionPreference = 'Continue'
$daemon = {{DAEMON}}
$npm = {{NPM}}
$log = {{LOG}}
$ca = {{CA}}
Set-Location -LiteralPath $daemon
$env:GEEBOARD_AGENT_FILE = {{AGENTFILE}}
# Words rather than JSON: this log is read by a person, in a text editor.
$env:LOG_FORMAT = 'text'
# The panel's own certificate authority, when this PC was given one (install-node.ps1 -PanelCa): one more authority the agent
# trusts beside the public ones. Read at every start, so an upgrade that rewrites this file keeps it.
if (Test-Path -LiteralPath $ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
$env:GB_NPM = $npm
$env:GB_LOG = $log
$utf8 = New-Object System.Text.UTF8Encoding $false

function Write-Log([string]$Text) {
  # UTC, as the agent's own lines are: two clocks in one file would put the stop before the start.
  [System.IO.File]::AppendAllText($log, ((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + ' wrapper: ' + $Text + "`r`n"), $utf8)
}

$delay = 5
while ($true) {
  # Two files, 5 MB each at most: this one and agent.log.1. Checked at every start; the agent says little when nothing is wrong.
  if ((Test-Path -LiteralPath $log) -and ((Get-Item -LiteralPath $log).Length -gt 5MB)) {
    Move-Item -LiteralPath $log -Destination ($log + '.1') -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $npm)) {
    Write-Log ('npm.cmd is not at ' + $npm + ': Node.js was moved or removed since this was installed. Run deploy\windows\install-node.ps1 again.')
    Start-Sleep -Seconds 60
    continue
  }
  Write-Log 'starting the agent'
  $began = Get-Date
  & cmd.exe /d /s /c 'call "%GB_NPM%" start >> "%GB_LOG%" 2>&1'
  $code = $LASTEXITCODE
  $ran = [int]((Get-Date) - $began).TotalSeconds
  Write-Log ('the agent exited with code ' + $code + ' after ' + $ran + ' s')
  # 78: the agent saying that another agent holds its port. Starting it again changes nothing, and it would say the same every time.
  if ($code -eq 78) { Write-Log 'not starting it again: see the line above this one'; exit 78 }
  # An agent that ran for a minute was well; one that dies at once is given longer each time, up to five minutes.
  if ($ran -ge 60) { $delay = 5 } else { $delay = [Math]::Min($delay * 2, 300) }
  Write-Log ('starting it again in ' + $delay + ' s')
  Start-Sleep -Seconds $delay
}
'@
$text = $template.Replace("{{DAEMON}}", (ConvertTo-PsLiteral $daemon))
$text = $text.Replace("{{NPM}}", (ConvertTo-PsLiteral $npm))
$text = $text.Replace("{{LOG}}", (ConvertTo-PsLiteral $settings.Log))
$text = $text.Replace("{{CA}}", (ConvertTo-PsLiteral $settings.CaFile))
$text = $text.Replace("{{AGENTFILE}}", (ConvertTo-PsLiteral $settings.AgentFile))
New-Item -ItemType Directory -Force -Path $settings.Directory | Out-Null
# With a byte order mark, whichever PowerShell this runs under: the task's powershell.exe is 5.1 and reads one without as the ANSI
# code page, so C:\Users\Jörg\... would come back as C:\Users\JÃ¶rg\... and Set-Location would fail.
[System.IO.File]::WriteAllText($settings.Wrapper, $text, (New-Object System.Text.UTF8Encoding $true))

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($settings.Wrapper)`"" `
  -WorkingDirectory $daemon
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# The wrapper restarts the agent itself and never ends; these are for the wrapper. And the two battery switches: by default a task
# does not start on battery and is stopped when the PC is unplugged, which on a laptop is every time the lid is closed on the way out.
$taskSettings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $taskSettings -Principal $principal `
  -Description "Geeboard node agent: drives Docker Desktop for the panel. Reads $($settings.AgentFile); writes $($settings.Log)." | Out-Null

# 4 — start it, and find out whether what answers is the agent that was meant to.
$result = [pscustomobject]@{ Started = $false; Answered = $false; Stale = $false; SomethingElse = $false; Port = $port; Version = $null; Expected = (Get-CheckoutAgentVersion $daemon) }
if (-not $NoStart) {
  # The line the installer's verdict reads from: what the agent says after this is about this start.
  [System.IO.File]::AppendAllText($settings.Log, ((Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " installer: starting the task`r`n"), (New-Object System.Text.UTF8Encoding $false))
  Start-ScheduledTask -TaskName $TaskName
  $result = Wait-GeeboardAgent -AgentFile $settings.AgentFile -Daemon $daemon
  $result | Add-Member -NotePropertyName Started -NotePropertyValue $true -Force
}
$state = (Get-ScheduledTask -TaskName $TaskName).State
Write-Host "Task '$TaskName' registered for $env:USERNAME, at logon, restarted by its wrapper when the agent stops. State: $state"
Write-Host "  Get-Content -LiteralPath `"$($settings.Log)`" -Wait -Tail 50    the agent's log"
Write-Host "  Get-ScheduledTask '$TaskName' | Get-ScheduledTaskInfo    last run and result"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\deploy\windows\uninstall-agent.ps1    to remove it"
$result
