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
| `os`, `arch` | Reported by the node. Null means it has not said — which is not the same as wrong |
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

## Registering a node

```
panel mints a token            single-use, expiring, revocable
node presents it               with its name, address and agent token
panel records it as PENDING    nothing is placed there yet
an admin approves it           and only then is it in service
```

On the panel, **Nodes → Add a node**. Give the token a label you will recognise;
the secret is shown once. Then on the machine:

```bash
GEEBOARD_DAEMON_TOKEN=<32+ chars you choose> \
GEEBOARD_NODE_NAME=mil-node-01 \
GEEBOARD_PANEL_URL=https://panel.example.com \
GEEBOARD_ADVERTISE_URL=http://10.0.0.5:8080 \
GEEBOARD_REGISTRATION_TOKEN=<the token> \
GEEBOARD_CAPABILITIES=steamcmd,java,ssd \
npm start
```

The node appears on the Nodes page awaiting approval, reporting its platform,
size and capabilities. Approving puts it in service.

**Approval is the security of the flow.** A registration token is a credential
that can bring a machine into your fleet; if one leaks, the machine that
registers with it must not become useful by simply waiting. Nothing is placed on
an unapproved node, and the watchdog ignores it.

`GEEBOARD_ADVERTISE_URL` is required to register, and is where the panel will
reach this node — the node knows its own routable address and the panel cannot
guess it. Registering without it is refused at startup rather than producing a
node the panel can see and cannot talk to.

Re-registering an existing name is how a machine is rebuilt or its agent token
rotated. It keeps the node's approval and records the change; it does not
quietly re-point an approved name at a different machine without saying so.

### Without the flow

A node with no `GEEBOARD_PANEL_URL` behaves exactly as it always has: the panel
polls it, and somebody attached it by hand. Existing nodes were backdated as
approved by the migration, because taking a running fleet out of service is not
an acceptable way to introduce a feature.

A node with no agent at all is still usable: the panel keeps its records and
simulates lifecycle transitions, and says so rather than pretending. Files and
console are not available, because there is nothing to reach.

## Heartbeat

An agent with a panel URL posts to `/api/v1/nodes/heartbeat` every 15 seconds
with its load and capabilities, authenticated with the same shared secret the
panel presents back to it — two parties know it, so either direction is the same
proof.

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
