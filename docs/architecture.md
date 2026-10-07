# Architecture

## The shape

```
Browser
   │  session cookie
   ▼
Panel  (Next.js — server components, server actions, /api/v1)
   │
   ├── Domain      src/domain     what a game, a server, a node and a runtime are
   ├── Operations  src/lib        what happens when somebody does something
   └── Data        Postgres via Prisma
   │
   │  HTTPS + WebSocket, bearer token
   ▼
Node agent  (daemon/ — one per machine)
   │
   ▼
Docker
   │
   ▼
Game process
```

Three processes in a working deployment: the panel, the poller
(`npm run poll`), and one agent per machine. Postgres behind the first two.

## Where a decision belongs

This is the question to ask before writing anything:

> Does this belong to the panel, the node, the game definition, or the runtime?

| | Owns | Examples |
| --- | --- | --- |
| **Panel** | Business logic | users, permissions, placement, scheduling, backup orchestration, what a version *means* |
| **Game definition** | Game-specific knowledge | how Terraria is configured, what a healthy Minecraft server looks like, which capabilities Zomboid needs |
| **Runtime** | Executing a workload | limits, ports, stdin, logs, stats |
| **Node** | One machine | its Docker socket, its filesystem, its resources |

The failure mode this prevents is game knowledge leaking into the panel — a
`if (game === "minecraft")` in a page component — and machine knowledge leaking
the other way. Both have a way of spreading.

## The domain layer

