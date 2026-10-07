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

# Whether Docker answers. Through cmd.exe: see the first trap above.
function Test-DockerAnswers {
  & cmd.exe /d /c "docker.exe info >nul 2>&1"
  return ($LASTEXITCODE -eq 0)
}

# Which kind of containers Docker runs: "linux" or "windows". Game server images are Linux ones.
function Get-DockerOs {
  $text = & cmd.exe /d /c "docker.exe version --format {{.Server.Os}} 2>nul"
  if ($LASTEXITCODE -ne 0 -or -not $text) { return $null }
  return ([string]($text | Select-Object -First 1)).Trim().ToLowerInvariant()
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
