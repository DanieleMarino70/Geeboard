---
title: Add a node
nav_order: 3
has_children: true
---

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
memory / CPU / storage against uncommitted capacity — plus the game's own floor,
which is not the same as what the operator asked for.

Every answer carries `headroom` — what would be left after the placement — which
is what the placement engine ranks by.

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
silent 30s   →  DEGRADED      visible, not alarming
silent 2m    →  UNREACHABLE   believed
heard from   →  HEALTHY       immediately
```

Recovery is immediate and only the decline is gradual: a node we have just
spoken to is healthy, whatever it was a moment ago.

`DRAINING`, `MAINTENANCE` and `PENDING` are decisions a person made. Neither
silence nor a successful ping overrules them — reporting a node under
maintenance as a fault is how people learn to ignore the alert that is real.

Both routes feed the same `lastSeenAt`: a successful poll from the panel and a
heartbeat from the node are equally good evidence the machine is alive.

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

**Create the command** mints the registration token and shows what to paste on
the machine, in Geeboard's `daemon` directory, with Docker running:

```powershell
npm.cmd install
npm.cmd run join -- 'http://panel.lan:3000' 'gbn_…'
```

(`npm install` and `npm run join` in bash. `npm.cmd`, because a fresh Windows
install's execution policy refuses `npm.ps1`.) A declared capability adds
`--capabilities steamcmd`; an agent address adds `--advertise`.

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
