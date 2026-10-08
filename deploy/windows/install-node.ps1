<#
.SYNOPSIS
  Makes this Windows PC a Geeboard node: joins it to a panel and installs the
  agent as a task that starts at every sign-in.

.DESCRIPTION
  The one command a Windows node needs. The panel writes it for you —
  Nodes -> Add a node -> Create the command — and it looks like this:

    powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel 'https://panel.example.com' -Token 'gbn_...'

  `-ExecutionPolicy Bypass` is in that line because a fresh Windows install
  refuses to run any .ps1 at all, which is the first wall a beginner meets
  and has nothing to do with Geeboard. It applies to that one process.

  What it does, in order:

    1  checks Node.js (22 or newer), npm and Docker Desktop, and that Docker
       is running Linux containers, and says which is missing
    2  makes the data root and sets who may read it, unblocks the scripts in
       deploy\windows (which Windows marks as "downloaded from the internet"
       and refuses to run), and installs the agent's dependencies in daemon\
    3  joins the panel, which registers this machine and saves its settings
       in %LOCALAPPDATA%\Geeboard\agent.json — no token is kept in the repo
    4  says what Windows Defender Firewall has to allow and makes the rule
       when this shell may (or prints the command for one that may), then
       registers the Geeboard Agent scheduled task and starts it
    5  asks the agent whether it is answering, and which version it is
    6  listens to what it says, and tells you if the panel cannot call back

  Running it again re-joins with a new token and replaces the task, which is
  also the upgrade: git pull, then this. **A re-join keeps what the last one
  saved** — the data root, the port, the capabilities, the terminal's consent
  and an address given by hand — unless this run names it again, and it
  refuses a token for a different node than this PC is joined as (-Replace
  says it is meant). Nothing it does deletes a server.

  Docker Desktop runs in the signed-in user's session, so the agent does
  too: the task is this account's, it starts at logon, and it restarts if
  the agent stops. A machine that must host servers with nobody signed in
  is a Linux machine.

.PARAMETER Panel
  The panel's address, as the panel's own command gives it.

.PARAMETER Token
  The single-use registration token from Nodes -> Add a node.

.PARAMETER Advertise
  Where the panel can reach this machine, when that is not the address this
  machine sees itself at — behind NAT, or on a PC with several adapters.

.PARAMETER Capabilities
  What this machine is willing to run beyond what can be measured:
  steamcmd,java. A re-join keeps the ones the last join had unless this is
  given; -Capabilities none takes them all back.

.PARAMETER PanelCa
  The panel's certificate authority, for a panel reached at an address rather
  than a name: its certificate is signed by an authority only it has, and this
  PC refuses it until it knows that authority. The panel's command carries it
  as -PanelCa 'sha256:<fingerprint>': the PC asks the panel for the authority
  over a connection it does not trust, and keeps it only if its fingerprint is
  the one in the command. Or the path of the authority's file. Kept beside
  agent.json (%LOCALAPPDATA%\Geeboard\panel-ca.crt) and given to the agent at
  every start.

.PARAMETER Port
  The port the agent listens on. Default 8080; a re-join keeps the one it had.

.PARAMETER DataRoot
  Where game server files go: worlds, backups, uploads. Default
  %ProgramData%\Geeboard\servers; a re-join keeps the one it had. A full path
  with a drive letter, on a disk of this PC, in a folder of its own. The
  installer makes it and sets who may read it: this account, SYSTEM and
  Administrators, and nobody else (a folder made under ProgramData lets every
  local account read what is in it).

.PARAMETER Replace
  Become the node this token is for, although this PC is joined as another.
  Without it a token for a different node is refused, with the token still
  good: the node this PC is now would be left with no agent.

.PARAMETER TaskName
  The task's name in Task Scheduler. Default: Geeboard Agent.

.PARAMETER NoStart
  Register the task without starting it now.

.PARAMETER Terminal
  Allow the panel to open a PowerShell on this PC, as this account. Off
  unless you say so; decided here, on the machine, never from the panel. On
  a PC that has already joined, this alone switches it on. See
  docs/nodes.md, "Node terminal".

.PARAMETER NoTerminal
  Take that permission back.

