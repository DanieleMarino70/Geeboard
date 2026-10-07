<#
.SYNOPSIS
  Looks at this Windows PC as a Geeboard node, and changes nothing.

.DESCRIPTION
  Reads what the installer made and what it depends on, and says what is wrong in words, so that a node
  that shows "Not reached" or does not appear can be looked at without stopping the task and running the
  agent by hand. It reads: the versions, Docker and its mode, the settings, the data root and who may
  read it, the task and its wrapper, who listens on the agent's port, what the agent answers, the end of
  its log, the firewall rule, and what will take this PC node down. It writes nothing, starts nothing,
  stops nothing, and prints no token.

    powershell -ExecutionPolicy Bypass -File .\deploy\windows\doctor.ps1

  It exits with 1 when it found something to put right, and 0 when it did not.

.PARAMETER TaskName
  The task's name in Task Scheduler. Default: Geeboard Agent.
#>
[CmdletBinding()]
param([string]$TaskName = "Geeboard Agent")

$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot "lib.ps1")

$script:Problems = 0
function Write-Section([string]$Text) { Write-Host ""; Write-Host $Text -ForegroundColor White }
function Write-Ok([string]$Text) { Write-Host "[ok] $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "[..] $Text" -ForegroundColor DarkGray }
function Write-Note([string]$Text) { Write-Host "     $Text" -ForegroundColor DarkGray }
function Write-Bad([string]$Text) { $script:Problems++; Write-Host "[!] $Text" -ForegroundColor Yellow }

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$daemon = Join-Path $repo "daemon"
$settings = Get-AgentSettings
$agent = Read-AgentFile $settings.AgentFile
$port = Get-AgentPort $agent

Write-Host ""
Write-Host "Geeboard - looking at this PC as a node (nothing is changed)" -ForegroundColor White
Write-Note $repo

# ── This PC and what it needs ─────────────────────────────────────────
Write-Section "This PC"
try { Write-Ok "$((Get-CimInstance Win32_OperatingSystem).Caption), Windows PowerShell $($PSVersionTable.PSVersion)" } catch { Write-Info "Windows PowerShell $($PSVersionTable.PSVersion)" }
Write-Info ("Execution policy: " + ((Get-ExecutionPolicy -List | ForEach-Object { "$($_.Scope)=$($_.ExecutionPolicy)" }) -join ", "))
if ($repo -match "OneDrive") { Write-Bad "The checkout is inside OneDrive. Sync locks and placeholder files in node_modules break the agent in ways nothing says; keep the checkout outside a synced folder." }

$major = Get-NodeMajor
if (-not $major) { Write-Bad "Node.js is not on PATH. Install Node.js $NodeFloor or newer from nodejs.org, then open a new window." }
elseif ($major -lt $NodeFloor) { Write-Bad "Node.js is $(& node.exe -v): $NodeFloor or newer is needed." }
else { Write-Ok "Node.js $(& node.exe -v)" }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Write-Bad "npm.cmd is not on PATH." }
if (-not (Test-Path (Join-Path $daemon "node_modules"))) { Write-Bad "daemon\node_modules is missing: run install-node.ps1, which installs the agent's packages." }
if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { Write-Bad "Docker Desktop is not installed (or this window has not seen it: open a new one)." }
elseif (-not (Test-DockerAnswers)) { Write-Bad "Docker Desktop is not running. The agent cannot start anything until it is." }
else {
  $os = Get-DockerOs
  if ($os -eq "windows") { Write-Bad "Docker is running Windows containers. Every game is a Linux image: Docker icon in the tray, Switch to Linux containers." }
  else { Write-Ok "Docker answers, running $os containers" }
}

# ── The node's settings ───────────────────────────────────────────────
Write-Section "This node"
if (-not $agent) {
  Write-Bad "No readable settings in $($settings.AgentFile): this PC has not joined a panel. Nodes -> Add a node in the panel writes the command."
} else {
  Write-Ok "Joined as '$($agent.nodeName)' to $($agent.panelUrl), port $port"
  Write-Info "It tells the panel to reach it at $($agent.advertiseUrl)"
  if (-not $agent.dataRoot) { Write-Bad "The settings name no data root." }
  elseif (-not (Test-Path -LiteralPath $agent.dataRoot)) { Write-Info "The data root $($agent.dataRoot) does not exist yet: it is made with the first server." }
  else {
    Write-Ok "Data root $($agent.dataRoot)"
    $summary = Get-AclSummary $agent.dataRoot
    if (Test-OthersMayRead $agent.dataRoot) { Write-Bad "Other accounts on this PC may read the data root: $summary. install-node.ps1 sets it to this account, SYSTEM and Administrators." }
    elseif ($summary) { Write-Info "Who may use it: $summary" }
  }
  if (Test-Path -LiteralPath $settings.CaFile) { Write-Info "It trusts the panel's own authority, kept in $($settings.CaFile)" }
}