`src/domain` has no database imports and, apart from the runtime adapter, no
network. It is the part that can be tested with no Postgres and no Docker, and
[test/](https://github.com/DanieleMarino70/Geeboard/tree/main/web/test) does exactly that.

```
domain/
  errors.ts              coded, safe-to-serialise failures
  access/
    permissions.ts       who may do what, to whose servers
    account.ts           password rules, and who must enrol in two-factor
    totp.ts              RFC 6238 on node:crypto
  games/
    types.ts             what a GameDefinition is
    definitions/         one file per game
    registry.ts          the list, and an audit that runs at import
    versions.ts          resolution, and the five kinds of "latest"
    providers/           steam, github, mojang — the only network in here
    config.ts            settings → environment variables and file patches
    install.ts           provision stopped, configure, then start
    workload.ts          what a workload is made from, and whether it still would be
  nodes/
    compatibility.ts     can this game run on that node, and why not
    health.ts            node health as a function of silence, not of one request
    placement.ts         which node should host this, and the arithmetic
    retirement.ts        what has to be true before a node can be removed
  runtime/
    types.ts             IGameRuntime
    docker.ts            the Docker implementation, over the node agent
  servers/
    state.ts             the server lifecycle, and reconciling it with a runtime
    health.ts            is the *game* answering, as distinct from the workload
    query.ts             what to say to a game to find out, in bytes, and what an answer looks like
    recovery.ts          whether to restart a crash, and when to stop trying
    players.ts           joins and leaves, read from console lines
    save.ts, shutdown.ts asking a game to save, and to stop, in its own words
  storage/
    s3.ts                Signature Version 4 for the off-site bucket — it signs,
                         and sends nothing itself
```

### Games are data, not code paths

A `GameDefinition` carries everything the platform needs to know about a game:
its ports, its resource floor, the node capabilities it requires, how it is
installed, every setting it has and where that setting lands on disk, what a
healthy one looks like, and which console commands mean "stop" and "save".

Adding a game is adding a definition and one line in the registry, and, for a
game that runs from an image, is configured through environment variables, files
in a format the platform can write, or command-line flags, and is judged by its
log, a port, a query or a process, that is code enough: the games page, the
wizard, the API and the compatibility engine are written so that nothing else
changes. Three more things are forced on you, and a test fails for each: a cover
in `components/covers.tsx`, a family in the reserved list when the game's family is
new, and a place in the catalog, which creating a server gives it by itself. A game
that needs a setting format the platform cannot write (JSON, YAML, TOML, XML), a
console that is only RCON, an install that is not an image, mods, or an SRV record
other than Minecraft Java's, needs shared code, and
[Extending Geeboard](extending.md) says where.

The registry audits every definition at import: duplicate version ids, two
primary ports, a template referring to a setting the game does not have,
defaults outside the game's own limits. A broken definition fails at startup
with a message naming it, rather than producing a strange server hours later.

### Runtime is an interface

`IGameRuntime` is phrased entirely in terms of a game server on a node:
`provision`, `start`, `stop`, `status`, `sample`, `logs`, `sendCommand`,
`files`. It never says "container".

`DockerRuntime` is the only implementation. It wraps the node agent's HTTP
protocol and translates its failures into coded platform errors. It does not
talk to Docker — the agent does that, on the machine. The word "image" is not
confined to it: a game's definition says that it is installed from one and names
one for each version, and the pages that show a version say what they are
showing. What stays out of the runtime interface, and out of the HTTP API's
routes, is a container: no id of one crosses either.

A server is addressed by a `RuntimeRef`: `{ serverId, runtimeId }`. Both halves
are needed. The server id names the data directory and outlives any workload;
the runtime id is whatever the runtime currently calls the thing it is running,
and is null until one exists. Files are addressed by server id, which is what
makes it possible to read a crashed server's logs and fix its config.

### State is the panel's, informed by the runtime

The runtime knows running, stopped, crashed. The panel knows creating,
installing, updating, backing up, unhealthy, suspended — states no runtime can
see, because they are things the platform is doing.

`reconcile(current, observed)` in `domain/servers/state.ts` decides what to
write. Its two rules:

- A **platform-owned** state outranks the observation. A server mid-install is
  not "stopped" because its workload does not exist yet.
- A change nobody asked for is **news**. `STARTING → RUNNING` is not; a crash at
  3am, or a container stopped by hand on the node, is.

The poller calls this on every pass. It is where drift becomes an activity event.

## Panel ↔ node

Mostly the panel asks and the agent answers. Two things go the other way, and
only those two: **registration**, because a machine the panel has never heard of
cannot be asked anything, and the **heartbeat**, because silence only means
something if there was supposed to be a sound.

The agent:

- has no database access and no business logic
- only sees containers carrying its managed label, so it can share a host
- takes a bearer token on every route except `/health`
- refuses to start without a token of at least 32 characters

Node tokens are encrypted at rest with AES-256-GCM (`src/lib/secrets.ts`) rather
than hashed, because the panel is the client and has to present them. They never
reach a browser: the console stream is proxied by the panel as Server-Sent
Events, so the token stays on the server side of that hop.

## The catalog tables

`Game` and `GameVersion` rows are a *projection* of the definitions, written by
the catalog sync — which the poller runs when the catalog is more than six
hours old, and `npm run games:sync` runs by hand. The definitions are the
source of truth.

Both exist because a definition is code, and a server that has been running for
six months needs to point at something that will still be there after the
definition it was created from is edited or deleted. So a game that leaves the
registry is marked retired, never deleted, and both foreign keys from `Server`
are `ON DELETE SET NULL`. A server also keeps its game family and version label
as plain text, which is what the UI renders; the catalog link is what gives a server
its game's behaviour (its stop and save commands, its health check, its settings),
so a server is never created without the game link, and the catalog is brought up
to the definitions, offline, whenever a row is missing.

## Errors

`PlatformError` carries a stable code, a sentence written for a person, and
optional structured details. The code is what a client switches on; the message
is what an operator reads; the `cause` is for the log and is never serialised.

```json
{ "code": "NOT_FOUND",
  "message": "No backup by that id.",
  "details": { "backup": "ckx3f9p2a0001" } }
```

An unrecognised throw becomes a generic `INTERNAL`, so a connection string in an
exception message cannot reach a client.

## What is deliberately not here

No Kubernetes, no message broker, no microservices, no event bus, no second
database, no cloud provisioning — the one thing written at a provider is a DNS
record, opt-in, from the panel alone. A modular monolith plus one agent per machine
is enough for what this does, and each of those would cost more than it returns
at this size.