.PARAMETER CommunityGames
  Let games that somebody wrote, and an owner of the panel approved, run on
  this PC. Their images run as root in their containers and reach what this
  PC's network reaches. Decided here, on the machine, never from the panel,
  and declared when the PC joins, so it goes on the command that joins.
  See docs/community-games.md first.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Panel,
  [Parameter(Position = 1)][string]$Token,
  [string]$Advertise,
  [string]$Capabilities,
  [string]$PanelCa,
  [int]$Port,
  [string]$DataRoot,
  [string]$TaskName = "Geeboard Agent",
  [switch]$NoStart,
  [switch]$Terminal,
  [switch]$NoTerminal,
  [switch]$Replace,
  [switch]$CommunityGames
)

$ErrorActionPreference = "Stop"

# This file is saved as UTF-8 **with** a byte order mark, and has to stay
# that way. Windows PowerShell 5.1 — which is the PowerShell on a fresh
# Windows 11 — reads a .ps1 without one as the system's ANSI code page, so
# every non-ASCII character in a message reaches the screen as mojibake.
# An editor that "cleans up" the BOM breaks the output of every line below
# that has a dash or an arrow in it.

# One pair of quotes off a value, ASCII or typographic. Command Prompt keeps the single quotes this command was written with
# for PowerShell, and a command copied from a document or a chat arrives with curly ones; neither is part of the value.
function Remove-Quotes([string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return $Value }
  $text = $Value.Trim()
  $pairs = @(
    @([char]0x27, [char]0x27), @([char]0x22, [char]0x22), @([char]0x2018, [char]0x2019), @([char]0x201C, [char]0x201D)
  )
  foreach ($pair in $pairs) {
    if ($text.Length -ge 2 -and $text[0] -eq $pair[0] -and $text[$text.Length - 1] -eq $pair[1]) {
      return $text.Substring(1, $text.Length - 2).Trim()
    }
  }
  return $text
}
$pastedWithQuotes = ($Panel -and (Remove-Quotes $Panel) -ne $Panel.Trim()) -or ($Token -and (Remove-Quotes $Token) -ne $Token.Trim())
$Panel = Remove-Quotes $Panel
$Token = Remove-Quotes $Token
$Advertise = Remove-Quotes $Advertise
$Capabilities = Remove-Quotes $Capabilities
$PanelCa = Remove-Quotes $PanelCa
$DataRoot = Remove-Quotes $DataRoot

# ── Output ───────────────────────────────────────────────────────────
# The same stages the Linux installer prints, for the same reason:
# somebody installing a game server panel should not have to read npm's
# output to find out whether it worked.

$script:StageNumber = 0
$script:StageCount = 6

