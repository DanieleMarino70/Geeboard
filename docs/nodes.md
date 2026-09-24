# Nodes

A **node** is a machine you already have, running the Geeboard agent and
registered with the panel. Geeboard does not create, buy, provision or resize
machines, and there are no cloud provider integrations. The machine is yours;
the node is Geeboard's record of it.

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

## Capabilities

A closed set, so a typo in a game definition is a compile error rather than a
game that can never be placed:

```
docker  steamcmd  java  gpu  ipv6  high-memory  ssd  workshop  backups  snapshots
```

A game declares what it needs; a node declares what it has. Valheim needs
`docker` and `steamcmd`, because its image downloads the game on first boot;
Project Zomboid needs only `docker`, because its image already carries the game.

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
capabilities a game needs the machine should declare. The two addresses are
folded away, because most people never touch them:

| | |
| --- | --- |
| Panel address | Where the machine reaches the panel. Pre-filled from `PANEL_URL`, or the address your browser used |
| Agent address | Optional. Left empty, the agent works it out — see below |

**Create the command** mints the registration token and shows one command to
paste on the machine, in a checkout of Geeboard, with Docker running:

```bash
sudo bash deploy/linux/install.sh 'http://panel.lan:3000' 'gbn_…'
```

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel 'http://panel.lan:3000' -Token 'gbn_…'
```

Each installer checks the machine, joins it, installs the agent as something
that starts at boot, and says whether it came up —
[Install Geeboard](production.md#add-a-linux-node). A declared capability adds
`--capabilities steamcmd` (`-Capabilities` on Windows); an agent address adds
`--advertise` (`-Advertise`).

**A panel reached at an address rather than a name adds `--panel-ca auto`** to
the Linux command, because that panel's certificate is signed by an authority
of its own and the agent has to be given it. The panel decides this from its
own `PANEL_URL`; nobody is asked, and there is no setting for it. See
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

The dialog waits. When the agent registers, the machine appears in it with its
platform, size and capabilities, and **Approve** is right there. It also appears
on the Nodes page, awaiting approval, for anyone who closed the dialog.

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
for that name and run `join` again — it generates a new token and overwrites the
saved settings. The dialog warns that it will replace
the agent registered under it. It keeps the node's approval and records the change.
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

**The panel answers a heartbeat by trying the other direction**, when it has
not reached that node in the last 30 seconds: it calls the node's advertised
address, records `lastReachedAt` when it answers, and tells the agent when it
does not. The agent prints that, once and then every five minutes:

```
the panel cannot reach this node  advertised=http://203.0.113.10:8080  detail=… timed out
```

It is the one fault an agent cannot find for itself — everything on its side is
working — and it is why a node can register perfectly and still take no
servers. An approved node is polled every fifteen seconds and so never needs
this; a node waiting for approval is not polled at all, and this is the only
thing that tries it. See
[installation.md](installation.md#when-the-panel-cannot-reach-the-node).

## Panel and agent versions

The two halves talk over an HTTP contract neither of them negotiates: the panel
asks for a workload in the shape this release builds, and the agent answers in
the shape this release reads. Nothing in that exchange announces a version, so
a mismatch does not fail loudly — it fails as a field that is quietly absent,
hours later, on somebody's world.

**The rule.** A panel and an agent work together when they share a release
line. Below 1.0 a line is `major.minor`, because that is where semantic
versioning puts a breaking change while a project is still `0.x`. From 1.0 a
line is the major.

So `0.1.0` and `0.1.4` are one line. `0.1.0` and `0.2.0` are not. A version
nobody has reported is *unknown*, which is not the same as wrong — the same
distinction the platform checks make, and the reason a node that has never
spoken is not refused on a guess.

Both numbers come from a `package.json` and nowhere else: the panel's is
inlined at build time by `next.config.ts` and shown under the name in the
sidebar, the agent's is read by `loadConfig` and answered by `GET /version`.
`GEEBOARD_VERSION` overrides the agent's, for testing the rule.

Five places enforce it, differently on purpose:

| Where | What happens |
| --- | --- |
| **Registration** | Refused, with both versions named. A machine joining with the wrong agent is a mistake worth catching in the terminal where it was made, while somebody is still standing there |
| **Heartbeat** | Recorded, never refused. An upgrade moves the panel first and the agents after it, so between those two moments every node is one line behind. Cutting them off would turn an upgrade into an outage |
| **Placement** | Refused. The node keeps every server it already runs and takes no new one until its agent is upgraded |
| **Rebuilds** | Refused: an update, a rollback, a rebuild, and a settings change that needs one. Each downloads its build first, which an agent from before 0.3.0 has no way to do, so it is not asked, and nothing is written. Its servers go on running as they are |
| **Ask the node** | Refused. An agent from before 0.3.0 reads a mod's download only where Build 41 keeps it, and its answer would be believed |

An agent that reports no version is not refused, and one of those from before
0.3.0 answers a download with a `404`: the panel says that the agent is older
than it and needs upgrading, and changes nothing.

The node's own page says so in a banner, and the sidebar shows what the panel
is, so the two numbers can be compared without reading a log.
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
