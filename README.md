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

- Five games, each with its own versions, settings, port layout, health policy
  and node requirements, and each run from its own image on a real node — see
  [docs/games.md](docs/games.md). Three more are written and parked
- Creating a server: pick a game, a version, a template and any of the game's
  settings over it, a node and its resources; the panel claims a port block,
  provisions it on the node and rolls the whole thing back if any step fails
- Start, stop, restart, delete, with the audit trail
- Backups that copy bytes: archived and hashed on the node, restored after the
  hash is checked — and, with an S3-compatible bucket configured on the Backups
  page, sent off-site on a URL the panel signs, so a node never holds the keys
  and a dead node leaves its backups behind. Restore from the bucket onto any
  node. Verified against MinIO — see [docs/backups.md](docs/backups.md#off-site)
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
- Update detection that works even for a game with no version number: Valheim
  moves by Steam build id, and Geeboard tracks the build id
- Accounts from the panel: **Members → Add a member** makes the account and
  hands you a one-time setup link to pass on; a reset is the same link from the
  member's row and ends their sessions. Everyone changes their own password from
  **Account**. Two-factor sign-in with any TOTP authenticator app and ten
  recovery codes, required for owners and admins, optional for the rest — see
  [docs/security.md](docs/security.md)
- Node registration: **Nodes → Add a node** names the machine and hands you a
  command that joins the panel and installs the agent as something that starts
  at boot — a container under systemd on Linux, a scheduled task on Windows
  ([docs/installation.md](docs/installation.md#a-node)). The agent works out its
  own address, makes its own secret, registers under the name and saves its
  settings; the dialog shows the machine when it turns up and lets you approve
  it. Verified on this PC three ways: the checkout as a task, a second checkout
  agent, and the container image
- Health that decays from silence rather than flipping on one dropped packet
- Moving a server to another node from its Settings: stopped, backed up to the
  bucket, provisioned and restored on the other node, started, and only then
  removed from the old one — with a rollback at every step that leaves it
  running where it was. Demonstrated between two agents on this PC
- Retiring a node from its page — move or delete its servers, drain it, remove
  it — with removal refused until nothing on the machine would be lost track of
- Terraria, TShock, Minecraft Java (Paper), Minecraft Bedrock, Valheim and
  Project Zomboid run for real from their own images on that node: created from
  the wizard, world in its own directory, live console, stop that saves first,
  files, a backup and a restore. Two Minecraft servers run side by side on one
  PC, each answering on its own port
- Minecraft (both editions), Terraria and Project Zomboid pin their versions —
  the image and the game server inside it — so a restart never moves a world to
  a build it cannot go back from
- A node's memory is what its container engine can hand out, not what the
  machine has: under Docker Desktop, the VM's 7 GB rather than the PC's 16, so
  the panel no longer places a server the engine cannot hold
- A game says where its files live: the node mounts a server's directory at the
  game's own `dataPath`. Valheim's image keeps worlds in `/config`, and mounting
  at `/data` would have left every world inside the workload
- Private ports — RCON, TShock's REST API — are published on the node's
  loopback address only
- Creation refuses a node that cannot run the game — wrong OS or architecture,
  or a capability it has not declared — and the wizard says so on the node
  before the last step
- Placement that recommends a node and shows its arithmetic
- Health checks that ask the game, not the container — with `booting`,
  `unknown` and `unhealthy` kept apart, because they mean different things
- A settings form generated from each game's own definition, which says what a
  change will cost before it is saved — and which reads the server's own config
  files first, so a value edited on the node is what the form shows, named as
  changed, instead of being silently overwritten by the next save
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
- Players read from a server's own console: who is online now, who has played and
  for how long, for games whose console announces joins and leaves
- A world's size on disk, measured on the node every five minutes
- Analytics counted from what the poller recorded — unique players, playtime,
  peak online, joins by hour, and load per server — with no figure on the page
  that nothing measured
- Members, API keys, audit log, and the audit log as a CSV download that obeys
  the filters on screen
- A read and lifecycle HTTP API at `/api/v1` — see [docs/api.md](docs/api.md)

## What does not work yet

Stated plainly, because a panel that overpromises is worse than one that does
less. See [docs/roadmap.md](docs/roadmap.md) for where each of these lands.

- **Rust, Palworld and Satisfactory are parked: written, never run, and not
  offered.** They need 12–16 GB each, more than the machine this is developed on
  gives Docker. Every game that has been run for real found bugs in its
  definition ([docs/games.md](docs/games.md#shipped)), and three of the five
  found the world would have landed outside the directory the node backs up, so
  offering an unrun game would be offering a guess. Their definitions stay in
  the repository, out of the registry, until they have been booted on a machine
  with the memory ([docs/games.md](docs/games.md#parked))
- Project Zomboid's world rules — the preset, zombie population, speed and
  respawn, day length, starting month, water and power shutoff, XP rate — are
  chosen in the wizard and written into `Server/geeboard_SandboxVars.lua` once,
  before the first start. Afterwards the settings form shows what the file
  holds and does not change it: the game rewrites the file and reads it on
  every start, so finer changes and later ones mean editing it in Files with
  the server stopped. Loot has no single knob in build 42 and is not offered
- A vanilla Terraria server that hangs after "Server started" still reads
  healthy: it is judged on its console, because a port probe crashes 1.4.5.8,
  and the query probes are not executed. Its older builds, 1.4.4.9 and 1.4.3.6,
  boot from their pinned images and survive a port probe, but have not been
  driven through the panel
- Every Valheim setting is an environment variable, so changing one rebuilds the
  server — and a Valheim rebuild re-downloads the 2.2 GB game, because its image
  installs it inside the workload rather than in the mounted directory. Its
  version is not pinned either: the image fetches the current Steam build when
  it starts, so a restart can be an update
- Minecraft Java's newest version in the catalog is 1.21.4; Minecraft itself is
  on 26.2. The version panel says so
- Player counts are read from the console, so they exist only for games that say
  who joined. Minecraft Java's lines are verified against a real client. The
  patterns for Terraria, Bedrock, Valheim and Project Zomboid are written from
  documentation, the server's known log or its own code, and none has been seen
  with a real player: treat their counts as unverified until one has joined
- Plugins and mods are not implemented: the tab on a server's page is disabled
  and the Plugins and Marketplace pages say so rather than showing a catalogue
- The panel sends no email. A new account or a password reset is a one-time link
  the admin hands over themselves; SMTP was decided against for now, so there is
  no "forgot password" that a person can start on their own
- The HTTP API covers what the panel does to servers, backups, tasks and nodes,
  and reads the audit log; it does not manage members, keys, accounts or the
  off-site bucket, stream live output, or move files that are not text. Every
  scope on the API keys page has routes behind it
- A server with no workload cannot be rolled back until it has been rebuilt
- The sample workspace (`npm run db:seed`) is fixtures: nodes with no agent and
  simulated servers, marked as such. The console page still shows a fixture log
  for those servers
- A registered node does not know where in the world it is: registration records
  its hostname as the location and `unknown` as the region, and somebody sets
  both from **Configure** on the node's page. The region is what placement
  matches against when a server asks for one
- There is no UI for rotating an agent token — a new token for the same name and
  `npm run join` again is the way
- No agent image is published: the Linux install builds it from a checkout on
  the machine, and Windows runs the checkout itself. The Windows task is
  interactive — it runs while its user is signed in, as Docker Desktop does
- Game query and RCON health probes are declared and not executed; a Valheim
  server is judged on its log, and the report says so
- No game reports its tick rate, so Analytics has no performance panel and the
  stored `tps` is a placeholder
- A **settings** rebuild has no automatic rollback: if the replacement workload
  fails to provision, the server is left in `ERROR` with its world intact and a
  Rebuild button, to be retried by hand. Updates do roll back, because they take
  a backup first
- Off-site backups have been run against MinIO on this PC, not against Amazon
  or another provider yet; the signer matches Amazon's published vectors. One
  bucket per workspace, and an archive is either on its node or in the bucket,
  never both
- A failed health check after an update does not roll back on its own — that is
  a button, because an unhealthy server is not proof the update caused it
- Migration between nodes is not implemented, so retiring a node that hosts
  servers means deleting them
- Nodes can be listed and read over the API, not drained, approved or removed
- Mods and Steam Workshop are not implemented
- A version whose image or environment changes in its definition reaches an
  existing server only when somebody presses **Rebuild on this version**; nothing
  tells them it is needed. Zomboid servers created before September 2026 are on
  the old image and need exactly that

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