function Write-Stage([string]$Text) {
  $script:StageNumber++
  Write-Host ""
  Write-Host "[$($script:StageNumber)/$($script:StageCount)] $Text" -ForegroundColor White
}
function Write-Ok([string]$Text) { Write-Host "[ok] $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "[..] $Text" -ForegroundColor DarkGray }
function Write-Note([string]$Text) { Write-Host "     $Text" -ForegroundColor DarkGray }
function Write-Warn([string]$Text) { Write-Host "[!] $Text" -ForegroundColor Yellow }

# What happened, why it stops here, and the one thing to do next.
function Stop-Install([string]$What, [string]$Why, [string]$Next) {
  Write-Host ""
  Write-Host "[!] $What" -ForegroundColor Red
  if ($Why) { Write-Host ""; Write-Host $Why }
  if ($Next) { Write-Host ""; Write-Host $Next }
  Write-Host ""
  exit 1
}

. (Join-Path $PSScriptRoot "lib.ps1")

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$daemon = Join-Path $repo "daemon"
# GEEBOARD_AGENT_FILE is the agent's own way of being told where its settings are (daemon/src/agent-file.ts), and this
# installer asks the same question: a second node on one PC, or a proof run beside a real one, has a file of its own.
$settings = Get-AgentSettings
$agentFile = $settings.AgentFile
$caFile = $settings.CaFile

Write-Host ""
Write-Host "Geeboard - installing a node agent" -ForegroundColor White
Write-Note $repo
if ($pastedWithQuotes) {
  Write-Note "The quotes around the address and the token came through, which is what Command Prompt does with a command written for PowerShell."
  Write-Note "They are taken off and it goes on; Windows PowerShell (Start menu) is where this command is meant to be pasted."
}

# ── 1 ────────────────────────────────────────────────────────────────
Write-Stage "Checking the system"

if (-not (Test-Path $daemon)) {
  Stop-Install "This is not a Geeboard checkout." `
    "$daemon is not here, and it is what the agent runs from." `
    "Run this from the folder git clone made:`n`n  cd Geeboard`n  powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel '<panel>' -Token '<token>'"
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  Stop-Install "Node.js is not installed." `
    "The agent is a Node.js program, and on Windows it runs from this checkout rather than in a container." `
    "Install Node.js $NodeFloor or newer from nodejs.org (the current LTS is what is tested), close this window, open a new one, and run this again."
}
Write-Ok "Node.js $(& node.exe -v)"
$nodeMajor = Get-NodeMajor
if ($nodeMajor -and $nodeMajor -lt $NodeFloor) {
  Stop-Install "Node.js $NodeFloor or newer is needed, and this is $(& node.exe -v)." `
    "The agent uses what older versions do not have, and its terminal library has no binary for them." `
    "Install the current LTS from nodejs.org, close this window, open a new one, and run this again."
}

# npm.cmd, never npm: PowerShell resolves `npm` to npm.ps1, which a fresh
# execution policy refuses to run.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  Stop-Install "npm is not on PATH." `
    "It comes with Node.js, so this usually means the install has not been picked up by this window yet." `
    "Close this window, open a new PowerShell, and run the command again."
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  Stop-Install "Docker Desktop is not installed (or this window has not seen it yet)." `
    "Geeboard runs every game server as a container, so a node has to have Docker. Docker Desktop's installer changes the PATH, which a window that was open before it does not see." `
    "Install Docker Desktop from docker.com, start it, close this window, open a new one, and run this command again."
}
# Through cmd.exe: `& docker.exe info *> $null` under $ErrorActionPreference = "Stop" throws a raw NativeCommandError on Windows
# PowerShell 5.1 the moment docker writes a word to stderr, which is exactly what it does when it is stopped.
if (-not (Test-DockerAnswers)) {
  Stop-Install "Docker Desktop is not running." `
    "Geeboard cannot start anything until Docker is running." `
    "Start Docker Desktop, wait for it to say it is running, and run this command again."
}
Write-Ok "Docker Desktop is running"
# Every game in the catalog is a Linux image. Docker Desktop in Windows-containers mode answers, joins, and reports "windows", and then
# every game is "incompatible" with a node that looks fine: said here, once, instead of there, many times.
$dockerOs = Get-DockerOs
if ($dockerOs -eq "windows") {
  Stop-Install "Docker Desktop is running Windows containers." `
    "Geeboard's game servers are Linux containers, so this PC would register and then refuse every game." `
    "Switch it: right-click the Docker icon in the tray, choose Switch to Linux containers, wait for it to say it is running, and run this command again."
} elseif ($dockerOs) {
  Write-Ok "Docker is running $dockerOs containers"
}

# ── 2 ────────────────────────────────────────────────────────────────
Write-Stage "Preparing this machine"

# Windows' own version of the execute bit. A repository downloaded as a zip
# arrives with every file carrying a "came from the internet" mark, and a
# marked .ps1 is refused whatever the execution policy says.
$blocked = 0
Get-ChildItem -Path (Join-Path $repo "deploy") -Recurse -Filter *.ps1 -ErrorAction SilentlyContinue | ForEach-Object {
  if (Get-Item -Path $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue) {
    Unblock-File -Path $_.FullName
    $blocked++
  }
}
if ($blocked -gt 0) { Write-Ok "Unblocked $blocked script(s) Windows had marked as downloaded" }
else { Write-Ok "Scripts are not blocked" }

# The data root: where every world, backup and upload goes. The one this run names, else the one the last join saved, else the agent's
# default; made here, and made this account's own. A folder under C:\ProgramData inherits "every local user may read it", which would
# put every world, the RCON password in server.properties and every backup in reach of any other account on this PC.
$previousJoin = Read-AgentFile $agentFile
$dataRootInUse = if ($DataRoot) { $DataRoot }
  elseif ($env:GEEBOARD_DATA_ROOT) { $env:GEEBOARD_DATA_ROOT }
  elseif ($previousJoin -and $previousJoin.dataRoot) { [string]$previousJoin.dataRoot }
  else { Join-Path $env:ProgramData "Geeboard\servers" }
$dataRootProblem = Get-DataRootProblem $dataRootInUse $repo
if ($dataRootProblem) {
  Stop-Install "The data root will not do: $dataRootInUse" $dataRootProblem "Name another one with -DataRoot 'D:\GameServers' and run this again."
}
$aclResult = Set-DataRootAcl $dataRootInUse
if ($aclResult -eq $true) {
  Write-Ok "Data root $dataRootInUse is this account's own (SYSTEM and Administrators too, and nobody else)"
} else {
  Write-Warn "Could not set who may read ${dataRootInUse}: $aclResult"
  Write-Note "Until that is put right, other accounts on this PC may be able to read the worlds in it. Look at: icacls `"$dataRootInUse`""
}

