# Nodes

A **node** is a machine you already have, running the Geeboard agent and
registered with the panel. Geeboard does not create, buy, provision or resize
machines. The one thing it will do at a provider on your behalf is write a DNS
record for a server's address, when you give it a token for that and only that
([servers.md](servers.md#dns)). The machine is yours; the node is Geeboard's
record of it.

```
Your VPS or hardware  →  runs the agent  →  registered as a node  →  hosts game servers
```

## What a node carries

| | |
| --- | --- |
| `name` | Unique, and what the agent is configured with |
| `city`, `region` | Where it is, for placement preference. Registration cannot know, so it records the agent's hostname and `unknown`; **Configure** on the node's page is how a person corrects both, and the change is audited as `node.updated` |
| `pingMs` | Round trip of the poller's health check: panel to agent, not player to server. Zero until the first successful poll, and not measured at all for a node with no agent |
| `state` | `PENDING` · `HEALTHY` · `DEGRADED` · `UNREACHABLE` · `DRAINING` · `MAINTENANCE` |
| `approvedAt` | Null means registered and not yet in service |
| `runtime` | `DOCKER` |
| `os`, `arch` | Reported by the node: the **container engine's**, not the host's. Null means it has not said — which is not the same as wrong |
| `capabilities` | What it can offer |
| `cpuCores`, `ramTotal`, `diskTotal` | Its size. Memory is the smaller of the machine's and the container engine's, rounded down: under Docker Desktop the engine is a VM, and a 16 GB PC offers containers 7 GB |
| `cpuPct`, `ramPct`, `diskPct` | Last observed load |
| `daemon` | Agent version |
| `lastSeenAt` | Last contact by any route — a poll or a heartbeat |
| `lastReachedAt` | Last time the panel **reached** it on its advertised address. What health decays from |
| `daemonUrl`, `daemonToken` | How the panel reaches it. The token is encrypted at rest and never leaves the server |
| `publicAddress` | Where players reach the machine, as a person set it with **Configure**: an IPv4 or IPv6 literal. What a DNS record points at — see [servers.md](servers.md#dns). Null means "as observed" |
| `publicAddress6` | The machine's IPv6 address, set the same way, when it has one the Internet can reach (0.7.0). An AAAA record is written only for an address a person set here or in `publicAddress`; the observed address is never taken for the other family |
| `observedAddress`, `observedAt` | The address its last heartbeat came from, as the panel's proxy saw it. Used for records only when it is a public address; from the same LAN it is a private one, and the node's page says so |

## Capabilities

A closed set, so a typo in a game definition is a compile error rather than a
game that can never be placed:

```
docker  steamcmd  java  gpu  ipv6  high-memory  ssd  workshop  backups  snapshots  community-games
```

A game declares what it needs; a node declares what it has. Valheim needs
`docker` and `steamcmd`, because its image downloads the game on first boot;
Project Zomboid needs only `docker`, because its image already carries the game.

`community-games` is not a fact about the machine but a consent, and so it is
declared the way the node terminal is allowed: **on the machine, by whoever owns
it**. It means *games somebody wrote, and an owner approved, may run here*, and
every one of them is an image that runs as root in its container and reaches what the
machine's network reaches ([Community games](community-games.md#what-an-image-can-do)).
A new node declares it with `--community-games` on the Linux installer and
`-CommunityGames` on the Windows one, which are `--capabilities community-games` for
the join; a node that has already joined adds it to what it declares, as that page
says. The panel cannot turn it on: **Add a node** has no checkbox for it and the
command it writes never carries the flag, and a node that does not declare it is
refused for every community game, in the wizard and anywhere else a server is placed.
Its page shows it with a sentence about what it means, within a minute of the agent
changing it.

An **empty capability list is unknown, not empty.** A node that has not reported
makes every game *partial* rather than incompatible — refusing a placement
because the node has not been asked yet would be worse than letting it proceed
with a warning.

## Committed, not used

Every capacity decision is made against what has been **promised** to servers,
not what they are using right now.

```
RAM   Total 64 GB   Committed 24 GB   Used 17 GB
```

A node whose servers are idle still has its memory promised to them, and the
moment they are all busy is exactly when a placement made against current usage
falls over.

**Promising more than the machine has, on purpose.** A memory limit is a
ceiling on what a server *may* take, not a reservation of what it *does* take,
and four game servers rated 8 GB each rarely hold 32 GB between them. Somebody
who has measured their own servers may want that headroom back, so the create
wizard offers it — but only where it would matter, and only as a sentence
somebody has to tick:

> **Create it anyway, over the node's capacity.** this-pc would be committed to
> 40 GB of 32 GB and 9.0 of 8 cores. Past the machine's memory, the kernel
> kills whichever server asks for what is not there — this one or another. Past
> its cores, everything here runs slower. This is recorded against your name.

It is asked for one placement at a time, never remembered between drafts, and
written to the audit log as `server.overcommitted` with the node's totals
before and after. The API takes the same decision as `"overcommit": true` on
`POST /api/v1/servers`.

**Storage is not overcommittable**, and the asymmetry is the point. Memory and
CPU degrade: the kernel kills one server, or everything runs slower, and both
are recoverable by stopping something. A disk that fills stops every world on
the node mid-write — including the ones belonging to people who did not make
this choice — and a backup taken while it is full is a backup of a truncated
save. Moving a server onto a node refuses on capacity too, without the option:
a move is not the moment to discover the machine is short.

## Compatibility

`checkCompatibility(game, node, request)` answers with three verdicts and the
reasons behind them.

| | |
| --- | --- |
| **compatible** | Every check passed |
| **partial** | Nothing failed, but something could not be checked |
| **incompatible** | Something failed, and the reasons say what |

Partial is not a hedge; it is an admission. The node has not reported its
architecture, or it is degraded, or it has no agent attached. Collapsing partial
into either of the others leaves an operator either blocked for no reason or
debugging a server that never had a chance.

It checks: availability (unreachable, draining and maintenance are refusals;
degraded is partial), agent attachment, OS, architecture, capabilities, and
memory / CPU / storage against uncommitted capacity.

Every answer carries `headroom` — what would be left after the placement — which
is what the placement engine ranks by.

**A game's own minimum is advice, not a bound.** `memoryGbMin` and `cpuPctMin`
are what this catalogue believes a game wants, measured on somebody else's
hardware with somebody else's player count. An operator running four friends on
a small machine knows something it does not, so asking for less than a game's
minimum is allowed everywhere — the create wizard's sliders, the settings page
and the API — and said everywhere it is asked for:

> Project Zomboid asks for 6 GB. With 3 it may fail to start, or run until the
> world grows and then stop.

It comes back from `checkCompatibility` as a reason of kind `advice`: a check
that did not pass, which does not make the placement incompatible and which
`blockers()` leaves out and `cautions()` returns. What stays a refusal is the
platform's own floor — 1 GB and 50% of a core, below which a container is not a
server — the game's ceiling, and the node's uncommitted capacity, which the
create wizard can be told to overrule
([Committed, not used](#committed-not-used)).

Until September 2026 a game's minimum was the floor of the slider, of the
settings field and of creation, and a failed compatibility check on top: a 4 GB
Zomboid could not be asked for at all.

**Creation enforces what the node has said.** `createServerOp` refuses a node
whose reported OS or architecture the game does not support, or that lacks a
capability the game requires — "this-pc cannot run Minecraft: Java Edition —
Missing Java". The wizard shows the same reason on the node and will not reach
the review step with it selected. What a node has *not* reported is never
refused: an unknown platform or an empty capability list stays partial.
Availability and capacity keep their own refusals, which name the numbers.

Until September 2026 this was only the wizard's recommendation, and a server
could be created on a node that had declared it could not run it.

Tested in [`test/platform.test.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/test/platform.test.ts) and
[`test/nodes.test.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/test/nodes.test.ts).

## Health

Health decays with **silence**, not with one failed request. A dropped packet, a
restarting agent and a dead machine all produce the same failed request, and
only one of them is worth waking somebody for.

```
not reached 30s   →  DEGRADED      visible, not alarming
not reached 2m    →  UNREACHABLE   believed
reached           →  HEALTHY       immediately
```

Recovery is immediate and only the decline is gradual: a node we have just
spoken to is healthy, whatever it was a moment ago.

`DRAINING`, `MAINTENANCE` and `PENDING` are decisions a person made. Neither
silence nor a successful ping overrules them — reporting a node under
maintenance as a fault is how people learn to ignore the alert that is real.

**The silence that counts is the panel's, not the agent's.** Two timestamps,
and they answer different questions:

| | |
| --- | --- |
| `lastSeenAt` | The panel heard from the node — a heartbeat, or a poll that got through |
| `lastReachedAt` | The panel **reached** the node, on the address it advertised |

Health decays from `lastReachedAt`, because that is the direction everything
the panel does travels: placing a server, starting it, reading its console,
listing its files. It used to decay from `lastSeenAt`, which a heartbeat
refreshed every fifteen seconds — so a node whose agent could call out from
behind a port nothing could call back through read as `HEALTHY` until somebody
tried to put a server on it. A heartbeat no longer clears a fault by itself;
what clears it is the panel calling the node and getting an answer.

The node's page shows both, as **Last seen** and **Reached**.

## Draining

`DRAINING` takes a node out of rotation for new placements without touching what
is already on it. `MAINTENANCE` does the same and reads as deliberate rather
than as something in progress. Both refuse creation with a message naming which.

Draining does not move anything by itself; a server is moved from its own
Settings page, one at a time — see [Moving a server](#moving-a-server).

## Moving a server

**Settings → Move to another node** takes a server from one node to another
through the off-site bucket, which is why a bucket has to be configured first:
the two agents never talk to each other, and are not given a way to. The
sequence, and where each step is undone if the next fails:

```
stop        the game's own stop command, so the world on disk is whole
back up     off-site, named move-<date>, locked for the duration
port        a free block on the target — it may differ from the old one
provision   a stopped workload on the target, around a new directory
restore     the archive, pulled down and hashed, replaces that directory
switch      the row: node, port, workload — one write, undone if the
            target will not start
start       on the target, if it was running before
remove      the old workload and directory, last of all
```

Until the switch the server is untouched on its old node, and a failure only
removes what was made on the target. Between the switch and the start the old
workload still exists, so a target that will not start puts the row back and
starts the old one. Only once the server is up where it is going does the old
copy go — with the local backups beside it, whose rows go too; off-site backups
stay and still belong to the server. A **locked** local backup blocks the move
until it is unlocked, because it is the way back from an update and would be
lost. The move backup stays in the bucket afterwards, unlocked.

The target has to pass the same checks a create makes — approved, in rotation,
an agent attached, capacity, the game able to run there, a free port block —
and the page says which one fails before anything is pressed. Moving is for
owners and admins, like creating and deleting; the server is `MIGRATING` while
it happens and the audit log records `server.moved` with both nodes, both
addresses and the backup's name, or `server.move.failed` with the reason.

Demonstrated on this PC between two agents sharing one Docker engine, each with
its own data root and container prefix (`GEEBOARD_CONTAINER_PREFIX`): a Terraria
server moved there and back in about seven seconds each way, running on the
other side with its world.

## Retiring a node

A machine leaves the fleet in three steps, and the node's page shows them as a
checklist under **Retire this node**, with where the node stands on each:

```
1  move or delete its     a move carries a server to another node through the
   servers                bucket; a delete removes container, world and backups
2  drain it               nothing new is placed there meanwhile
3  remove it              the panel forgets the node and its agent token
```

Step 1 lists the node's servers, each with a **Move** link to the move card in
its Settings and a **Delete** link to its Danger zone, where it is deleted by
typing its name.

**A machine that is gone.** A move and a delete both ask the machine, so with it
destroyed neither can finish, and the servers on it — and so the node — could never be removed. Until
0.9.0 that was a dead end. When the panel has not reached the node for longer than it takes to be
called unreachable (a node that was drained and then died stays "draining", so the clock is asked too),
step 1 adds a **Forget** link to each server, and its Danger zone offers *The machine is gone: forget this
server*. Forgetting removes the panel's record of the server, its local backups' rows and its DNS record
where the panel keeps one, and sends **nothing** to the machine: the container and the world stay on it,
and if the machine comes back they are there, no longer listed, to be removed by hand. It is refused
unless the panel has not reached the node for two minutes and the node, asked when the button is pressed, answers nothing at all (an agent that
answers with any status, a 503 because Docker is stopped under it included, is there), it is not offered together with a last backup (that needs the node), it asks for
the server's name, and it writes `server.forgotten`, not `server.deleted`, saying the machine was not
asked. Off-site backups stay, as for a delete. Then the node is drained and removed as above. Over the
API: `DELETE /servers/:id` with `"forget": true` ([api.md](api.md)).

**Remove node** unlocks only when the node is drained (or under maintenance) and
has no servers, and asks for the node's name typed out. Removing:

- deletes the node's record, and with it the encrypted agent token
- revokes any unused registration token minted for its name, so the name comes
  back only when somebody mints a new one
- records `node.removed` in the audit log, with the state, address and platform
  it had

**Removing never touches the machine.** A node being retired is as often dead as
alive, and deleting things on a machine the panel is about to forget would be
acting on a record it is throwing away. That is why the servers go first: deleting
a server is the step that cleans the machine, and it refuses when the node cannot
be reached, so nothing is left running where the panel can no longer see it. The
database agrees — a server references its node without a cascade, so a node with a
server on it cannot be deleted even by a request that skipped the checks.

Afterwards, stop the agent on the machine. Its heartbeats are refused from then on,
and the Nodes page says so after the removal. What remains on the machine is only
what was never the panel's: the agent's checkout, and an empty data root.

**Rejecting** is the same thing for a node that was never approved, from the
pending card on the Nodes page — it has nothing on it to delete first.

On a development machine, `npm run db:seed:empty` removes every node at once, and
nothing on any of them.

## Registering a node

```
panel mints a token            single-use, expiring, revocable, bound to a name
node joins with it             sending its address, its own token, what it measured
panel records it as PENDING    nothing is placed there yet
an admin approves it           and only then is it in service
```

On the panel, **Nodes → Add a node** asks for a **node name** — lowercase, like
`fra-node-03`; the token registers this name and no other — and which of the
capabilities a game needs the machine should declare — not `community-games`, which only the
machine's own operator declares ([above](#capabilities)). The two addresses are
folded away, because most people never touch them:

| | |
| --- | --- |
| Panel address | Where the machine reaches the panel. Pre-filled from `PANEL_URL`, or the address your browser used |
| Agent address | Optional. Left empty, the agent works it out — see below |

**Create the command** mints the registration token and shows one command to
paste on the machine, with Docker running. Its first line clones **this panel's
release** (`git clone --branch v0.9.0 --depth 1 …`, the tag of the panel that made
the command), because the installer pulls the agent image at the version of the
checkout it is run from, and a node cloned from the tip of `main` while the panel
is a release can pull a different agent. Leave the line out if a checkout of
that release is already there.

```bash
git clone --branch v0.9.0 --depth 1 https://github.com/DanieleMarino70/Geeboard.git && cd Geeboard
sudo bash deploy/linux/install.sh 'http://panel.lan:3000' 'gbn_…'
```

```powershell
git clone --branch v0.9.0 --depth 1 https://github.com/DanieleMarino70/Geeboard.git; cd Geeboard
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel 'http://panel.lan:3000' -Token 'gbn_…'
```

The card that asks for approval says which machine registered: its hostname, the
address the registration came from, and the label of the token that was spent.

Each installer checks the machine, joins it, installs the agent as something
that starts by itself (at boot on Linux; at every sign-in on Windows, which is
when Docker Desktop runs), and says whether it came up —
[Install Geeboard](production.md#add-a-linux-node). A declared capability adds
`--capabilities steamcmd` (`-Capabilities` on Windows); an agent address adds
`--advertise` (`-Advertise`).

**A panel reached at an address rather than a name adds its authority's
fingerprint** to the command — `--panel-ca 'sha256:…'` on Linux, `-PanelCa
'sha256:…'` on Windows — because that panel's certificate is signed by an
authority of its own and the agent has to be given it. The node fetches the
authority from the panel and keeps it only if it matches the fingerprint, so
nothing is copied by hand. The panel decides this from its own `PANEL_URL`;
nobody is asked, and there is no setting for it. See
[A panel behind a private certificate authority](installation.md#a-panel-behind-a-private-certificate-authority).

What `join` does (`daemon/src/join.ts`):

1. Checks Docker answers, and that the panel can be reached from the machine.
2. Works out the address the panel should use: the local address of its own
   connection to the panel, on port 8080 — `127.0.0.1` beside the panel, the LAN
   address across a network. This is wrong behind NAT, where the panel reaches
   the machine through a forwarded port on another address; that is what
   `--advertise` is for.
3. Generates its own agent token.
4. Registers. It does not send a name: the token was issued for one, and the
   panel answers with it.
5. Saves what it joined with, and starts the agent.

**Nothing in the command needs keeping.** The token in it is spent by its first
run, and the agent's own token is made on the machine and never shown to anyone.
From then on `npm start` (`npm.cmd start`) is the whole command, because the
agent reads what `join` saved:

| | |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Geeboard\agent.json` |
| Linux, macOS | `~/.config/geeboard/agent.json` (`$XDG_CONFIG_HOME` if set), `/etc/geeboard/agent.json` as root |

It holds the agent token, so it lives in the account's own profile, and on Unix
it is readable by its owner only. `GEEBOARD_AGENT_FILE` puts it elsewhere. Every
`GEEBOARD_*` variable still works and wins over the file; an environment that
sets both the token and the node name is used alone, which is how an agent
configured by hand keeps working.

This used to be seven environment variables, one of them an agent token the
dialog generated in the browser and could show only once — and because the agent
read nothing but its environment, the whole block had to be pasted again on
every start. Losing it meant registering the machine again.

The dialog follows the machine the whole way in, as four steps it ticks from
facts the panel holds and never from a timer:

```
command run on the machine     the token is out; how long it is good for is shown
registered                     the node row exists — platform, size, capabilities, agent version
approved                       somebody pressed Approve, here or on the Nodes page
reached by the panel           the panel called the node's address and got through
```

When the agent registers, the machine appears in the dialog and **Approve** is
right there; it also appears on the Nodes page, awaiting approval, for anyone
who closed the dialog. Approval is not the end: the panel calls the node back
on its first heartbeat, and until that call gets through the dialog says so,
because a machine that registered perfectly and cannot be reached is the one
that takes no servers. When the call fails, the dialog says why, in the words
the attempt failed with — *http://10.0.0.5:8080 … timed out* — with the two
things that fix it: open the port to the panel, or join again with
`--advertise`. The same line is on the node's page as *Not reached*. Until
0.3.5 that reason reached only the agent's own log, and the dialog stopped at
*registered*. What the panel cannot know is not shown: nothing says the
installer started, or that a join was refused on the machine — the installer's
own output says those, on the machine, where somebody is standing.

**Approval is the security of the flow.** A registration token is a credential
that can bring a machine into your fleet; if one leaks, the machine that
registers with it must not become useful by simply waiting. Nothing is placed on
an unapproved node, and the watchdog ignores it. A token that may have leaked —
in a screenshot, say — should be revoked from the Nodes page before anything
registers with it.

**A registration token is bound to the node name it was minted for.** A
different name is refused, without spending the token, so a typo in the command
can be fixed and run again.

**Rotating the agent token** is a button on the node's page, **Rotate the agent
token**, and the node stays in service throughout. The panel makes the new
token on the server and hands it to the agent over the channel the old one
authenticates; the agent saves it beside the old one and accepts both; the panel
records it; then the agent, told so with the new token, forgets the old. Stop
after any step and the panel still holds a token the agent takes. Nobody is
shown it. If the last step does not arrive the result says the old token still
works, and rotating again finishes the job. An agent configured by hand with
`GEEBOARD_DAEMON_TOKEN` refuses — the variable would win again at the next
start — and an agent from before this existed answers that it is too old.

Re-registering an existing name is still how a machine is rebuilt: mint a token
for that name and run `join` again — it generates a new token and rewrites the
saved settings. The dialog warns that it will replace the agent registered under
it. It keeps the node's approval and records the change.

**A join starts from what the last one saved.** The panel's command carries an
address and a token and nothing about a port or a data root, so a join that built
its settings from its arguments alone put every one of them back to its default:
a PC installed with `-DataRoot D:\GameServers` looked under `C:\ProgramData`
after the next command, with its servers still running from the old place, a
backup that archived an empty folder and succeeded, and a restore that replaced
the wrong one. Now the **data root**, the **port**, the **capabilities** (what
`-CommunityGames` and `-Capabilities` declared), the **terminal's consent** and an
**address given by hand** (`--advertise`) are kept unless the run says otherwise
— `--data-root`, `--port`, `--capabilities` (`--capabilities none` takes them all
back), `--terminal` or `--no-terminal` — and the output says what it kept: *Kept
from the previous join: data root D:\GameServers, port 8183, capabilities steamcmd.*
An address the agent worked out for itself is worked out again, because a DHCP
lease changes. If a run does name another data root while the old one holds server
folders, it says so: they stay where they are and the agent will not see them.

**A token for a different node is refused, with the token still good.** The name is
sent with the registration and the panel checks it before it spends the token, so
pasting the command for `fra-node-02` into the PC that is `win-node-1` changes
nothing and says so, instead of making that PC the new node and leaving the old one
with no agent. `--replace` (`-Replace` on Windows) says it is meant.

### What takes a PC node down

A PC is not a server, and these are the ways it stops being one that nothing in the
install changes. `deploy\windows\install-node.ps1` prints the ones that are true of the
PC it ran on, and `deploy\windows\doctor.ps1` looks at all of this, and at the node, and
changes nothing:

- **Signing out** ends everything the account runs, Docker Desktop and its engine with
  it. The servers are stopped hard, not with the game's own stop command, and nothing
  starts until somebody signs in again. The same goes for a restart after a Windows
  update. The agent is a task at *sign-in*, not at boot, because Docker Desktop lives in
  that session. A PC that must host with nobody signed in is a Linux machine.
- **Sleep and hibernation.** A PC that sleeps after ten minutes takes every server with it.
  The installer reads the setting (`powercfg`) and says so; *Settings > System > Power* is
  where it is changed.
- **Docker Desktop not starting at sign-in.** It is a setting of its own (*Settings >
  General > Start Docker Desktop when you sign in*), often off, and until it is on a
  restart leaves the node waiting for somebody.
- **A laptop.** The task is allowed on battery and is not stopped when unplugged (the
  defaults of a scheduled task are the opposite), but a laptop that sleeps with the lid
  closed stops the node.
- **Docker in Windows-containers mode.** Every game is a Linux image; a PC in that mode
  registers and then refuses every game. The installer stops there and says how to switch.
- **Windows Defender Firewall.** The agent listens on one port. The installer makes a rule
  for that port and for the panel's addresses only, when it runs as an administrator, and
  prints the command to run as one when it does not; without a rule Windows asks the first time
  the agent listens, in a window of a process with no window, and answers for Private networks
  only. The rule is named *Geeboard Agent (port 8080)* and `uninstall-agent.ps1` removes it. A
  panel on the same PC needs none.
- **Who can read the worlds.** A folder made under `C:\ProgramData` inherits *every local
  user may read it*. The installer makes the data root and sets it to this account, SYSTEM and
  Administrators and nobody else (Docker Desktop runs as the account and keeps its access); a
  data root has to be a folder of its own, on a disk of this PC, outside the checkout.
Before names were bound, any token could re-register any name, so a leaked one
could re-point an approved node at a machine of its holder's choosing and the
panel would keep sending it servers.

### Platform

A node reports the operating system and architecture **its containers** run on,
from the Docker engine's `OSType` and `Architecture` — `x86_64` read as `x64`,
`aarch64` as `arm64`. Docker Desktop on Windows runs Linux containers, so a
Windows machine is a `linux · x64` node; reporting the host's `windows` made every
game in the catalog incompatible with a machine that could run all of them.

The host's values are used only until the engine has answered once. After that
the last answer is kept through an engine restart, rather than flipping the node
to `windows` for the fifteen seconds Docker Desktop takes to come back.

### Size

Cores, memory and disk are measured, and re-measured with every heartbeat. Disk
is the filesystem the data root lives on; on a machine that has never run a
server that directory does not exist yet, so the nearest existing parent is
measured. It used to read as nothing, which the panel floored to 1 GB and then
refused every game for storage.

### Without the flow

A node with no `GEEBOARD_PANEL_URL` behaves exactly as it always has: the panel
polls it, and somebody attached it by hand. Existing nodes were backdated as
approved by the migration, because taking a running fleet out of service is not
an acceptable way to introduce a feature.

A node with no agent at all is still usable: the panel keeps its records and
simulates lifecycle transitions, and says so rather than pretending — a
`simulated` badge beside the state, a banner on the server page, warnings rather
than successes for start and stop. Files and console are not available, because
there is nothing to reach. Only the sample workspace (`npm run db:seed`) has such
nodes; a node added through the dialog always has an agent.

## Heartbeat

An agent with a panel URL posts to `/api/v1/nodes/heartbeat` every 15 seconds
with its load, size, platform and capabilities, authenticated with the same
shared secret the panel presents back to it — two parties know it, so either
direction is the same proof.

A changed platform is recorded as `node.platform.changed` — switching Docker
Desktop to Windows containers changes which games a node can host. A platform
being filled in for the first time is not news and is not recorded.

A failed heartbeat is warned about and never fatal. An agent that fell over
because it could not phone home would turn a monitoring outage into a hosting
one; the containers on that machine do not need the panel to keep running.

It does not go on at fifteen seconds whatever the panel says. A panel that is **away** (the network, a
503) is asked again after 30 seconds, then a minute, doubling to five minutes, with a little jitter so that
a hundred agents do not return to a restarted panel in the same second, and at fifteen seconds again once it
answers. A panel that **refuses** the agent (401, 403, 404: the node was removed, joined again from another
process, or the panel was restored from an older backup) is told in one line what to do (`the panel does not
accept this agent`) and asked again every five minutes, in case it was put right. A beat that hangs (a call to
a disk that stopped answering) is waited for and said, and no second one is started on top of it.

**The panel answers a heartbeat by trying the other direction**, when it has
not reached that node in the last 30 seconds: it calls the node's advertised
address, records `lastReachedAt` when it answers, and tells the agent when it
does not. The agent prints that, once and then every five minutes:

```
{"at":"2026-10-07T09:12:03.482Z","level":"warn","component":"agent","node":"fra-node-02","msg":"the panel cannot reach this node","advertised":"http://203.0.113.10:8080","detail":"… timed out","fix":"open that address to the panel, or join again with --advertise <address the panel can use>"}
```

It is the one fault an agent cannot find for itself — everything on its side is
working — and it is why a node can register perfectly and still take no
servers. An approved node is polled every fifteen seconds and so never needs
this; a node waiting for approval is not polled at all, and this is the only
thing that tries it. See
[installation.md](installation.md#when-the-panel-cannot-reach-the-node).

## Node terminal

A shell on a node's machine, opened from the panel: **Terminal** in the
sidebar, under Infrastructure, or **Open terminal** on the node's page. It is
not a console. A console is a game's stdin and stdout, and a member may watch
their own; this is the machine the agent runs on, as the account it runs as,
and it is the most far-reaching thing the panel can do, so everything about it
is narrower.

**What opens.** Whatever the machine is, and no more:

- On **Windows** the agent is a scheduled task in the account that installed
  it, so a terminal is that account's `powershell.exe`, not elevated. It can do
  what that account can — which includes reading `agent.json`, the node's own
  token, because that account can. `GEEBOARD_TERMINAL_SHELL` names another
  program, on the machine.
- On **Linux** the supported install runs the agent in a container, and a
  terminal is `/bin/sh` inside that container: it sees `/var/lib/geeboard`,
  `/etc/geeboard` and the host's network, and not the host's own files. The
  page says so above the terminal — *inside the agent's container* — because
  a prompt that reads `~ #` would otherwise suggest more than it is. A shell of
  the host itself is not what this release does.

The agent says which in every heartbeat — the operating system, the account,
the program, and whether the shell is the machine's or the container's — and
the node's page shows it under **The machine**, as *Terminal*.

**Who may open one.** Owners, and only owners: `node.terminal` is the one
permission an admin does not share, and no API key scope carries it, so a key
cannot open a shell however it was issued. Opening asks for a fresh code from
the authenticator every time — not the one that signed in, which is spent —
so a signed-in tab left open is not a shell left open. See
[security.md](security.md#node-terminal).

**Where it is switched on.** At the machine, never from the panel. It is off
until somebody there says otherwise:

```bash
sudo bash deploy/linux/install.sh https://panel.example.com 'gbn_…' --terminal   # a new node
sudo bash deploy/linux/install.sh --terminal                                       # one already joined; --no-terminal takes it back
```

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel '…' -Token '…' -Terminal
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Terminal   # already joined; -NoTerminal takes it back
```

By hand it is `GEEBOARD_TERMINAL=1` in the agent's environment
(`/etc/geeboard/agent.env` on Linux, kept across upgrades), or `npm run
terminal -- on` in `daemon/`, which writes the same consent into `agent.json`;
the variable wins over the file, and the agent reads both when it starts. The
Add a node dialog never puts `--terminal` in the command it writes: a consent
that can be pasted in from a browser is not one.

**What the panel shows when it cannot.** The Terminal page and the switcher
say which it is, before any code is asked for:

| Shown | Why |
| --- | --- |
| *Owners only* | The role is not owner |
| *waiting for approval* | A terminal opens on an approved node only |
| *no agent* | Nothing is attached |
| *agent too old* | The agent has never said anything about a terminal: it is from before 0.3.5. The release line cannot tell, since 0.3.2 and 0.3.5 are one line; this field can |
| *off* | Nobody at the machine switched it on |
| *unavailable* | They did, and the machine cannot: the PTY library's binary is missing, or `GEEBOARD_TERMINAL_SHELL` names a program that is not there. The reason is the agent's own words |
| *plain http* | The panel reaches the agent with `http:` across the Internet, and what is typed would cross it unencrypted. A private or loopback address is fine over `http:`, `https:` is fine anywhere, and a name counts as public: register it by IP address or put TLS in front of its agent. A node with a public address has a terminal only if its agent is reached over HTTPS |

**How a session ends.** Closing it from the page; the browser going away for
more than thirty seconds (a page reload within that picks the same shell back
up, with what it printed meanwhile); signing out, or the session being ended
from the account page; the role changing; the node's token being rotated;
fifteen minutes with nothing typed; four hours whatever it is doing; the agent
stopping. Each is told to the page as its last line, and each ends the shell
and everything it started — `taskkill /T` on Windows, a hang-up and then a
kill of every descendant on Linux, so a `sleep 300 &` left in the background
does not outlive the session. The agent allows two sessions at once per node,
and answers *busy* past that.

**What is recorded.** The audit log gets *node.terminal.opened* and
*node.terminal.closed* — the node, who, the shell, how long, why it ended,
how many bytes each way — and *node.terminal.refused* for a wrong code. Never
what was typed or printed: not in the audit log, not in the panel's log, not in
the agent's. `verify:terminal` proves all of the above against two real agents.

## Panel and agent versions

The two halves talk over an HTTP contract neither of them negotiates: the panel
asks for a workload in the shape this release builds, and the agent answers in
the shape this release reads. Nothing in that exchange announces a version, so
a mismatch does not fail loudly — it fails as a field that is quietly absent,
hours later, on somebody's world.

**The rule.** A panel and an agent work together when they speak the same
**contract**: a whole number, written in the code of each half, that goes up
only when one of them would no longer be able to read the other — a route
removed or renamed, a field one side now requires, a meaning changed. A field
the other side can ignore is not a reason. From 0.4.1 the agent sends its
contract with its version, in its registration, in every heartbeat and in
`GET /version`; the panel keeps it and shows it on the node's page, after the
agent's version (`0.4.1 · contract 1`). The panel's is `PANEL_CONTRACT` in
`web/src/domain/nodes/agent-version.ts`, the agent's is `AGENT_CONTRACT` in
`daemon/src/contract.ts`, and a test reads both and fails when they differ.

An agent that sends none — every agent up to 0.4.0 — is judged by its
**release line**, as it always was. Below 1.0 a line is `major.minor`, because
that is where semantic versioning puts a breaking change while a project is
still `0.x`; from 1.0 it is the major. So `0.4.0` and `0.4.3` are one line, and
`0.4.0` and `0.5.0` are not. A version nobody has reported is *unknown*, which
is not the same as wrong — the same distinction the platform checks make, and
the reason a node that has never spoken is not refused on a guess.

**Why two.** The line rule made every minor release an upgrade of every agent,
including the ones that had not changed: 0.4.0 shipped an agent with no code
change in it because the panel's line had moved. A contract does not move with
the release. An agent that carries one stays good for every panel that speaks
the same thing, and raising it is a decision that costs every node an upgrade —
so each release says in the [CHANGELOG](https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md) whether it did. An
agent from before the contract stays on the line rule; the first upgrade to
0.4.1 or later is the last one that rule forces on it.

**Features.** Beside the contract an agent sends `features`, a list of names, in the same three
places (registration, every heartbeat, `GET /version`). It is empty: nothing is a feature yet. It is
how a capability that a panel may or may not need can arrive without raising the number — an agent
that can do one more thing says so there, and a panel that wants it asks for it by name — and the
first thing it is for is the one the contract is held back for, a console that speaks RCON. Adding
a name is adding a field the other side can ignore, which the rule above says is not a reason to
raise the contract, so a panel that has never heard of `features` ignores it. The panel does not
store it yet: there is nothing it could ask for. (`AGENT_FEATURES` in `daemon/src/contract.ts`.)

The versions come from a `package.json` and nowhere else: the panel's is
inlined at build time by `next.config.ts` and shown under the name in the
sidebar, the agent's is read by `loadConfig` and answered by `GET /version`.
`GEEBOARD_VERSION` overrides the agent's, for testing the rule. The contract is
a constant in each half and is not overridable.

Five places enforce it, differently on purpose:

| Where | What happens |
| --- | --- |
| **Registration** | Refused, with both numbers named and which of the two decided. A machine joining with the wrong agent is a mistake worth catching in the terminal where it was made, while somebody is still standing there |
| **Heartbeat** | Recorded, never refused. An upgrade moves the panel first and the agents after it, so between those two moments a node may be behind. The contract travels with the version and is replaced with it, so an agent put back to one that sends none is judged by its line again. Cutting them off would turn an upgrade into an outage |
| **Placement** | Refused. The node keeps every server it already runs and takes no new one until its agent is upgraded |
| **Rebuilds** | Refused: an update, a rollback, a rebuild, and a settings change that needs one. Each downloads its build first, which an agent from before 0.3.0 has no way to do, so it is not asked, and nothing is written. Its servers go on running as they are |
| **Ask the node** | Refused. An agent from before 0.3.0 reads a mod's download only where Build 41 keeps it, and its answer would be believed |
| **What you see** | An `agent behind` badge on the node's card in the Nodes list and in the dashboard's Node health, and a line in the strip under the title that names the nodes (`deb-node runs an agent behind this panel: it takes no new servers until upgraded`). The node used to read "Healthy" until the first create said it could not run the game, with the cause one click deeper. Hover the badge for the sentence |

**Which agent works with which panel**, as the rule above decides it (the cells are computed
from the code by `web/test/nodes-versions-docs.test.ts`, which fails when this table and the
code part). *yes* is registered, takes new servers and is not marked behind; *no* is refused at
registration, and a node that is already there is marked behind and takes no new server:

| Panel \ agent | 0.3.2 (no contract) | 0.4.0 (no contract) | 0.4.1 (contract 1) | 0.8.1 (contract 1) | 0.9.0 (contract 1) |
| --- | --- | --- | --- | --- | --- |
| **0.4.1** | no — line 0.3, the panel's is 0.4 | yes — same line 0.4 | yes — contract 1 | yes — contract 1 | yes — contract 1 |
| **0.8.1** | no — line 0.3, the panel's is 0.8 | no — line 0.4, the panel's is 0.8 | yes — contract 1 | yes — contract 1 | yes — contract 1 |
| **0.9.0** | no — line 0.3, the panel's is 0.9 | no — line 0.4, the panel's is 0.9 | yes — contract 1 | yes — contract 1 | yes — contract 1 |

So an upgrade of the panel does not strand an agent from 0.4.1 on: that is the point of the
contract, and why 0.8.1 and 0.9.0 ship an agent that is the 0.4.1 one with additive changes
(`features`, the Windows installer, a closed port). A 0.9.0 agent works under a 0.4.1 panel,
which is how an upgrade of the panel is put back. An agent from 0.4.0 or before is the only
one an upgrade strands, and *Upgrade the agents* in [upgrading.md](upgrading.md) says when.

The table is computed, and nine of its cells were also run: panels from the 0.4.1 image, the 0.8.1 image and
the 0.9 branch's own build, each joined by an agent from the 0.3.5 image (line 0.3, the cell of 0.3.2), the 0.8.1 image
and the branch's own build, with a fresh database for each pair. The 0.3.5 agent was refused at registration by all three
panels, in the words of the table's *no*: `This panel is 0.4.1 and that agent is 0.3.5: that agent reports no contract
number, so its release line decides, and 0.3.5 (line 0.3) is not the panel's line (0.4), so they would not understand each
other`. The 0.8.1 agent and the branch's agent registered under all three, and the panel stored them as agent 0.8.1,
contract 1, waiting for approval. The branch still reported itself as 0.8.1 when this was run (the cut raised the number), so the 0.9.0
column is that build and not a published image. That is the whole of what was run: no 0.4.0 agent (its cell is the rule's,
and the rule is tested), nothing older than a 0.4.1 panel, and no panel of the 0.9.0 image. The version-skew run on a real
machine, with a game running through it, is in [what was run before 0.9.0](release-matrix.md#m01-an-existing-panel-upgraded-in-place).

An agent that reports no version is not refused, and one of those from before
0.3.0 answers a download with a `404`: the panel says that the agent is older
than it and needs upgrading, and changes nothing. Within one line the panel
cannot tell releases apart by number, so a capability added inside a line is
announced by the agent instead: the node terminal (0.3.5) is a field in every
heartbeat, and a node that has never sent it is shown as *agent too old*
rather than refused anything else. Something that is not a contract — not a whole
number of one or more — is read as none, and the agent is judged by its line; it is
never refused for the shape of what it sent.

The node's own page says so in a banner, and the sidebar shows what the panel
is, so the two numbers can be compared without reading a log. The banner, the
placement refusal and the registration error all say which criterion decided —
*the agent speaks contract 2 and the panel speaks contract 1*, or *that agent
reports no contract number, so its release line decides* — so nobody goes looking
for the wrong number.
[upgrading.md](upgrading.md) is the order to do it in.

## Placement

Placement chooses **which existing node** hosts a new server. It never
provisions anything.

```
Frankfurt   CPU 82%   RAM 91%
Milan       CPU 43%   RAM 54%     ← recommended
Amsterdam   CPU 61%   RAM 68%
```

`placeServer()` ranks every node and shows its arithmetic. The wizard displays
the recommendation with the reasons behind it and a button to take it; the
operator can always choose something else, and creation validates whatever they
chose rather than trusting the suggestion.

The weights, and why:

| | | |
| --- | --- | --- |
| Memory headroom | 0.40 | What actually runs out. A node with spare cores and no spare memory hosts nothing. |
| CPU headroom | 0.25 | |
| Storage headroom | 0.10 | Rarely decides anything; breaks ties in the right direction. |
| Spread | 0.05 | Two servers on one node share a failure. Deliberately small: packing where there is room beats spreading where there is not. |
| Apart | 0.10 | The sharper half of spread. Two servers of one game, or of one owner, share a failure *with the same people* — a community with both its Minecraft servers on the machine that died has none. Same-game servers also peak in the same hours. |
| Region match | 0.10 | A preference. A preference that refuses is a requirement wearing a friendlier word. |

**Apart** is `1 / (1 + same-game + ½ · same-owner)`: a server of the same game
on the node is a whole neighbour, another of the same owner's (of a different
game) half of one, and a server that is both is counted once, as same-game. So
the first such neighbour halves the term and each one after costs less — the
first is the one that matters. Its weight came out of memory and spread, which
is where a preference about neighbours belongs: it decides between two nodes
that both have room, and cannot outvote one that has none (tested). The reason
is shown with the rest — "1 other Minecraft: Java Edition server here, which
would go down with it", "No other Terraria server here, and none of this
owner's" — and a node whose servers were not described scores as if it had no
such neighbours, the way an unasked region scores nothing.

A **partial** verdict — something could not be checked — stays eligible and is
multiplied by 0.6, so it loses to any node we are sure about without being
excluded on an unknown.

Deterministic, and that matters: ties break on latency then on name, so the same
fleet always produces the same answer. A score nobody can reproduce is a score
nobody trusts, and the first time it puts a server somewhere surprising it
becomes something to work around.

When nothing fits, the reason is summarised once rather than repeated per node —
five nodes saying "out of memory" is one fact, and the fact is that the fleet is
full.
