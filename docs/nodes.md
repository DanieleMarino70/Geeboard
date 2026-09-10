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
| `state` | `HEALTHY` · `DEGRADED` · `UNREACHABLE` · `DRAINING` · `MAINTENANCE` |
| `runtime` | `DOCKER` |
| `os`, `arch` | Reported by the node. Null means it has not said — which is not the same as wrong |
| `capabilities` | What it can offer |
| `cpuCores`, `ramTotal`, `diskTotal` | Its size |
| `cpuPct`, `ramPct`, `diskPct` | Last observed load |
| `daemon` | Agent version |
| `lastSeenAt` | Last successful contact, written by the poller |
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
is what the placement engine will rank by in Phase 3.

Tested in [`test/platform.test.ts`](../web/test/platform.test.ts).

## Health

Today: the poller pings each attached node every pass. A failed ping sets
`UNREACHABLE` and records an activity event; a successful one clears it and
updates `lastSeenAt`. `MAINTENANCE` is an operator's decision and a successful
ping does not overrule it.

Planned (Phase 3), because one failed request is not proof a machine is dead:

```
heartbeat missing 30s  →  DEGRADED
heartbeat missing 2m   →  UNREACHABLE
```

## Draining

`DRAINING` takes a node out of rotation for new placements without touching what
is already on it. `MAINTENANCE` does the same and reads as deliberate rather
than as something in progress. Both refuse creation with a message naming which.

## Attaching a node

Today, by hand: run the agent on the machine
([daemon/README.md](../daemon/README.md)), then set `daemonUrl` and
`daemonToken` on the node row. The token must be encrypted with
`encryptSecret()` from [`src/lib/secrets.ts`](../web/src/lib/secrets.ts) — a
plaintext token in that column will fail to decrypt.

A node with no agent attached is still usable: the panel keeps its records and
simulates lifecycle transitions, and says so rather than pretending. Files and
console are not available, because there is nothing to reach.

Phase 3 replaces this with a registration handshake: the panel mints a
single-use token, the node registers itself, an admin approves it, and the token
is revocable and rotatable.

## Placement

Placement chooses **which existing node** hosts a new server. It never
provisions anything.

```
Frankfurt   CPU 82%   RAM 91%
Milan       CPU 43%   RAM 54%     ← recommended
Amsterdam   CPU 61%   RAM 68%
```

Today the wizard shows each node's committed figures and refuses one that cannot
fit, with the numbers. Automatic ranking with a stated reason is Phase 3; it
will be deterministic and explainable, not a model.