# Every run, not only the first: this is also the upgrade, and a `git pull`
# that brought a new dependency with it leaves an agent that will not start.
# npm is quick when there is nothing to do.
$fresh = -not (Test-Path (Join-Path $daemon "node_modules"))
if ($fresh) { Write-Info "Installing the agent's dependencies (this takes a minute)" }
else { Write-Info "Checking the agent's dependencies" }
$npmLines = @()
$before = $ErrorActionPreference
$ErrorActionPreference = "Continue"
Push-Location $daemon
try { $npmLines = @(& $npm install --no-audit --no-fund 2>&1 | ForEach-Object { ConvertTo-OutputLine $_ }) } finally { Pop-Location; $ErrorActionPreference = $before }
if ($LASTEXITCODE -ne 0) {
  $npmLines | Select-Object -Last 15 | ForEach-Object { Write-Note $_ }
  Stop-Install "The agent's dependencies did not install." `
    "npm install failed in $daemon (its last lines are above), so there is nothing to join the panel with." `
    "Run it by hand to see all of it:`n`n  cd $daemon`n  npm.cmd install"
}
Write-Ok "Dependencies ready"

# ── 3 ────────────────────────────────────────────────────────────────
Write-Stage "Joining the panel"

# The panel's own certificate authority, for a panel reached at an address: its certificate is signed by an authority only it has,
# and a Node.js program trusts the public ones. -PanelCa 'sha256:...' is what the panel's command carries; the authority is asked
# for and kept only if it is the one named. Before the join, which is the first thing to meet that certificate, and handed on to it
# and to the agent through NODE_EXTRA_CA_CERTS: one more authority beside the public ones, never instead of them.
if ($PanelCa) {
  if (-not $Panel) {
    Stop-Install "-PanelCa goes with the panel's address and the token." `
      "It says which authority to trust for that panel, and there is no panel in this command." `
      "Use the whole command from Nodes -> Add a node."
  }
  Write-Info "Setting up the panel's certificate authority"
  Push-Location $daemon
  try { & $npm @("run", "--silent", "pin-ca", "--", $Panel, $PanelCa, $caFile) } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) {
    Stop-Install "The panel's certificate authority could not be set up." `
      "The lines above say why. Nothing else was changed, and the registration token was not spent." `
      "Make the command again in the panel - Nodes -> Add a node - and run that."
  }
  Write-Ok "The panel's authority is kept in $caFile"
}
if (Test-Path $caFile) {
  # What a previous run was given stays, so an upgrade with no arguments does not stop trusting the panel.
  $env:NODE_EXTRA_CA_CERTS = $caFile
}

