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
| `city`, `region` | Where it is, for placement preference |
| `state` | `PENDING` · `HEALTHY` · `DEGRADED` · `UNREACHABLE` · `DRAINING` · `MAINTENANCE` |
| `approvedAt` | Null means registered and not yet in service |
| `runtime` | `DOCKER` |
| `os`, `arch` | Reported by the node: the **container engine's**, not the host's. Null means it has not said — which is not the same as wrong |
| `capabilities` | What it can offer |
| `cpuCores`, `ramTotal`, `diskTotal` | Its size |
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

A game declares what it needs; a node declares what it has. Project Zomboid
needs `docker` and `steamcmd`; Minecraft needs `docker` and `java`.

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

Tested in [`test/platform.test.ts`](../web/test/platform.test.ts) and
[`test/nodes.test.ts`](../web/test/nodes.test.ts).

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

Draining does not move anything: moving servers between nodes is not built yet.

## Retiring a node

A machine leaves the fleet in three steps, and the node's page shows them as a
checklist under **Retire this node**, with where the node stands on each:

```
1  delete its servers     removes containers, worlds and backups from the machine
2  drain it               nothing new is placed there meanwhile
3  remove it              the panel forgets the node and its agent token
```

Step 1 lists the node's servers, each linking to its **Danger zone** in Settings,
where it is deleted by typing its name.

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
panel mints a token            single-use, expiring, revocable
node presents it               with its name, address and agent token
panel records it as PENDING    nothing is placed there yet
an admin approves it           and only then is it in service
```

On the panel, **Nodes → Add a node** opens a dialog that asks for three things:

| | |
| --- | --- |
| Node name | Lowercase, like `fra-node-03`. The token registers this name and no other |
| Agent address | Where the panel will reach the agent. Pre-filled with `http://127.0.0.1:8080` only when the panel itself is on loopback — anything else would be a guess about your network |
| Panel address | Where the agent reaches the panel. Pre-filled from `PANEL_URL`, or the address your browser used |

and which of the capabilities a game needs the machine should declare — each
says which games need it.

**Create the command** mints the registration token and shows a complete
command to paste on the machine, in PowerShell and bash, with a freshly
generated 64-character agent token already in it. Nothing in it is a
placeholder. From Geeboard's `daemon` directory, after `npm install`:

```powershell
$env:GEEBOARD_NODE_NAME = 'win-node-01'
$env:GEEBOARD_DAEMON_TOKEN = '<generated>'
$env:GEEBOARD_PANEL_URL = 'http://panel.lan:3000'
$env:GEEBOARD_ADVERTISE_URL = 'http://192.168.1.20:8080'
$env:GEEBOARD_REGISTRATION_TOKEN = 'gbn_…'
$env:GEEBOARD_DATA_ROOT = "$env:ProgramData\Geeboard\servers"
npm.cmd start
```

`npm.cmd`, because a fresh Windows install's execution policy refuses `npm.ps1`.
The agent's default data root is a Unix path, so the PowerShell variant puts
servers under `ProgramData`.

The dialog then waits. When the agent registers, the machine appears in it with
its platform, size and capabilities, and **Approve** is right there. It also
appears on the Nodes page, awaiting approval, for anyone who closed the dialog.

**Keep the agent token.** The agent must start with the same
`GEEBOARD_DAEMON_TOKEN` every time — it is the secret the panel presents to it.
The dialog shows it once; the registration token is needed once and can be left
out after approval.

The agent token is generated in the browser, with the Web Crypto API. The panel
never sends one to a browser: the first time it sees it is when the node presents
it at registration, and it is encrypted before it is stored.

**Approval is the security of the flow.** A registration token is a credential
that can bring a machine into your fleet; if one leaks, the machine that
registers with it must not become useful by simply waiting. Nothing is placed on
an unapproved node, and the watchdog ignores it.

`GEEBOARD_ADVERTISE_URL` is required to register, and is where the panel will
reach this node — the node knows its own routable address and the panel cannot
guess it. Registering without it is refused at startup rather than producing a
node the panel can see and cannot talk to.

**A registration token is bound to the node name it was minted for.** A
different name is refused, without spending the token, so a typo in the command
can be fixed and run again.

Re-registering an existing name is how a machine is rebuilt or its agent token
rotated: mint a token for that name — the dialog warns that it will replace the
agent registered under it. It keeps the node's approval and records the change.
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
| Memory headroom | 0.45 | What actually runs out. A node with spare cores and no spare memory hosts nothing. |
| CPU headroom | 0.25 | |
| Storage headroom | 0.10 | Rarely decides anything; breaks ties in the right direction. |
| Spread | 0.10 | Two servers on one node share a failure. Deliberately small: packing where there is room beats spreading where there is not. |
| Region match | 0.10 | A preference. A preference that refuses is a requirement wearing a friendlier word. |

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
