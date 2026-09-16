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
- Node registration: **Nodes → Add a node** names the machine and hands you a
  complete PowerShell or bash command to paste — generated agent token, a
  registration token bound to that name — then shows the machine when it turns up
  and lets you approve it. Verified on a Windows PC running Docker Desktop, which
  reports itself as the Linux node it is
- Health that decays from silence rather than flipping on one dropped packet
- Retiring a node from its page — delete its servers, drain it, remove it — with
  removal refused until nothing on the machine would be lost track of
- Terraria, TShock and Minecraft Java (Paper) run for real from their own images
  on that node: created from the wizard, world in its own directory, live
  console, stop that saves first, files, a backup and a restore. Two Minecraft
  servers run side by side on one PC, each answering on its own port
- Private ports — RCON, TShock's REST API — are published on the node's
  loopback address only
- Creation refuses a node that cannot run the game — wrong OS or architecture,
  or a capability it has not declared — and the wizard says so on the node
  before the last step
- Placement that recommends a node and shows its arithmetic
- Health checks that ask the game, not the container — with `booting`,
  `unknown` and `unhealthy` kept apart, because they mean different things
- A settings form generated from each game's own definition, which says what a
  change will cost before it is saved
- Backups that archive a world, verify it and put it back
- Crash recovery with a ceiling, growing delays and a stable window, so
  nothing restart-loops
- Scheduled tasks that actually run: backups, restarts, broadcasts, cleanups
- Updates that back up first, rebuild around the same world, and leave a
  recorded way back — and that stay within a version's line, so a Fabric server
  is never offered Paper and a Zomboid build 41 world is never offered build 42.
  A failed update keeps the world and its backups
- A container removed outside the panel — `docker rm`, a Docker reset — is
  noticed once by the poller, and the server's page offers **Rebuild**: a new
  workload on the same version around the world still on the node. The same
  rebuild is on the version panel for a definition that changed what a workload
  is given. Demonstrated on the Terraria container on this PC
- Members, API keys, audit log
- A read and lifecycle HTTP API at `/api/v1` — see [docs/api.md](docs/api.md)

## What does not work yet

Stated plainly, because a panel that overpromises is worse than one that does
less. See [docs/roadmap.md](docs/roadmap.md) for where each of these lands.

- **Only Terraria, TShock and Minecraft Java have been run from their own images
  on a real node.** The others have been exercised with stand-in containers,
  which prove the platform and not the game; Terraria's definition had five bugs
  and Minecraft's run found six more, one of which failed every Minecraft backup
  ([docs/games.md](docs/games.md#shipped)). Treat Bedrock and the Steam games as
  unverified — in particular, whether their worlds land in the directory the
  node backs up
- Minecraft Java's newest version in the catalog is 1.21.4; Minecraft itself is
  on 26.2. The version panel says so
- Restoring or deleting a snapshot on the Backups page happens on one click, with
  no confirmation — a restore replaces the world
- A failed backup says "Failed" and not why; the reason is in the activity log
- A server's world size is never measured; it reads 0 B
- A server with no workload cannot be rolled back until it has been rebuilt
- The sample workspace (`npm run db:seed`) is fixtures: nodes with no agent and
  simulated servers, marked as such. The console page still shows a fixture log
  for those servers
- A registered node's region has to be filled in by hand; the agent knows its
  address and its size, not where in the world it is
- There is no UI for rotating an agent token — re-registering the node is the way
- Game query and RCON health probes are declared and not executed; a Rust or
  Valheim server is judged on its process, and the report says so
- Player counts are not read from any game yet
- A **settings** rebuild has no automatic rollback: if the replacement workload
  fails to provision, the server is left in `ERROR` with its world intact and a
  Rebuild button, to be retried by hand. Updates do roll back, because they take
  a backup first
- Backups live on the node that made them. A machine that dies takes its own
  backups with it; there is no off-site backend yet
- A failed health check after an update does not roll back on its own — that is
  a button, because an unhealthy server is not proof the update caused it
- Migration between nodes is not implemented, so retiring a node that hosts
  servers means deleting them
- Nodes can be listed and read over the API, not drained, approved or removed
- Mods and Steam Workshop are not implemented
- **Project Zomboid's settings do not reach the game.** The image it runs reads a
  different `.ini` than Geeboard writes, and rewrites half the keys from its own
  environment on every start. Versions and updates are correct; settings are
  not. Details and the open decision in [docs/games.md](docs/games.md#shipped)
- A version whose environment changes in its definition — Zomboid build 41
  moving from `public` to `legacy41` — reaches an existing server only when
  somebody presses **Rebuild on this version**; nothing tells them it is needed

## Getting started

```bash
git clone <this repo> && cd Geeboard

# Postgres
docker compose up -d

cd web
npm install
cp .env.example .env          # then fill in the two secrets
npm run db:migrate
npm run db:seed:empty         # an owner + the game catalog, nothing simulated
npm run dev                   # http://localhost:3000
npm run poll                  # in another terminal: the watchdog
```

Sign in as `mara@ashfold.gg` / `geeboard`.

To attach a real machine — this one works, if it runs Docker: **Nodes → Add a
node**, paste the command it gives you into `daemon/` after `npm install`, and
approve the node when it appears — [docs/nodes.md](docs/nodes.md) and
[daemon/README.md](daemon/README.md).

`npm run db:seed` loads the sample workspace instead: the screens as designed,
on fictional nodes whose servers are simulated.

To check the whole thing works on your machine:

```bash
cd web
npm run verify       # unit tests and the database-backed checks
npm run verify:all   # and everything that needs real containers
```

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

Geeboard is licensed under the GNU Affero General Public License, version 3
only — `AGPL-3.0-only`. The full text is in [LICENSE](LICENSE).

In short, and not in place of the licence: you may use, study, change and share
it. If you share a changed version, or run one that other people use over a
network — a hosted panel is exactly that — you have to offer them its source
under the same licence (section 13). "Only" means a later version of the licence
does not apply unless the project chooses it.

The games are not part of Geeboard. A node pulls each game's server from its own
image, under that image's and that game's terms — Minecraft's image, for one,
is started with `EULA=TRUE`, which accepts Mojang's EULA on the operator's
behalf.