if ($Panel -and $Token) {
  # --silent: without it npm prints the command it is about to run, which has the registration token in it, on the screen.
  $joinArgs = @("run", "--silent", "join", "--", $Panel, $Token)
  if ($Advertise) { $joinArgs += @("--advertise", $Advertise) }
  # -CommunityGames is one more capability, declared with the others.
  $declared = @()
  if ($Capabilities) { $declared += ($Capabilities -split ",") }
  if ($CommunityGames -and ($declared -notcontains "community-games")) { $declared += "community-games" }
  if ($declared.Count -gt 0) { $joinArgs += @("--capabilities", ($declared -join ",")) }
  if ($Port) { $joinArgs += @("--port", "$Port") }
  if ($DataRoot) { $joinArgs += @("--data-root", $DataRoot) }
  if ($Terminal) { $joinArgs += "--terminal" }
  if ($NoTerminal) { $joinArgs += "--no-terminal" }
  if ($Replace) { $joinArgs += "--replace" }
  # --no-start: the scheduled task is what starts the agent, and a join
  # that also started one would leave two, one of which nothing manages.
  $joinArgs += "--no-start"

  Write-Info "Registering with $Panel"
  # Read as well as shown: what to do next depends on what it said, and a token is only spent by some of the ways it can fail.
  $before = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  Push-Location $daemon
  try {
    $joinLines = @(& $npm $joinArgs 2>&1 | ForEach-Object { ConvertTo-OutputLine $_ })
    $joinExit = $LASTEXITCODE
  } finally { Pop-Location; $ErrorActionPreference = $before }
  $joinLines | ForEach-Object { if ($_) { Write-Host $_ } }
  $joinText = $joinLines -join "`n"
  if ($joinExit -ne 0) {
    if ($joinText -match "joined as") {
      $why = "This PC is joined as one node and that token is for another. Nothing was changed, and the token was not used."
      $next = "Run the command that is for this node, or add -Replace to this one to make this PC the other node (the one it is now keeps no agent until it is joined again)."
    } elseif ($joinText -match "refused this|token") {
      $why = "The panel did not take the token. A token works once, for one node name, for a day."
      $next = "Create a fresh command in the panel - Nodes -> Add a node - and run that."
    } elseif ($joinText -match "certificate|authority") {
      $why = "The lines above say why: this PC does not trust the panel's certificate. The token was not used."
      $next = "Make the command again in the panel - Nodes -> Add a node - which carries what a panel at an address needs, and run that."
    } elseif ($joinText -match "Docker is not answering") {
      $why = "Docker did not answer. The token was not used."
      $next = "Start Docker Desktop, wait for it to say it is running, and run the same command again."
    } elseif ($joinText -match "cannot reach|did not answer|nothing is listening|does not resolve|no route") {
      $why = "This PC cannot reach the panel at $Panel. The token was not used."
      $next = "Check the address, and that the panel is up and reachable from this PC. The same command works once it is."
    } else {
      $why = "The lines above say why."
      $next = "Run the command again once that is dealt with. If they say the token was refused, make a fresh one: Nodes -> Add a node."
    }
    Stop-Install "Registering with the panel failed." $why $next
  }
  if ($joinText -match "already approved") { Write-Ok "Registered. The panel already had this node approved" }
  else { Write-Ok "Registered. The panel has it as waiting for approval" }
} elseif (Test-Path $agentFile) {
  Write-Ok "Already joined: keeping the settings in $agentFile"
  if ($CommunityGames) {
    Stop-Install "-CommunityGames is declared when a PC joins." `
      "This run has no panel address and token, so there is nothing to declare it with." `
      "On a PC that has already joined, add community-games to the capabilities list in $agentFile, then run this installer again with no options."
  }
  # The terminal's consent is a key in that file; a re-run may flip it
  # without a new token, which is how a PC that joined before this
  # existed allows a shell — or takes it back.
  if ($Terminal -or $NoTerminal) {
    $wanted = if ($Terminal) { "on" } else { "off" }
    Push-Location $daemon
    try { & $npm @("run", "--silent", "terminal", "--", $wanted) | Out-Null } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) {
      Stop-Install "The node terminal could not be switched $wanted." `
        "npm run terminal -- $wanted failed in $daemon; the lines above say why." `
        "Run it by hand:`n`n  cd $daemon`n  npm.cmd run terminal -- $wanted"
    }
    Write-Ok "Node terminal switched $wanted; the task restarts the agent below"
  }
} else {
  Stop-Install "This machine has not joined a panel yet." `
    "There is no $agentFile, so there is nothing for the agent to start with." `
    "In the panel: Nodes -> Add a node -> Create the command, and paste what it gives you."
}

