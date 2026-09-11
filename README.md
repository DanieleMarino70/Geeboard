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
- Installation as a sequence, not a single call: provision stopped, write the
  game's own config files, then start — so a Terraria or Zomboid server boots
  with the settings it was created with rather than the game's defaults
- Live version data from Steam, GitHub and Mojang, refreshed by
  `npm run games:sync` and never by a page render
- Update detection that works even for a game with no version number: Rust
  moves by Steam build id, and Geeboard tracks the build id
- Node registration: mint a token, run the agent with it, approve the machine
  that turns up — with health that decays from silence rather than flipping on
  one dropped packet
- Placement that recommends a node and shows its arithmetic
- Health checks that ask the game, not the container — with `booting`,
  `unknown` and `unhealthy` kept apart, because they mean different things
- A settings form generated from each game's own definition, which says what a
  change will cost before it is saved
- Backups that archive a world, verify it and put it back
- Crash recovery with a ceiling, growing delays and a stable window, so
  nothing restart-loops
- Scheduled tasks that actually run: backups, restarts, broadcasts, cleanups
- Members, API keys, audit log
- A read and lifecycle HTTP API at `/api/v1` — see [docs/api.md](docs/api.md)

## What does not work yet

Stated plainly, because a panel that overpromises is worse than one that does
less. See [docs/roadmap.md](docs/roadmap.md) for where each of these lands.

- A registered node's region has to be filled in by hand; the agent knows its
  address and its size, not where in the world it is
- There is no UI for rotating an agent token — re-registering the node is the way
- Game query and RCON health probes are declared and not executed; a Rust or
  Valheim server is judged on its process, and the report says so
- Player counts are not read from any game yet
- A rebuild has no rollback: if the replacement workload fails to provision the
  server is left in `ERROR` with its world intact, to retry by hand
- Updates are **detected** but not performed — an available update is reported
  and there is no button, because doing it safely needs the backup, stop,
  install, health-check and rollback sequence written as one thing
- Backups live on the node that made them. A machine that dies takes its own
  backups with it; there is no off-site backend yet
- Migration between nodes is not implemented
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
