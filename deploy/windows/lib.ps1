# Shared by install-node.ps1, install-agent.ps1 and uninstall-agent.ps1: where the agent keeps its things, who is
# listening on its port, how to stop it without touching another agent, and how to tell whether the one that
# started is the one that was meant to. Dot-sourced, never run on its own.
#
# This file is saved as UTF-8 with a byte order mark, and has to stay that way: Windows PowerShell 5.1 reads a
# .ps1 without one as the system's ANSI code page (scripts/check-repo.mjs holds that).
#
# 5.1 traps this file is written around, each one met on a real machine:
#   - `& docker.exe info *> $null` under $ErrorActionPreference = "Stop" throws a NativeCommandError the moment
#     docker writes a word to stderr, which is exactly what it does when Docker is stopped. Native programs
#     whose failure is an answer here go through cmd.exe, which does the redirecting.
#   - `2>&1` on a native program wraps every stderr line in an ErrorRecord, for the same reason.
#   - `Set-Content -Encoding utf8` writes a byte order mark on 5.1 and none on 7; the wrapper is written with
#     .NET so that it has one under both.

# One line of what a native program wrote, as text. Captured with 2>&1 on 5.1, a line on stderr is an ErrorRecord, and an empty one
# prints as its type name ("System.Management.Automation.RemoteException") if it is simply put in a string.
function ConvertTo-OutputLine($Item) {
  if ($Item -is [System.Management.Automation.ErrorRecord]) { return [string]$Item.Exception.Message }
  return [string]$Item
}

# A string as a PowerShell single-quoted literal. An apostrophe is legal in a Windows account name
# (C:\Users\O'Brien), and a bare one ends the string early: the wrapper then fails to parse, the agent never
# starts, and there is no window and no log to say so.
function ConvertTo-PsLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

# Where this node keeps its things. GEEBOARD_AGENT_FILE is the agent's own way of being told where its
# settings are (daemon/src/agent-file.ts); the wrapper, the panel's authority and the log live beside that
# file, so a second node on one PC does not share them.
function Get-AgentSettings {
  $agentFile = if ($env:GEEBOARD_AGENT_FILE) { $env:GEEBOARD_AGENT_FILE } else { Join-Path $env:LOCALAPPDATA "Geeboard\agent.json" }
  $directory = Split-Path $agentFile -Parent
  return [pscustomobject]@{
    AgentFile = $agentFile
    Directory = $directory
    Wrapper   = Join-Path $directory "run-agent.ps1"
    Log       = Join-Path $directory "agent.log"
    CaFile    = Join-Path $directory "panel-ca.crt"
  }
}

# agent.json, or $null when there is none or it cannot be read. Never throws: the callers have a sentence for each case.
function Read-AgentFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}

# The port the agent listens on: the one in agent.json, which is where join wrote it, and 8080 when there is nothing there.
function Get-AgentPort($Agent) {
  if ($Agent -and $Agent.port) { return [int]$Agent.port }
  return 8080
}

# The Node.js version this installer asks for. The docs have said 22 and the installer 24, the agent's package.json says 22 or newer,
# and 24 is what CI tests: one number, here, is the floor, and what is installed is printed beside it.
$script:NodeFloor = 22

# The major version of the Node.js on PATH, or $null when there is none.
function Get-NodeMajor {
  $text = & cmd.exe /d /c "node.exe -v 2>nul"
  if ($LASTEXITCODE -ne 0 -or -not $text) { return $null }
  if (([string]($text | Select-Object -First 1)) -match "^v(\d+)\.") { return [int]$Matches[1] }
  return $null
}