# ── 4 ────────────────────────────────────────────────────────────────
Write-Stage "Installing the agent"

# Windows Defender Firewall. The agent listens hidden, so Windows would ask "Allow Node.js JavaScript Runtime ...?" from a process with no
# window, tick Private only, and make a rule for the program on every port. What is made here is for this one port and for the panel's
# own addresses. Every check this installer makes runs on loopback, which no firewall blocks: this is the part that was never checked.
$joined = Read-AgentFile $agentFile
$firewallPort = Get-AgentPort $joined
$panelAt = if ($joined -and $joined.panelUrl) { [string]$joined.panelUrl } else { $Panel }
$firewall = Set-AgentFirewall -Port $firewallPort -PanelUrl $panelAt
switch ($firewall) {
  "here"    { Write-Ok "The panel is on this PC: Windows Defender Firewall has nothing to let in" }
  "exists"  { Write-Ok "Windows Defender Firewall already has the rule for port $firewallPort ($(Get-FirewallRuleName $firewallPort))" }
  "created" {
    Write-Ok "Windows Defender Firewall now lets the panel's address reach port $firewallPort, and no other"
    Write-Note "The rule is called $(Get-FirewallRuleName $firewallPort); uninstall-agent.ps1 removes it."
  }
  "created-subnet" {
    Write-Warn "The panel's name did not resolve from this PC, so Windows Defender Firewall now lets every device on this PC's local network reach port $firewallPort."
    Write-Note "That is wider than the panel's address. Once the name resolves, narrow it, in PowerShell run as administrator:"
    Write-Note "  Set-NetFirewallRule -DisplayName '$(Get-FirewallRuleName $firewallPort)' -RemoteAddress <the panel's address>"
    Write-Note "The rule is called $(Get-FirewallRuleName $firewallPort); uninstall-agent.ps1 removes it."
  }
  default {
    $addresses = Get-PanelAddresses $panelAt
    Write-Warn "Windows Defender Firewall will not let the panel in until a rule says so, and this window is not an administrator's."
    Write-Note "In PowerShell run as administrator (right-click, Run as administrator), once:"
    Write-Note "  $(Get-FirewallCommand $firewallPort $addresses)"
    Write-Note "Without it Windows asks the first time the agent listens, in a window you will not see, and answers for Private networks only."
  }
}
if ($firewall -ne "here") {
  foreach ($network in (Get-PublicNetworks)) {
    $says = if ($firewall -in @("created", "exists")) { "the rule above applies to every network" } else { "a rule has to apply to Public networks too" }
    Write-Note "The network '$network' is classified Public: Windows blocks inbound there unless a rule says otherwise ($says)."
  }
}

$installAgent = Join-Path $PSScriptRoot "install-agent.ps1"
$agentParams = @{ TaskName = $TaskName; Quiet = $true }
if ($NoStart) { $agentParams["NoStart"] = $true }
try {
  # Its own lines are for a person; what it returns is the answer to "did the agent come up".
  $started = & $installAgent @agentParams | Where-Object { $_ -is [pscustomobject] } | Select-Object -Last 1
} catch {
  $joined = if ($Panel -and $Token) { "`n`nThis PC has joined the panel already, and the registration token is spent." } else { "" }
  Stop-Install "The agent's task could not be set up." `
    "$($_.Exception.Message)$joined" `
    "Put that right, then run this again with no arguments: it keeps the settings and finishes the installation.`n`n  powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1"
}
Write-Ok "The $TaskName task runs at every sign-in"

# ── 5 ────────────────────────────────────────────────────────────────
Write-Stage "Checking the agent"