# ── The task ──────────────────────────────────────────────────────────
Write-Section "The task"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Bad "There is no task named '$TaskName'. install-node.ps1 makes it." }
else {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task.State -eq "Disabled") { Write-Bad "The task is Disabled: it will not start at sign-in. Enable-ScheduledTask '$TaskName'." }
  else { Write-Ok "Task '$TaskName' is $($task.State); last result $($info.LastTaskResult)" }
  if ($info.LastTaskResult -eq 78) { Write-Bad "The last result is 78: the agent said another agent holds its port, and the wrapper stopped. The log says which." }
  if ($task.Settings.DisallowStartIfOnBatteries -or $task.Settings.StopIfGoingOnBatteries) { Write-Bad "The task does not run on battery power. install-agent.ps1 allows it." }
  if (-not (Test-Path -LiteralPath $settings.Wrapper)) { Write-Bad "The wrapper $($settings.Wrapper) is gone: run install-node.ps1." }
  else {
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($settings.Wrapper, [ref]$null, [ref]$errors)
    if ($errors.Count -gt 0) { Write-Bad "The wrapper does not parse: $($errors[0].Message). Run install-node.ps1 to write it again." }
  }
}

# ── The agent ─────────────────────────────────────────────────────────
Write-Section "The agent"
$owner = Get-PortOwner $port
if (-not $owner) { Write-Bad "Nobody is listening on port $port, so the agent is not running. The log says why it stopped." }
else {
  Write-Info "Listening on port ${port}: $($owner.Name), pid $($owner.Pid)"
  $answer = if ($agent -and $agent.token) { Get-AgentAnswer $port ([string]$agent.token) } else { $null }
  $expected = Get-CheckoutAgentVersion $daemon
  if (-not $answer) { Write-Bad "What listens on $port does not answer to this node's token: it is not this node's agent (an old one, or another program)." }
  elseif ($expected -and $answer.agent -ne $expected) { Write-Bad "The agent running is $($answer.agent) and this checkout's is ${expected}: an older agent is still running. install-node.ps1 stops it." }
  else { Write-Ok "The agent answers, version $($answer.agent)" }
  if ($answer -and $answer.terminal) { Write-Info "Node terminal: $($answer.terminal.state)" }
}
if (Test-Path -LiteralPath $settings.Log) {
  $tail = @(Get-Content -LiteralPath $settings.Log -Tail 100 -Encoding UTF8 -ErrorAction SilentlyContinue)
  # What it complained of since it last started: a complaint from before a restart is not about the agent that is running now.
  $started = -1
  for ($i = 0; $i -lt $tail.Count; $i++) { if ($tail[$i] -match "wrapper: starting the agent") { $started = $i } }
  $recent = if ($started -ge 0) { @($tail[$started..($tail.Count - 1)]) } else { $tail }
  if ($recent -match "the panel cannot reach this node") { Write-Bad "The panel could not call this PC back: $((($recent -match 'the panel cannot reach this node') | Select-Object -Last 1).ToString().Trim())" }
  if ($recent -match "heartbeat failed|registration failed|registration refused") { Write-Bad "The agent is not getting through to the panel: $((($recent -match 'heartbeat failed|registration failed|registration refused') | Select-Object -Last 1).ToString().Trim())" }
  Write-Info "The end of the log ($($settings.Log)):"
  $tail | Select-Object -Last 8 | ForEach-Object { Write-Note $_ }
} else {
  Write-Info "No log yet: $($settings.Log)"
}

# ── The firewall ──────────────────────────────────────────────────────
Write-Section "Windows Defender Firewall"
if ($agent -and $agent.panelUrl) {
  if (Test-PanelIsHere ([string]$agent.panelUrl)) { Write-Ok "The panel is on this PC: nothing to let in" }
  elseif (Test-FirewallRuleExists $port) { Write-Ok "The rule '$(Get-FirewallRuleName $port)' exists" }
  else {
    Write-Bad "No rule lets the panel reach port $port. Unless Windows' own dialog was answered, it is blocked. In PowerShell run as administrator:"
    Write-Note "  $(Get-FirewallCommand $port (Get-PanelAddresses ([string]$agent.panelUrl)))"
  }
  foreach ($network in (Get-PublicNetworks)) { Write-Info "The network '$network' is classified Public: inbound is blocked there unless a rule says otherwise." }
} else { Write-Info "Nothing to check until this PC has joined." }

# ── What takes this PC node down ──────────────────────────────────────
Write-Section "What takes this PC node down"
foreach ($risk in (Get-PcNodeRisks)) { Write-Note "- $risk" }

Write-Host ""
if ($script:Problems -eq 0) { Write-Host "Nothing to put right." -ForegroundColor Green; exit 0 }
Write-Host "$($script:Problems) thing(s) to put right, above." -ForegroundColor Yellow
exit 1