# Whether this shell is elevated: some things (a firewall rule) need it, and are printed for an elevated shell when it is not.
function Test-Elevated {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Whether Docker answers. Through cmd.exe: see the first trap above.
function Test-DockerAnswers {
  & cmd.exe /d /c "docker.exe info >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

# The Geeboard game server containers on this engine whose files are in a data root. A PC can run two nodes on the one Docker, and the
# containers of the other are not a reason to refuse to delete this one's data: so it is the folders they mount that decide. The engine
# says a bind mount's source as the Windows path or as a path inside its VM (/run/desktop/mnt/host/d/GameServers/...), so both are brought
# to the same shape (lower case, forward slashes, no colon) and the root is looked for in each.
function Get-ContainersUsingDataRoot([string]$DataRoot) {
  $shape = { param($p) ($p.ToLowerInvariant().Replace("\", "/").Replace(":", "")).TrimEnd("/") }
  $marker = & $shape $DataRoot
  $using = @()
  foreach ($id in @(& cmd.exe /d /c "docker.exe ps -a -q --filter label=gg.geeboard.server 2>nul")) {
    if (-not $id) { continue }
    $sources = (& cmd.exe /d /c "docker.exe inspect -f `"{{range .Mounts}}{{.Source}}|{{end}}`" $id 2>nul") -join ""
    foreach ($source in ($sources -split "\|")) {
      if ($source -and (& $shape $source).Contains($marker)) { $using += $id; break }
    }
  }
  return $using
}

# Which kind of containers Docker runs: "linux" or "windows". Game server images are Linux ones.
function Get-DockerOs {
  $text = & cmd.exe /d /c "docker.exe version --format {{.Server.Os}} 2>nul"
  if ($LASTEXITCODE -ne 0 -or -not $text) { return $null }
  return ([string]($text | Select-Object -First 1)).Trim().ToLowerInvariant()
}

# Why a data root will not do, or $null when it will. It is where every world, every backup and every uploaded file goes, and the
# installer is about to take ownership of it (Set-DataRootAcl), so it is a folder of its own on a disk of this PC: absolute, not a
# network path, not a drive's root, not inside the checkout (where a `git clean` would delete the worlds).
function Get-DataRootProblem([string]$DataRoot, [string]$Checkout) {
  if (-not [System.IO.Path]::IsPathRooted($DataRoot) -or $DataRoot -notmatch "^[A-Za-z]:[\\/]") {
    return "It has to be a full path with a drive letter, like D:\GameServers. A relative one lands wherever this was started from; a network path (\\server\share) is slow and not what Docker Desktop shares with a container."
  }
  $full = [System.IO.Path]::GetFullPath($DataRoot).TrimEnd("\")
  if ($full.Length -le 2) { return "It is a whole drive. Give it a folder of its own, like $full\GameServers: this is about to set who may read what is in it." }
  if (-not (Split-Path $full -Parent)) { return "It is a whole drive. Give it a folder of its own, like $full\GameServers." }
  $drive = New-Object System.IO.DriveInfo($full.Substring(0, 1))
  if (-not $drive.IsReady -or $drive.DriveType -ne [System.IO.DriveType]::Fixed) {
    return "$($full.Substring(0, 2)) is not a fixed disk of this PC that is ready (it is $($drive.DriveType)), and a world on it is gone when the disk is."
  }
  $inside = $Checkout.TrimEnd("\") + "\"
  if (($full + "\").StartsWith($inside, [System.StringComparison]::OrdinalIgnoreCase)) {
    return "It is inside the Geeboard checkout, where a `git clean` would delete every world. Pick a folder outside it."
  }
  return $null
}

# Creates the data root and makes it the account's own: SYSTEM, Administrators and this user, and nobody else. A folder made under
# C:\ProgramData inherits "Users: read, and create files and folders", so on a PC with a second account that user could read every
# world, the RCON password in server.properties and every backup, and put a plugin into a server's folder for the game to load.
# Docker Desktop runs as this user and keeps its access. SIDs and not names, so that it is the same on a Windows in any language.
# Returns $true when it was set; a problem is returned as text.
function Set-DataRootAcl([string]$DataRoot) {
  try { New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null } catch { return "the folder could not be made: $($_.Exception.Message)" }
  $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $result = & cmd.exe /d /c "icacls.exe `"$DataRoot`" /inheritance:r /grant:r *$($me):(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F 2>&1"
  if ($LASTEXITCODE -ne 0) { return "icacls said: " + (($result | Select-Object -Last 2) -join " ") }
  return $true
}

# Whether the accounts of this PC at large (Users, Authenticated Users, Everyone) have any access to a folder. By SID, so that it is the
# same on a Windows in any language: "Users" is "Utenti" on an Italian one.
function Test-OthersMayRead([string]$Path) {
  try {
    foreach ($rule in (Get-Acl -LiteralPath $Path).Access) {
      if ($rule.AccessControlType -ne "Allow") { continue }
      $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
      if (@("S-1-5-32-545", "S-1-5-11", "S-1-1-0") -contains $sid) { return $true }
    }
  } catch { }
  return $false
}

# Who may use a folder, as icacls prints it, reduced to the names: for the closing words and for doctor.ps1.
function Get-AclSummary([string]$Path) {
  try {
    $acl = Get-Acl -LiteralPath $Path
    return (($acl.Access | ForEach-Object { "$($_.IdentityReference) ($($_.FileSystemRights))" } | Select-Object -Unique) -join "; ")
  } catch { return $null }
}

# Who is listening on a port, and what they were started with: $null when nobody is.
function Get-PortOwner([int]$Port) {
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    Pid         = [int]$connection.OwningProcess
    Name        = if ($process) { [string]$process.Name } else { "a process" }
    CommandLine = if ($process -and $process.CommandLine) { [string]$process.CommandLine } else { "" }
  }
}

# A process and everything it started. taskkill through cmd.exe: it writes to stderr when the process is already gone.
function Stop-ProcessTree([int]$ProcessId) {
  & cmd.exe /d /c "taskkill.exe /T /F /PID $ProcessId >nul 2>&1" | Out-Null
}

# Stops this node's agent, and only this node's.
#
# The scheduled task's stop ends the PowerShell that was running the wrapper and not always the node underneath it, and an agent
# started by hand with `npm.cmd start` is not the task's at all: left alive, either one holds the agent's port, the new agent dies of
# EADDRINUSE, and the old one, which has the previous token, goes on answering as if all were well. So, in order: the task (so that
# it cannot start another meanwhile), the wrapper whose command line names this node's own wrapper file, and whatever is listening on
# the port this node's agent.json names, when that is a Node.js program running an agent (an index.ts). A second node on this PC has
# another wrapper and another port, and is not touched. Waits for the port to be free. Returns what it stopped, for the caller to say.
function Stop-GeeboardAgent {
  param([string]$TaskName, [string]$Wrapper, [int]$Port)
  $stopped = @()

  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }

  $marker = $Wrapper.ToLowerInvariant()
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($marker) } |
    ForEach-Object {
      Stop-ProcessTree $_.ProcessId
      $stopped += "$($_.Name) (pid $($_.ProcessId)), this node's wrapper"
    }

  $owner = Get-PortOwner $Port
  if ($owner -and $owner.Name -eq "node.exe" -and $owner.CommandLine -match "index\.ts") {
    Stop-ProcessTree $owner.Pid
    $stopped += "node.exe (pid $($owner.Pid)), an agent listening on port $Port"
  }

  foreach ($wait in 1..30) {
    if (-not (Get-PortOwner $Port)) { break }
    Start-Sleep -Milliseconds 500
  }
  return $stopped
}

# What answers on the agent's port to this node's own token: its /version, or $null. The token is the one in agent.json, on this
# PC, in this account; it goes to 127.0.0.1 and is never printed.
function Get-AgentAnswer([int]$Port, [string]$Token) {
  try {
    $reply = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/version" -Headers @{ Authorization = "Bearer $Token" } -UseBasicParsing -TimeoutSec 3
    return ($reply.Content | ConvertFrom-Json)
  } catch { return $null }
}

# Whether anything answers /health on the port: an agent that is not this node's (another token) answers it too.
function Test-HealthAnswers([int]$Port) {
  try {
    $reply = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
    return ($reply.StatusCode -eq 200)
  } catch { return $false }
}

# The version this checkout's agent is: daemon\package.json, the one the agent itself reports.
function Get-CheckoutAgentVersion([string]$Daemon) {
  try { return [string]((Get-Content -LiteralPath (Join-Path $Daemon "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version) } catch { return $null }
}

# Waits for this node's agent to answer, and says what is wrong when it does not. Never throws.
#   Answered      this node's agent answered /version
#   Version       what it said it is; Expected is the checkout's
#   Stale         it answered, and it is not the checkout's version: an older agent is still running
#   SomethingElse nothing answered to this node's token, and something answers /health: another agent holds the port
function Wait-GeeboardAgent {
  param([string]$AgentFile, [string]$Daemon, [int]$TimeoutSeconds = 40)
  $agent = Read-AgentFile $AgentFile
  $port = Get-AgentPort $agent
  $token = if ($agent -and $agent.token) { [string]$agent.token } else { "" }
  $expected = Get-CheckoutAgentVersion $Daemon
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $answer = $null
  while ((Get-Date) -lt $deadline) {
    $answer = Get-AgentAnswer $port $token
    if ($answer) { break }
    Start-Sleep -Seconds 1
  }
  $version = if ($answer) { [string]$answer.agent } else { $null }
  return [pscustomobject]@{
    Port          = $port
    Terminal      = if ($answer) { $answer.terminal } else { $null }
    Answered      = [bool]$answer
    Version       = $version
    Expected      = $expected
    Stale         = ([bool]$answer -and $expected -and $version -ne $expected)
    SomethingElse = (-not $answer) -and (Test-HealthAnswers $port)
  }
}

# The last lines of the log, indented, for a person to read where something went wrong.
function Write-LogTail([string]$Log, [int]$Lines = 12) {
  if (-not (Test-Path -LiteralPath $Log)) { Write-Host "     (there is no log yet: $Log)" -ForegroundColor DarkGray; return }
  Get-Content -LiteralPath $Log -Tail $Lines -Encoding UTF8 | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
}

# ── Windows Defender Firewall ─────────────────────────────────────────────────────────────────────────────────────────────
# The agent listens on every address, hidden, so the first time node.exe listens Windows shows its "Allow Node.js JavaScript Runtime
# to communicate on private/public networks?" dialog from a process with no window, ticks Private only, and makes a rule for the
# program, any port, any remote address. Every check the installer used to make ran on loopback, which a firewall never blocks, so a PC
# registered, passed them all, and showed "Not reached" for a reason nobody on it was told. The rule here is for the one port and for
# the panel's addresses only (and not for an IPv6 address the PC may have on the Internet).

function Get-FirewallRuleName([int]$Port) { return "Geeboard Agent (port $Port)" }

# Whether the panel is this PC: a name that is, or an address that is one of its own. No rule is needed to call oneself.
function Test-PanelIsHere([string]$PanelUrl) {
  try {
    $hostName = ([System.Uri]$PanelUrl).Host.Trim("[", "]")
    if ($hostName -in @("localhost", "127.0.0.1", "::1")) { return $true }
    $mine = @(Get-NetIPAddress -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
    foreach ($address in [System.Net.Dns]::GetHostAddresses($hostName)) { if ($mine -contains $address.IPAddressToString) { return $true } }
  } catch { }
  return $false
}

# The addresses the panel calls from: what its name resolves to. An empty list is "could not be worked out".
function Get-PanelAddresses([string]$PanelUrl) {
  try {
    $hostName = ([System.Uri]$PanelUrl).Host.Trim("[", "]")
    return @([System.Net.Dns]::GetHostAddresses($hostName) | ForEach-Object { $_.IPAddressToString } | Select-Object -Unique)
  } catch { return @() }
}

function Test-FirewallRuleExists([int]$Port) {
  return [bool](Get-NetFirewallRule -DisplayName (Get-FirewallRuleName $Port) -ErrorAction SilentlyContinue)
}

# The command, as text, for an elevated PowerShell: what is printed when this one is not.
function Get-FirewallCommand([int]$Port, [string[]]$Addresses) {
  $remote = if ($Addresses.Count -gt 0) { " -RemoteAddress " + ($Addresses -join ",") } else { " -RemoteAddress LocalSubnet" }
  return "New-NetFirewallRule -DisplayName '$(Get-FirewallRuleName $Port)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port$remote -Profile Any"
}

# Makes the rule, when this shell may; says what to run otherwise. Returns one of: here, exists, created, printed, failed.
function Set-AgentFirewall {
  param([int]$Port, [string]$PanelUrl)
  if (Test-PanelIsHere $PanelUrl) { return "here" }
  if (Test-FirewallRuleExists $Port) { return "exists" }
  $addresses = Get-PanelAddresses $PanelUrl
  if (-not (Test-Elevated)) { return "printed" }
  try {
    $remote = if ($addresses.Count -gt 0) { $addresses } else { "LocalSubnet" }
    New-NetFirewallRule -DisplayName (Get-FirewallRuleName $Port) -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $remote -Profile Any -Description "Lets the Geeboard panel call this PC's node agent. Made by deploy\windows\install-node.ps1; removed by uninstall-agent.ps1." | Out-Null
    return "created"
  } catch { return "failed" }
}

# The networks Windows calls Public: inbound is blocked on them by default, and a rule that names only Private does not help there.
function Get-PublicNetworks {
  try { return @(Get-NetConnectionProfile -ErrorAction Stop | Where-Object { $_.NetworkCategory -eq "Public" } | ForEach-Object { $_.Name } | Select-Object -Unique) } catch { return @() }
}

# ── What takes a PC node down ─────────────────────────────────────────────────────────────────────────────────────────────
# A PC is not a server, and these are the ways it stops being one that nothing in the install changes. Computed from this machine and
# not written as a list: a desktop that never sleeps and a laptop that sleeps in ten minutes have different answers. powercfg's
# numbers are read as the two hex values it prints (mains, then battery), because its words are in the language of the PC.
function Get-PcNodeRisks {
  $risks = @()
  $risks += "Signing out ends everything this account runs, Docker Desktop and its engine with it: the servers are stopped hard, not with the game's own stop command, and nothing starts until somebody signs in again. The same goes for a restart after a Windows update."
  try {
    $text = (& cmd.exe /d /c "powercfg.exe /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>nul") -join "`n"
    $values = [regex]::Matches($text, "0x[0-9a-fA-F]+") | ForEach-Object { [Convert]::ToInt64($_.Value, 16) }
    if ($values.Count -ge 2) {
      $mains = $values[$values.Count - 2]
      if ($mains -gt 0) { $risks += "This PC goes to sleep after $([int]($mains / 60)) minutes without use, on mains power, and a sleeping PC takes every server with it. Settings > System > Power: set sleep to Never for a PC that hosts." }
    }
  } catch { }
  try {
    $run = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Docker Desktop" -ErrorAction SilentlyContinue
    $approved = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" -Name "Docker Desktop" -ErrorAction SilentlyContinue
    $disabled = $approved -and ($approved."Docker Desktop"[0] -band 1) -eq 1
    if (-not $run -or $disabled) { $risks += "Docker Desktop is not set to start when you sign in, so after a restart the node waits until somebody starts it. Docker Desktop > Settings > General > Start Docker Desktop when you sign in." }
  } catch { }
  try {
    if (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue) { $risks += "This PC has a battery. The task keeps running on it, but a laptop that sleeps with its lid closed stops the node." }
  } catch { }
  return $risks
}

# What the agent has said since the installer started it, as one word: the same verdicts install.sh reads out of the journal.
#   unreachable  the panel cannot call this machine back
#   no-panel     this machine cannot get through to the panel (registration or heartbeat)
#   port         another program holds the agent's port
#   listening    it says it is listening and has complained of nothing
#   quiet        nothing yet
# $Since is the marker the installer wrote into the log just before it started the task.
function Get-AgentVerdict {
  param([string]$Log, [string]$Since, [int]$TimeoutSeconds = 20)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lines = @()
  do {
    if (Test-Path -LiteralPath $Log) {
      $all = @(Get-Content -LiteralPath $Log -Encoding UTF8 -ErrorAction SilentlyContinue)
      $from = [Array]::LastIndexOf($all, ($all | Where-Object { $_ -like "*$Since*" } | Select-Object -Last 1))
      $lines = if ($from -ge 0) { $all[$from..($all.Count - 1)] } else { $all }
      $text = $lines -join "`n"
      if ($text -match "the panel cannot reach this node") { return [pscustomobject]@{ Word = "unreachable"; Line = ($lines | Where-Object { $_ -match "the panel cannot reach this node" } | Select-Object -Last 1) } }
      if ($text -match "heartbeat failed|registration failed|registration refused") { return [pscustomobject]@{ Word = "no-panel"; Line = ($lines | Where-Object { $_ -match "heartbeat failed|registration failed|registration refused" } | Select-Object -Last 1) } }
      if ($text -match "is already in use") { return [pscustomobject]@{ Word = "port"; Line = ($lines | Where-Object { $_ -match "is already in use" } | Select-Object -Last 1) } }
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  $listening = ($lines -join "`n") -match "agent listening"
  return [pscustomobject]@{ Word = $(if ($listening) { "listening" } else { "quiet" }); Line = "" }
}
