# Geeboard

An open-source game server management platform. Geeboard manages game servers
across multiple existing machines through one control panel — you bring the
machines, it runs the games on them.

It is not a Docker dashboard. Docker is how a node happens to execute a server
today; the panel, the API and the database speak in games, versions, nodes and
servers, and one of those four could be swapped without touching the others.

```
                          Geeboard Panel
                                │
                          Control API
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
        Game catalog                        Node registry
      games · versions                            │
      config · health              ┌──────────────┼──────────────┐
                                   │              │              │
                                Node           Node           Node
                              Frankfurt        Milan        Amsterdam
                                   │              │              │
                                Runtime        Runtime        Runtime
                                   │              │              │
                             Game servers   Game servers   Game servers
```

## Four things, not one

These are routinely conflated and they are not the same:

| | What it is | Who owns it |
| --- | --- | --- |
| **VPS / physical server** | A machine that already exists | You. Geeboard never buys, creates or resizes one. |
| **Geeboard node** | That machine, running the agent and registered with the panel | Geeboard knows about it |
| **Game server** | A Minecraft world, a Terraria map, a Zomboid save | Geeboard manages it |
| **Runtime** | How the node actually executes it — a container today | The node |

Placement decides *which existing node* hosts a new server. It does not
provision infrastructure, and there are no cloud provider integrations.

## What works today

- Eight games, each with its own versions, settings, port layout, health policy
  and node requirements — see [docs/games.md](docs/games.md)
- Creating a server: pick a game, a version, a node and its resources; the panel
  claims a port block, provisions it on the node and rolls the whole thing back
  if any step fails
- Start, stop, restart, delete, with the audit trail
- A live console over WebSocket, with commands going to the game's stdin
- A file manager confined to each server's own directory
- Real CPU, memory and network figures, sampled and kept
- Reconciliation: a server that crashes or is stopped by hand on the node is
  noticed, recorded and corrected
- Backups, schedules, members, API keys, audit log
- A read and lifecycle HTTP API at `/api/v1` — see [docs/api.md](docs/api.md)

## What does not work yet

Stated plainly, because a panel that overpromises is worse than one that does
less. See [docs/roadmap.md](docs/roadmap.md) for where each of these lands.

- Nodes are registered by hand; there is no registration handshake or heartbeat
  protocol yet, and node CPU/RAM figures are whatever was last written
- Automatic placement recommends nothing yet — the compatibility engine exists
  and is tested, the placement engine that ranks with it does not
- Game settings that live in a config file rather than an environment variable
  are modelled and rendered but not yet written to the node
- Health checks are declared per game and not yet executed; a running workload
  is still what "running" means
- Backups are records, not archives — nothing is copied anywhere
- Updates and crash-recovery policies are not implemented
- Mods and Steam Workshop are not implemented

## Getting started

```bash
git clone <this repo> && cd Geeboard

# Postgres
docker compose up -d

cd web
npm install
cp .env.example .env          # then fill in the two secrets
npm run db:migrate
npm run db:seed               # sample workspace + game catalog
npm run dev                   # http://localhost:3000
```

Sign in as `mara@ashfold.gg` / `geeboard`.

To attach a real machine, run the agent on it and point a node at it —
[docs/nodes.md](docs/nodes.md) and [daemon/README.md](daemon/README.md).

## Documentation

| | |
| --- | --- |
| [architecture.md](docs/architecture.md) | How the pieces fit, and which decisions live where |
| [roadmap.md](docs/roadmap.md) | Where the project is, and what each phase adds |
| [installation.md](docs/installation.md) | Running the panel, the database and a node |
| [development.md](docs/development.md) | Layout, scripts, tests, conventions |
| [games.md](docs/games.md) | Game definitions, and how to add one |
| [versions.md](docs/versions.md) | The five meanings of "latest" |
| [nodes.md](docs/nodes.md) | Nodes, capabilities, health, compatibility |
| [servers.md](docs/servers.md) | The game server lifecycle |
| [daemon.md](docs/daemon.md) | The node agent |
| [api.md](docs/api.md) | The HTTP API |
| [security.md](docs/security.md) | Authentication, permissions, node and file security |
| [backups.md](docs/backups.md) | What exists and what does not |
| [contributing.md](docs/contributing.md) | How to work on this |

## Licence

Not yet chosen.
