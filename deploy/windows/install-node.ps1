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

    1  checks Node.js, npm and Docker Desktop, and says which is missing
    2  unblocks the scripts in deploy\windows, which Windows marks as
       "downloaded from the internet" and refuses to run
    3  installs the agent's dependencies in daemon\
    4  joins the panel, which registers this machine and saves its settings
       in %LOCALAPPDATA%\Geeboard\agent.json — no token is kept in the repo
    5  registers the Geeboard Agent scheduled task and starts it
    6  asks the agent whether it is answering

  Running it again re-joins with a new token and replaces the task, which is
  also the upgrade: git pull, then this. Nothing it does deletes a server.

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
  steamcmd,java.

.PARAMETER Port
  The port the agent listens on. Default 8080.

.PARAMETER DataRoot
  Where game server files go. Default %ProgramData%\Geeboard\servers.

.PARAMETER TaskName
  The task's name in Task Scheduler. Default: Geeboard Agent.

.PARAMETER NoStart
  Register the task without starting it now.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Panel,
  [Parameter(Position = 1)][string]$Token,
  [string]$Advertise,
  [string]$Capabilities,
  [int]$Port,
  [string]$DataRoot,
  [string]$TaskName = "Geeboard Agent",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

# This file is saved as UTF-8 **with** a byte order mark, and has to stay
# that way. Windows PowerShell 5.1 — which is the PowerShell on a fresh
# Windows 11 — reads a .ps1 without one as the system's ANSI code page, so
# every non-ASCII character in a message reaches the screen as mojibake.
# An editor that "cleans up" the BOM breaks the output of every line below
# that has a dash or an arrow in it.

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

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$daemon = Join-Path $repo "daemon"
$agentFile = Join-Path $env:LOCALAPPDATA "Geeboard\agent.json"

Write-Host ""
Write-Host "Geeboard - installing a node agent" -ForegroundColor White
Write-Note $repo

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
    "Install Node.js 24 from nodejs.org, close this window, open a new one, and run this again."
}
Write-Ok "Node.js $(& node.exe -v)"

# npm.cmd, never npm: PowerShell resolves `npm` to npm.ps1, which a fresh
# execution policy refuses to run.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  Stop-Install "npm is not on PATH." `
    "It comes with Node.js, so this usually means the install has not been picked up by this window yet." `
    "Close this window, open a new PowerShell, and run the command again."
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  Stop-Install "Docker Desktop is not installed." `
    "Geeboard runs every game server as a container, so a node has to have Docker." `
    "Install Docker Desktop from docker.com, start it, and run this command again."
}
& docker.exe info *> $null
if ($LASTEXITCODE -ne 0) {
  Stop-Install "Docker Desktop is not running." `
    "Geeboard cannot start anything until Docker is running." `
    "Start Docker Desktop, wait for it to say it is running, and run this command again."
}
Write-Ok "Docker Desktop is running"

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

# Every run, not only the first: this is also the upgrade, and a `git pull`
# that brought a new dependency with it leaves an agent that will not start.
# npm is quick when there is nothing to do.
$fresh = -not (Test-Path (Join-Path $daemon "node_modules"))
if ($fresh) { Write-Info "Installing the agent's dependencies (this takes a minute)" }
else { Write-Info "Checking the agent's dependencies" }
Push-Location $daemon
try { & $npm install --no-audit --no-fund | Out-Null } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) {
  Stop-Install "The agent's dependencies did not install." `
    "npm install failed in $daemon, so there is nothing to join the panel with." `
    "Run it by hand to see why:`n`n  cd $daemon`n  npm.cmd install"
}
Write-Ok "Dependencies ready"

# ── 3 ────────────────────────────────────────────────────────────────
Write-Stage "Joining the panel"

if ($Panel -and $Token) {
  $joinArgs = @("run", "join", "--", $Panel, $Token)
  if ($Advertise) { $joinArgs += @("--advertise", $Advertise) }
  if ($Capabilities) { $joinArgs += @("--capabilities", $Capabilities) }
  if ($Port) { $joinArgs += @("--port", "$Port") }
  if ($DataRoot) { $joinArgs += @("--data-root", $DataRoot) }
  # --no-start: the scheduled task is what starts the agent, and a join
  # that also started one would leave two, one of which nothing manages.
  $joinArgs += "--no-start"

  Write-Info "Registering with $Panel"
  Push-Location $daemon
  try { & $npm $joinArgs } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) {
    Stop-Install "Registering with the panel failed." `
      "The lines above say why. A token is single-use and expires in a day, and it is minted for one node name." `
      "Create a fresh command in the panel — Nodes -> Add a node — and run that."
  }
  Write-Ok "Registered. The panel has it as waiting for approval"
} elseif (Test-Path $agentFile) {
  Write-Ok "Already joined: keeping the settings in $agentFile"
} else {
  Stop-Install "This machine has not joined a panel yet." `
    "There is no $agentFile, so there is nothing for the agent to start with." `
    "In the panel: Nodes -> Add a node -> Create the command, and paste what it gives you."
}

# ── 4 ────────────────────────────────────────────────────────────────
Write-Stage "Installing the agent"

$installAgent = Join-Path $PSScriptRoot "install-agent.ps1"
$agentParams = @{ TaskName = $TaskName }
if ($NoStart) { $agentParams["NoStart"] = $true }
& $installAgent @agentParams
Write-Ok "The Geeboard Agent task runs at every sign-in"

# ── 5 ────────────────────────────────────────────────────────────────
Write-Stage "Checking the agent"

$agentPort = 8080
if ($Port) { $agentPort = $Port }
$answered = $false
if (-not $NoStart) {
  foreach ($attempt in 1..30) {
    try {
      $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$agentPort/health" -UseBasicParsing -TimeoutSec 3
      if ($probe.StatusCode -eq 200) { $answered = $true; break }
    } catch { Start-Sleep -Seconds 1 }
  }
}
if ($answered) {
  Write-Ok "The agent is answering on port $agentPort"
} elseif ($NoStart) {
  Write-Info "Not started, as asked"
} else {
  Write-Warn "The agent did not answer on http://127.0.0.1:$agentPort/health."
  Write-Note "Get-ScheduledTask '$TaskName' | Get-ScheduledTaskInfo   shows the last run and its result."
  Write-Note "The task runs in this account only while you are signed in, which is when Docker Desktop runs."
}

# ── 6 ────────────────────────────────────────────────────────────────
Write-Stage "Checking the panel can reach it"

# The direction registering does not prove. The panel calls the agent back
# on the address the agent advertised, and a PC with Docker Desktop's
# virtual adapters, a VPN, or a router in front of it can advertise an
# address the panel cannot route to.
if ($answered) {
  $advertised = $null
  try {
    $saved = Get-Content $agentFile -Raw | ConvertFrom-Json
    $advertised = $saved.advertiseUrl
  } catch { }
  if ($advertised) {
    Write-Info "This machine told the panel to reach it at $advertised"
    Write-Note "The node's page in the panel shows Reached when the panel has managed it."
    Write-Note "If it never does: allow port $agentPort through Windows Defender Firewall for the panel's address,"
    Write-Note "or run this again with -Advertise 'http://<an address the panel can use>:$agentPort'."
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
Write-Host "  Get-ScheduledTask '$TaskName' | Get-ScheduledTaskInfo    last run and result"
Write-Host "  .\deploy\windows\uninstall-agent.ps1                     remove it"
Write-Host ""