$agentPort = $started.Port
$answered = $false
if ($NoStart) {
  Write-Info "Not started, as asked"
} elseif ($started.Answered -and -not $started.Stale) {
  $answered = $true
  Write-Ok "The agent is answering on port $agentPort, and it is version $($started.Version), this checkout's"
  # The terminal library is an optional download: a PC that could not get it still has a working node.
  $terminalState = if ($started.Terminal) { [string]$started.Terminal.state } else { "" }
  switch ($terminalState) {
    "on"          { Write-Ok "Node terminal: on" }
    "unavailable" { Write-Info "Node terminal: not available here. $($started.Terminal.reason)"; Write-Note "Everything else works." }
    "off"         { Write-Info "Node terminal: off. Run this with -Terminal to allow shells from the panel." }
  }
} elseif ($started.Stale) {
  Write-Warn "What answers on port $agentPort is agent $($started.Version), and this checkout's is $($started.Expected)."
  Write-Note "An older agent is still running. Stop it (Task Manager, node.exe), then run this again. What the new one said:"
  Write-LogTail $settings.Log
} elseif ($started.SomethingElse) {
  Write-Warn "Something answers on port $agentPort, and it is not this node's agent: it does not know this node's token."
  Write-Note "An agent from an earlier join is probably still running on it. Stop it (Task Manager, node.exe), then run this again."
  Write-Note "What this node's own agent said:"
  Write-LogTail $settings.Log
} else {
  Write-Warn "The agent did not answer on port $agentPort within 40 seconds. What it said:"
  Write-LogTail $settings.Log
  Write-Note "Get-ScheduledTask '$TaskName' | Get-ScheduledTaskInfo   shows the last run and its result."
  Write-Note "The task runs in this account only while you are signed in, which is when Docker Desktop runs."
}

# ── 6 ────────────────────────────────────────────────────────────────
Write-Stage "Checking the panel can reach it"

# The direction registering does not prove. The panel calls the agent back on the address the agent advertised, and a PC with
# Docker Desktop's virtual adapters, a VPN, or a router in front of it can advertise an address the panel cannot route to. The agent
# says so in its log when the panel's first heartbeat finds it cannot call back, and this reads that, as install.sh reads the journal.
if ($answered) {
  $advertised = $null
  $saved = Read-AgentFile $agentFile
  if ($saved) { $advertised = $saved.advertiseUrl }
  Write-Info "Listening to the agent for a few seconds"
  $verdict = Get-AgentVerdict -Log $settings.Log -Since "installer: starting the task"
  switch ($verdict.Word) {
    "unreachable" {
      Write-Warn "The panel cannot call this PC back, so it will take no servers."
      Write-Note $verdict.Line
      if ($advertised) { Write-Note "This PC told the panel to reach it at $advertised." }
      Write-Note "Allow port $agentPort through Windows Defender Firewall for the panel's address, or run this again with"
      Write-Note "-Advertise 'http://<an address the panel can use>:$agentPort' (with the token of a fresh command)."
    }
    "no-panel" {
      Write-Warn "The agent is not getting through to the panel:"
      Write-Note $verdict.Line
    }
    "port" {
      Write-Warn "The agent could not take its port:"
      Write-Note $verdict.Line
    }
    default {
      Write-Ok "The panel has not complained that it cannot reach this PC"
      if ($advertised) { Write-Note "This PC told the panel to reach it at $advertised; the node's page shows Reached when the panel has managed it." }
    }
  }
} else {
  Write-Info "Skipped: the agent is not answering here yet"
}

Write-Host ""
Write-Host "This PC is a Geeboard node." -ForegroundColor White
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Approve it in the panel - Nodes, or the dialog that wrote this command."
Write-Host "     Nothing is placed on a node until somebody does."
Write-Host "  2. Leave this account signed in. Docker Desktop runs in your session, so"
Write-Host "     the agent does too."
Write-Host ""
Write-Host "What takes this PC node down, for this PC (docs/nodes.md#what-takes-a-pc-node-down):"
foreach ($risk in (Get-PcNodeRisks)) { Write-Host "  - $risk" }
Write-Host ""
Write-Host "  powershell -ExecutionPolicy Bypass -File .\deploy\windows\doctor.ps1    looks at all of it and changes nothing"
Write-Host "  Get-Content -LiteralPath `"$($settings.Log)`" -Wait -Tail 50    watch the agent's log"
Write-Host "  Get-ScheduledTask '$TaskName' | Get-ScheduledTaskInfo    last run and result"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\deploy\windows\uninstall-agent.ps1    remove it"
Write-Host ""
