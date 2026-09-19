# Where the project is, and where it goes

## What was here before Phase 1

A working Docker management panel with a good spine and a Docker-shaped middle.

**Strong, and kept as it was:**

- The **node agent** (`daemon/`). Well-bounded, carefully commented, and right
  about the things that are easy to get wrong: log demultiplexing, CPU deltas
  that do not go negative after a counter reset, page cache subtracted from
  memory, exit code 137 read as a stop rather than a crash, containment checked
  both lexically and through `realpath`, commands written to stdin rather than
  `docker exec`, creation rolled back so nothing is left half-made, and a
  deliberate `RestartPolicy: no` so a crash stays crashed until the panel
  decides. Its integration tests exercise real containers.
- **Console streaming.** The browser never touches the agent; the panel proxies
  the WebSocket as SSE so the node token never leaves the server.
- **Creation.** Everything decided before anything is written, then written in
  an order each step can undo, with a unique index on `(nodeId, port)` turning a
  lost race into a retry instead of two servers on one address.
- **Reconciliation.** A poller as its own process rather than a timer inside
  Next, which would run once per replica.
- **Secrets.** Node tokens encrypted, not hashed, and correctly so.
- **The UI.** A real design system, coherent, not a bootstrap dashboard.

**The debt, and what Phase 1 did about it:**

| Problem | Now |
| --- | --- |
| Docker was the abstraction: `containerId` on the server row, `agentFor()` at every call site, image references in the UI | `IGameRuntime` / `DockerRuntime`; `runtimeId` + `runtime`; no image reference in any page |
| Games were a static TypeScript array of cover art and image tags — no installation, configuration, health or requirements | `GameDefinition`, eight of them, each carrying all four |
| Versions were labels. Every Minecraft "version" ran the same image with no `TYPE`/`VERSION`, so Paper 1.21.4 and vanilla 1.20.6 produced identical servers | Versions carry the environment that distinguishes them; `VersionResolver` with providers and five separate meanings of "latest" |
| Minecraft creation would have failed on a real node: `EULA` was never set | Install strategies contribute required environment |
| `ServerState` had six values, none of which could express installing or updating | Fourteen, with platform-owned states the runtime cannot overrule |
| Permissions were `role === "OWNER" \|\| role === "ADMIN" \|\| ownerId === user.id`, written out at each call site | One permission matrix, `can(actor, permission, ownerId)`, reproducing the old rules exactly |
| Nodes had load figures but no capabilities, OS, architecture or last-seen | All four, plus a tested compatibility engine |
| Errors were strings | `PlatformError` with codes, statuses and safe bodies |
| No HTTP API — API keys existed with scopes that nothing enforced | `/api/v1`, key or session auth, scopes narrowing role permissions |
| No unit tests in the panel | 50, no database or Docker needed |

## Phase 1 — Foundation ✅

Done, and the project runs.

- Domain layer: games, versions, config, runtime, server state, compatibility,
  permissions, errors
- Eight game definitions, including Terraria and Project Zomboid as new
  first-class targets
- `Game` / `GameVersion` catalog tables projected from the definitions
- `servers.containerId` renamed to `runtimeId`, beside a `runtime` column
- Node capabilities, OS, architecture, last-seen
- `/api/v1` for games, versions, nodes, servers, lifecycle and logs
- A games catalog page; Docker vocabulary out of the wizard
- 50 unit tests; documentation

**Known limitations after Phase 1** — each has a phase below:

- ~~File-target settings render to patches that nothing writes yet~~ — Phase 2
- Health policies are declared and not executed
- Compatibility is tested but not yet wired into the creation wizard
- Node capabilities are seeded, not reported by the agent
- `linkExistingServers` is best-effort; a server whose version label no longer
  resolves keeps working with no catalog link

## Phase 2 — Game system ✅

Done. Versions now come from upstream, and installing is a sequence rather than
a single call.

**Version providers.** `steam` (branches and build ids, via api.steamcmd.net),
`github` (releases, used for TShock), `minecraft-launcher` (Mojang's manifest).
A definition declares a typed source with its arguments —
`{ provider: "steam", appId: 380870 }` — so naming a provider without what it
needs is a compile error. Vanilla Terraria stays static because Re-Logic
publishes a zip with no machine-readable index, and HTML scraping is not a
version source.

**Build ids are not versions.** The important correctness decision of this
phase. Steam has no version numbers — it has branches, each with a build id
that increments. `17851234` compares above every version string any game has
ever had, so letting one into `upstream` would make every server permanently
and wrongly out of date. Build ids live in their own field, are merged onto the
version that declares the matching `steamBranch`, and answer their own question:
*has this branch moved since the server was installed?* For Rust, which has no
version number at all, that is the only update signal there is.

**The install sequence.** `installServer()` provisions **stopped**, writes the
game's config files, then starts. Starting last is the whole point: a game
reads its config once at boot, so the previous order meant every new
file-configured server ignored its own template. A failure at any step destroys
what it made — a workload the panel cannot see holds a port and cannot be
cleaned up from the panel.

**Merging, never replacing.** `mergeProperties` and `mergeIni` change only the
keys asked for, preserving comments, ordering and anything the game wrote
itself. An empty value is an absent one and is not written at all — a unit test
caught this writing `seed=` over a world seed the game had chosen.

**Network discipline.** The sync is the only thing that goes upstream. Pages and
the API read `Game`/`GameVersion` rows through `lib/catalog-read.ts`, using the
same summariser as the live resolver so the two cannot disagree. A game with no
rows falls back to its definition, so a panel that has never synced still works.

**Known limitations after Phase 2:**

- SteamCMD and download installers have no node-side implementation; every game
  still installs through an image that does the fetching itself. The strategies
  are declared because placement needs them, and `download` refuses loudly
- No JSON config writer — nothing uses one, and `applyPatch` refuses rather
  than dropping settings silently
- Settings cannot be changed after creation through a game-aware form
- The sync is manual; nothing schedules it yet
- A version removed from a definition is never retired; its row stays. Keep
  such versions with `supported: false` until that exists

**Build 42, after the fact.** Project Zomboid's build 42 went stable in July
2026, and every assumption the definition made about Zomboid became false at
once. What it exposed, and what changed:

- Version ids and labels had the channel in them (`b41-stable`), which is a fact
  about distribution, not identity. Versions now declare `formerIds`, and the
  sync renames rows in place so servers keep their links
- The update offer was "the recommended version, if you are not on it", which
  proposed Paper to a Fabric server and would have proposed build 42 to every
  build 41 world. Versions now declare a `line`, and updates stay inside it
- Two operations found a server's version by label, and a settings rebuild fell
  back to the definition's *first* version — a guess that would have rebuilt
  build 41 worlds on build 42. Both now go through the catalog link and refuse
  when it does not resolve
- The pre-catalog linker matched on number alone and linked a Purpur server to
  Paper. It now needs number and software to agree
- A sync that could not reach Steam wiped stored build ids. It now keeps them
- Still open: Zomboid's settings do not reach the game — see
  [games.md](games.md#shipped)

## Phase 3 — Node platform ✅

Done. A machine can now introduce itself, and a person decides whether to let it
in.

**Registration.** The panel mints a single-use, expiring, revocable token; the
agent presents it along with its name, its advertised address and its own agent
token; the node lands as `PENDING`. Attaching a node used to mean encrypting a
token by hand and writing it into the table with SQL — a credential handled
outside any flow that could audit or revoke it, which was the wrong way round
for the one secret that grants control of every container on a machine.

**Approval is the security of it.** A leaked registration token lets somebody
register a machine; approval is what stops that machine becoming useful.
Nothing is placed on an unapproved node and the watchdog ignores it. Existing
nodes were backdated as approved by the migration, because taking a running
fleet out of service is not an acceptable way to ship a feature.

**Heartbeat.** The agent posts its load and capabilities every 15 seconds,
authenticated with the shared secret the panel presents back to it. A failed
heartbeat is warned about and never fatal — an agent that fell over because it
could not phone home would turn a monitoring outage into a hosting one.

**Capabilities: measured or declared, never guessed.** Cores, memory, disk,
architecture and IPv6 are measured. SteamCMD and Java are not, because games run
in containers and whether the *node* has them installed says nothing — what
matters is whether the operator wants those workloads there, which is a policy
and belongs in `GEEBOARD_CAPABILITIES` where somebody signed their name to it.

**Health decays with silence.** Degraded at 30 seconds, unreachable at two
minutes, healthy the instant we hear from it again. One failed request is a
dropped packet as often as it is a dead machine.

**Placement.** `placeServer()` ranks nodes on memory, CPU and storage headroom,
spread and region preference, and returns the reasons rather than a bare score.
Deterministic — ties break on latency then name — because a score nobody can
reproduce is a score nobody trusts. The wizard shows the recommendation and a
button to take it; the operator still chooses.

**Known limitations after Phase 3:**

- The panel's own `region` and `city` for a registered node are guesses from its
  hostname until somebody edits them; the agent has no way to know its region
- Node load figures come from the heartbeat, so a node attached by hand without
  a panel URL still shows whatever was last written
- There is no UI for rotating an agent token; re-registering is the way
- Placement has no anti-affinity: nothing keeps two servers of the same game, or
  one owner's servers, off a single node

## Phase 4 — Server management ✅

Done. The panel now knows whether a game is answering, and a game's own settings
can be changed from a form generated out of its definition.

**Health is a question about the game, not the workload.** A running container is
the thing an operator most wants to believe and the thing least worth believing:
a Minecraft server out of heap keeps its container alive while refusing every
connection. The poller gathers evidence and `assessServerHealth` judges it,
which is what keeps the arithmetic testable without a node.

Four verdicts, and the distinctions between them are the whole point:

| | |
| --- | --- |
| `healthy` | Every probe that ran, passed |
| `unhealthy` | A probe failed, past the boot grace |
| `booting` | Inside the boot grace. Zomboid builds its map cache for minutes; calling that unhealthy restarts a server that was working |
| `unknown` | Nothing could be checked — **not** the same as healthy |

**One primitive on the node, and only one.** The agent gained
`GET /servers/:id/probe?port=`, which makes a TCP connection and nothing else —
no bytes written, no bytes read. Which ports to probe is the definition's
decision. The port must be one the container actually publishes, or this would
be a port scanner with an HTTP interface running on somebody's machine.

**`query` and `rcon` probes are named as skipped, never counted as passes.**
Executing them means either teaching the node to speak Minecraft's handshake and
Source's A2S — game knowledge in the one place it must not go — or giving it an
endpoint that writes arbitrary bytes to a port on request. Neither is worth
doing casually, so the report says which probes it could not run and a verdict
is never claimed on their behalf.

**A crash line outranks a passing probe.** A process that has printed
`java.lang.OutOfMemoryError` is not healthy because its socket is still open.

**Game-aware settings.** The settings page now generates the game's own fields
from `ConfigField[]` — label, type, bounds, help text, grouping, advanced
behind a toggle. Nothing about it is Minecraft-shaped, and adding a game adds
its settings page for free.

**What a change costs is worked out and shown first.** A value in a config file
can be written to a running server; an environment variable cannot, because the
environment is fixed when the workload is created. `planConfigChange` says which
each change is, and an environment change is refused until the operator asks for
the rebuild explicitly. Rebuilding destroys the workload with `withData: false`
and installs a new one around the same volume — the world, the files and the
address are kept.

**Known limitations after Phase 4:**

- `query` and `rcon` probes are declared and skipped, as above
- Player counts are still not read from any game; `playersOn` is whatever was
  last written
- Installation progress lands in the activity log rather than streaming into the
  creation flow
- A rebuild has no rollback: if provisioning the replacement fails the server is
  left in `ERROR` with its world intact, to be retried by hand

## Phase 5 — Operations ✅ (updates and migration outstanding)

**Backups copy bytes.** The node archives a server's directory to a gzipped tar,
hashes it on the way to disk, and the row records what actually happened. The
tar writer is by hand — the agent's dependencies are Docker and a WebSocket, and
adding an archive format to write a few hundred lines of POSIX header is a bad
trade. Symlinks are skipped rather than followed, and every entry is resolved
inside the server's root on the way back out.

Restoring stops the server, verifies the checksum recorded when the archive was
written, and **replaces** the directory rather than merging into it. A restore
that left files the backup does not contain would not be a restore.

Storage is `LOCAL` and says so. A node that dies takes its own backups with it;
the enum exists so S3 is a backend rather than a rewrite.

**Crash recovery is the panel's decision, with a ceiling.** `autoRestart` was a
boolean, which cannot express the thing that matters — how many times to try
before admitting restarting will not fix it. It is now a policy plus a limit,
and the old column was carried across and dropped rather than kept alongside.

Three things stop a crash loop:

| | |
| --- | --- |
| A ceiling | N attempts, then `ERROR` rather than a quiet retry forever |
| Growing delays | First restart immediate, then 30s, 2m, 5m |
| A stable window | Attempts are forgiven only once the current run has lasted |

A unit test caught a real hole in the third: Rust boots for twenty minutes, so a
fixed ten-minute window would have reset its budget *while it was still
booting*, which is a crash loop that never runs out of attempts. The window now
scales with each game's boot grace.

**Out of memory is never retried.** The server asked for more than it was given;
starting it again produces the same kill on a loop until somebody raises the
limit. It gives up and says so.

**Scheduled tasks run.** The model, the cron reader and the UI existed; what was
missing was something to notice 03:00 had arrived. `runDueTasks` fires inside
the poller process rather than as a fourth service — a timer inside Next would
fire once per replica, which for a backup means every instance archiving the
same world at once. A task more than fifteen minutes late is skipped and
rescheduled rather than run: a panel that was down overnight should not wake up
and fire six hours of restarts.

Backups, restarts, broadcasts, commands and cleanups all do their work now.
Broadcasts use the game's own wording — `say %s` for Minecraft,
`servermsg "%s"` for Zomboid — from the definition.

**Updates perform, and can be undone.** The panel could already say an update
existed and had no button. The sequence is back up → stop → rebuild → start →
record, with the backup locked so a cleanup task is not what decides whether the
way back still exists.

The asymmetry is deliberate: a **failed install** rolls back automatically,
because a workload that will not start is unambiguous. A **failed health check**
does not, because a server that starts and then reports unhealthy might be
unhealthy for reasons unrelated to the update, and silently reverting somebody's
world on that evidence would be a destructive surprise. Rolling back is a button
that says what it will destroy.

**Still outstanding in this phase:**

- **Migration between nodes.** Needs an archive to move between machines, which
  means the node-to-node transfer that node-local storage does not provide.
- **Scheduled verification** of archives sitting on disk, and pre-delete
  backups.

## Interlude — a real machine

Five phases were verified by scripts, and the panel a person opened was still the
seed data: fictional nodes, simulated start and stop, a fixture console. "Add a
node" did not work. So this stretch was spent attaching the PC the project is
developed on as a node, through the panel, and running a real Terraria server on
it — and fixing what that found, which was a lot.

**Adding a node.** The header button scrolled to a form already on screen, whose
Mint button stayed disabled with no word of why, and whose command was bash-only
with placeholders where the addresses and agent token go. It is now a dialog: a
node name, two addresses, the capabilities that matter, and a complete command in
PowerShell and bash with a generated agent token. It waits for the machine and
offers Approve. Registration tokens are bound to the name they were minted for,
which closed a hole: any token could re-register an approved node's name and
re-point it.

**What the node reported.** It said `windows`, the host, where its containers run
Linux — so every game was incompatible. It now reports the engine's platform, in
registration, heartbeat and `/version`. It reported 1 GB of disk on a machine
that had not created its data root yet, so every game was refused for storage;
disk is now measured on the nearest existing parent, and size is re-sent with
every heartbeat.

**`verify:registration`.** Every Docker-backed script wrote the agent's URL and
token into the node row, the one step a person cannot take. This one mints a
token, runs a real agent with the dialog's command against the real route
handlers, approves, and drives a server.

**An honest panel with nothing in it.** `db:seed:empty` is an owner and the
catalog. With it, the dashboard showed invented trends ("+21% vs last Saturday"),
a median TPS nobody measures, a hardcoded server count in the sidebar, a 400 GB
backup pool, and blank Console and Files pages. Each now shows what is known or
says what is not. Simulated servers are badged as such everywhere, and the
simulator had been settling *real* servers stuck mid-start into `RUNNING` on
page render; it no longer touches them.

**Terraria had never run.** Its tags did not exist or ran the wrong server; its
config was written where the image never looked; its world would have lived in
an anonymous volume; the bootstrap exited before reading config; and a port probe
crashes vanilla 1.4.5.8 outright, which crash-looped it. All definition fixes —
see [games.md](games.md#shipped).

**Found on the way, fixed:**

- A stop was a signal, and most images ignore SIGTERM: thirty seconds, then a kill,
  world unsaved. Stops now use the definition's `stopCommand` and signal only if
  the game does not leave
- A server recovery gave up on went `ERROR` → `CRASHED` → recovery → `ERROR` on
  every poll, two events each time. `ERROR` now holds while the workload is down
- The console suggested Minecraft commands on every game; it uses the
  definition's examples
- The overview's console card was the Minecraft fixture on every server; it is
  the node's real output, or a sentence saying why there is none

**Retiring a node.** An approved node could not be removed at all — rejecting
one said "drain it before removing it" and there was nothing after draining. The
node page now has **Retire this node**: delete its servers, drain it, remove it,
each step checked off, removal unlocked only at the end and confirmed by typing
the name. It forgets the record and revokes unused tokens for the name; it never
touches the machine, which is why the servers have to go first. Building it found
that deleting a server left its backup archives on the node's disk, invisible,
while saying every snapshot was gone — the agent now removes them with the data.

**Four correctness fixes.**

- *Compatibility is enforced.* It was only the wizard's recommendation; creation
  now refuses a node that has said it cannot run the game, and the wizard shows
  why on the node. A refusal across the fleet names what is missing ("every
  node: missing Java") rather than which check failed
- *Readiness is remembered per run.* A log probe reads 120 lines, and a busy
  Terraria server — judged on its console because a port probe crashes it —
  went `UNHEALTHY` once its ready line scrolled away. Verified on TShock with the
  line pushed out of the window: still healthy two passes later
- *Start arguments reach the node.* The `arg` target rendered flags that no plan
  carried. Plans, the agent's create spec and versions now carry arguments, as
  exec-form argv. TShock installs, and runs from its image on a real node
- *Tables fit beside their side panels.* Fixed column widths overflowed at an
  ordinary laptop width: the audit log's Action column rendered at zero, the
  backups table lost its snapshot names, members lost theirs

**When the workload goes missing.** Terraria Demo's container was removed from
this PC outside the panel, and the panel had no way back: the poller logged
"not found" on every pass, forever; Start fell through to the simulator and
declared a server with nothing behind it `RUNNING`; the console showed a fixture
log. Now the poller notices once — the server goes `ERROR`, its workload id is
cleared, the reason is recorded, one activity event — and the server page says
there is nothing to start and offers **Rebuild**: a new workload from the version
the server is on, around the files still on the node. Start refuses and points
at it; the console says there is no workload instead of pretending. The same
operation is **Rebuild on this version** on a healthy server, for a definition
that changed what its workload is given. Demonstrated on the real container:
removed by hand, noticed, rebuilt in a second, same world.

Building it found a data-loss bug. The installer's clean-up after a failed
install removed the server's directory — right for a new server, and the same
installer runs every update, rollback and settings rebuild. An update whose new
workload would not start (a host port taken by something else) lost the world,
and since archives now go with the data, the locked pre-update backup it would
have rolled back to. `verify:backups` reproduces it with a squatter on the port;
the clean-up now removes only the workload when there was a world before it. A
failed update or settings rebuild also used to leave the destroyed workload's id
on the row, which the next poll would have blamed on somebody outside the panel;
the id is cleared the moment the old workload is gone, and the page shows the
real reason.

**Minecraft Java, for real.** Paper 1.21.4 from the itzg image, created from the
wizard on this PC, then a second one beside it. Checked against the bare image
first, as Terraria had been. Everything a player or operator touches works —
console, stop that saves, Files, backup, restore — after fixing what the run
found:

- The container port followed the host port, so a second server published to
  nothing. Fixed at 25565 inside; both servers answer a Minecraft status ping
- The heap was the image's fixed 1 GB whatever the limit; it now follows the
  limit at 75%
- Nodes were asked for Java the image already carries
- The query port was published and switched off
- **Private ports were public.** RCON and TShock's REST API were published on
  every interface of the node. The agent now binds a port marked private to
  loopback; the two Terraria servers picked it up through **Rebuild on this
  version**
- **Every Minecraft backup failed**: the agent's tar writer stopped at 100-byte
  paths. Long paths go in PAX headers now, a restore reads the formats other
  tools write, and the table's "Verify failed" — which it was not — says
  "Failed"

Rebuilding a stopped server on its version used to start the new workload and
stop it again, thirty seconds for Terraria; it is left unstarted now. An update
still proves its new build starts, because that is where a broken build is
caught and rolled back.

**Adding a node is two lines.** The dialog's command was seven environment
variables, including an agent token generated in the browser and shown once —
and since the agent read only its environment, the same block was needed on
every start. `npm run join -- <panel> <token>` now does the rest on the machine:
it finds the address the panel reaches it on, makes its own token, registers
under the name the token was issued for, and saves its settings in the account's
profile, so `npm start` is the whole command afterwards. Demonstrated through the
panel on this PC: the dialog's PowerShell pasted as shown, approved, stopped, and
started again with `npm.cmd start` alone.

**Known limitations after this:**

- A node still needs Node.js and this repository on the machine; there is no
  packaged agent, and nothing starts it at boot
- Only Terraria, TShock and Minecraft Java have been run from their own images.
  Bedrock and the Steam games are unverified, in particular whether their worlds
  are inside the directory the node mounts
- Minecraft Java's catalog stops at 1.21.4 while the game is on 26.2
- The Docker-backed verify scripts tag a stand-in over the real Minecraft image
  name and remove the tag when they finish, so a machine that ran them pulls the
  image again on its next Minecraft create
- A server with no workload cannot be rolled back until it is rebuilt, even when
  a rollback point exists
- Terraria's GitHub version source matches tags with `"^v?\d"` in a plain string,
  which is `^v?d` and matches nothing. Fixing it would feed TShock's own version
  numbers in as Terraria's upstream, so it wants a decision about what that source
  is for rather than an escape character

## Phase 5b — The panel says only what it knows ✅

The design the panel was built from carried figures and controls that no
backend had ever stood behind: a header search and a notification bell that did
nothing, "Import a server", "2.1M servers", uptime and latency on the sign-in
page, passkeys, an invite button, "DNS is managed for you", a webhook stream, a
Source IP column that was always empty, and a settings form with four fields
that were written to the database and never reached the game. A panel that says
things it cannot know is worse than a plainer one, because nothing else it says
can be trusted either.

Everything on a page is now read from something, or the page says it is not:

- **Players** are read from each server's console — joins and leaves, as
  patterns in the game definition — and a game whose console says nothing is
  named as uncounted rather than reported as zero
- **World size** is measured on the node, every five minutes
- **Analytics** is built from the poller's samples and those sessions: unique
  players, playtime, peak online, joins by hour, load per server. No retention
  cohort and no tick panel, because neither is measured
- **Settings** keeps only what reaches the workload — name, address, memory,
  CPU, restart policy — and says when a change needs a rebuild. Everything the
  game itself reads is in the game's own form below it
- **Scheduler, Backups, Console, Files and Players** are server-scoped, with one
  tab bar and one switcher, and full task editing
- **Nodes** carry capabilities, platform, last contact and a real
  panel-to-agent latency, and **Configure** sets where a node is — which is what
  placement matches a requested region against
- **Audit** exports what the filters show as CSV; **Activity** filters in the
  query rather than on the page it happened to fetch
- Unavailable features say so: plugins and mods, invitations, two-factor,
  password reset, and the API scopes with no route behind them

## Phase 5c — Valheim, for real ✅

The fourth game run from its own image, and the second whose world would have
landed somewhere no backup could reach. The platform gained one field for it:
a game says where its files live inside the workload (`dataPath`), because
Valheim's image keeps worlds in `/config` and pointing it at `/data` is not
possible — the path is hard-coded in the image's scripts.

Three of its settings were wrong in ways only a real run shows: two named
environment variables the image does not read, and an unset password silently
became the image's default of `secret`. A field can now carry the game's own
rules about it — a minimum length, "required when this other setting is on",
"must not contain that other setting" — which is what Valheim's password needs
and what the form and the operation both check.

A console with no commands is now shown as one: `acceptsCommands` reads the
dialect, and Valheim's console streams output under a prompt that says the game
takes none rather than swallowing what is typed.

Dropped at the same time: five columns nothing read (`motd`, `javaFlags`,
`autosave`, `whitelist`, `worldSize`), the last of them a formatted copy of the
measurement beside it.

**Known limitations after this:**

- A Valheim rebuild re-downloads 2.2 GB. The game is installed into the
  workload, and only the server's directory survives one. A second mount, or an
  image that installs into the mounted directory, would fix it
- Valheim's players are not counted: its log names a character on connect and
  nothing identifiable on disconnect
- Bedrock, Zomboid, Rust, Palworld and Satisfactory are still unverified against
  their own images

## Phase 5d — Project Zomboid, for real ✅

The open decision from Phase 5 — Zomboid's settings did not reach the game — was
settled by changing the image, after checking two against each other on this
PC rather than by their READMEs. The one it ran before rewrote thirteen `.ini`
keys from its environment on every start and fetched a Steam branch on every
start, so a saved setting lasted until a restart and "build 41" became build 42
on one. The one it runs now carries a pinned build per tag, writes only the keys
it is given, and reads the game's console from the container's input.

Then it was run, and it found five things the platform could not yet say:

- **Where a game's files live can be deep.** `/home/steam/Zomboid`, because the
  image fixes its ownership there; the agent allows four segments
- **How long a game takes to stop.** `stopGraceSeconds`, measured: a save in
  under a second, the process gone after about forty-five
- **What a workload needs from its resources.** `resourceEnv`: the heap as three
  quarters of the memory limit, the allocated ports by name, and secrets
- **A secret the image demands and prints.** Random per workload, stored
  nowhere, blanked out of every console view — the admin password, which nobody
  uses; operators promote their own character with `setaccesslevel`
- **A setting read once.** `fixedAfterCreation`, for the world's sandbox preset

And one bug in the agent that had nothing to do with Zomboid: a node's memory
was the machine's, not the container engine's. Under Docker Desktop that is 16
GB against 7.7, and an 8 GB server was placed on an engine that could never
hold it. The agent now reports the smaller.

**Known limitations after this:**

- Sandbox settings beyond the preset — population, loot, day length — are a Lua
  file edited by hand with the server stopped. A Lua writer is a real piece of
  work, and until it exists the form offers only what it can apply
- Nobody has joined with a real client, so players are not counted
- Zomboid servers made on the old image need **Rebuild on this version**

## Phase 5e — Minecraft Bedrock, for real ✅

The sixth game run from its own image. Its definition tracked `VERSION=LATEST`,
which the image resolves on every start, so a restart was an upgrade; it now
pins the server version and the image, and a restart or rebuild downloads
nothing. Its second server on a node listened on the wrong port; it is now told
the one it was given.

The one worth remembering: Bedrock's save command is `save hold`, which *pauses*
saving until `save resume`, and every backup sent the first and never the
second. After its first backup a Bedrock server stopped saving its world. The
dialect can now name a `resumeCommand`, sent after every archive whether it
succeeded or not, and a `saveReady` question the backup asks until the game says
its files are ready — instead of two seconds of hoping.

**Known limitations after this:**

- Nobody has joined with a real client, so Bedrock's player patterns are still
  unverified
- A Bedrock backup carries the ~95 MB server binary, because the image keeps it
  beside the worlds. It makes a restore self-contained, and a backup larger

## Phase 5f — Parking the games that never ran ✅

Rust, Palworld and Satisfactory need 12–16 GB each, and the machine this is
developed on gives Docker 7.7 GB. Five games have now been run from their own
images, and every one of the five found bugs its definition could not show:
worlds outside the backed-up directory, settings that never reached the game, a
health probe that crashed the server, a save command that paused saving. Three
definitions that had never been booted were the same kind of guess, offered as
if they were not.

They are out of the registry and kept in the repository, each with a header
saying what has to be measured before it comes back. The catalog sync retires
their rows rather than deleting them, the wizard, the Games page and the API no
longer offer them, and the unit tests that needed a mechanism only they had — a
`text` field, an INI target, two versions on one Steam branch — import the
parked definition directly and say so.

**Known limitations after this:**

- Five games offered, three parked. Re-enabling one needs a machine with the
  memory and a real run through the panel first
  ([docs/games.md](games.md#parked))

## Phase 5g — Zomboid's world rules, written by the panel ✅

The limitation left by Phase 5d: everything past the preset was a Lua file
edited by hand. Settled the same way as the rest — by running the bare image
by hand first. The game accepts a partial `SandboxVars.lua`, fills the rest
from its defaults, rewrites the file in full with its own comments, and reads
it again on every start; and `require "Sandbox/<preset>"` from inside the file
loads the preset from the image. So Geeboard writes an eight-line file at
creation — the preset by `require`, never copied into the repository, then
the wizard's choices as assignments — and never writes it again.

What the platform gained, all declarative: two Lua config targets (`lua`,
`lua-base`) with a writer that edits both shapes of the file and refuses a key
it cannot find; `also`, for an option the game's UI sets alongside another;
`lines`, for a setting whose shape differs between version lines; a settings
panel in the wizard, drawn from the same field rows as the settings page; and
the rule that a `fixedAfterCreation` field is rendered only when a server is
created.

**Known limitations after this:**

- Loot is not offered: build 42 has no single loot rarity
- Nobody has joined the demonstration world with a client; the evidence that
  the game uses the values is its own rewrite of the file, which carries them
- Build 41 was booted once for the mechanism and its option lists, not driven
  through the panel

## Phase 5h — Players on Valheim and Zomboid, declared and unverified

Valheim's log names a character on arrival and a Steam id on departure. The
dialect can now name a `connect` pattern that captures the id before the name,
and a `leave` that captures only the id; the poller pairs them, keeps the id on
the session, and reads every fetched line for the pairing so a connection whose
two lines straddle a poll is still matched. Zomboid's patterns come from the
format strings in its server code. Both are written, tested against lines
written by hand, and not seen with a real player — which is the one thing that
would make them count. Terraria's and Bedrock's are in the same state.

Terraria's two older vanilla builds, 1.4.4.9 and 1.4.3.6, were booted bare
from their pinned images with the file and variable Geeboard gives them: both
honour `CONFIGPATH`, make the world in `/data`, answer the console and save on
`exit`. Both also survive a bare TCP connection, so the port-probe crash is
1.4.5.8's alone — which does not help, since health is per game and 1.4.5.8 is
what a current client joins.

**Known limitations after this:**

- Four games' player patterns are unverified. Each needs a real client to join
  and leave while the Players page is watched; the owner does the joining
- A hung vanilla Terraria reads healthy. The signals that would notice — a
  port probe, TShock's REST port, a console probe — each crash it, are not
  executed, or are not built ([docs/games.md](games.md#shipped))
- Terraria's GitHub version source matches tags with `"^v?\d"`, which in a
  TypeScript string is `^v?d` and matches nothing, so TShock's releases never
  reach the catalog. Fixing the escape would feed TShock's own numbers (5.2.x)
  in as Terraria's upstream. Left as it is until its purpose is decided

## Phase 5i — Accounts from the panel ✅

Until now an account was a row added with `db:studio`, a password was
whatever that row held, and `users.twoFactor` was a column nothing read.

- **Members → Add a member** creates the account and returns a one-time setup
  link, shown once like an API key. The panel sends no email — SMTP was
  decided against, a dependency and a relay to trust — so the admin hands the
  link over. Stored as SHA-256, seven days, single use, spent atomically
- **Reset** from a member's row: the same link for a day, every session of
  the account ended at once, two-factor removed when the link is used (the
  way back in with no phone and no codes). Admins cannot reset owners
- **Account** page for the signed-in person: change password (ends other
  sessions, keeps this one), sign out other devices, two-factor
- **Two-factor** with TOTP written on `node:crypto` and checked against the
  RFC vectors; ten recovery codes, hashed, shown once; codes spent by step so
  none replays; five tries in five minutes. Required for owners and admins —
  they are held at their account page until enrolled, and the API refuses
  their session — optional for everyone else
- Every step is an audit event; `verify:members` walks the whole flow

**Known limitations after this:**

- Links go by hand; there is no self-service "forgot password"
- Attempt limits are per process, like the API's rate limit
- No QR code for the secret: it is typed or opened as an `otpauth://` link

## Phase 5j — Off-site backups ✅

A backup lived on the node that made it, and a dead node took its backups
with it. Now a workspace names one S3-compatible bucket on the Backups page
and any backup — by hand, or every scheduled one — goes there.

- Signature Version 4 written on `node:crypto` and checked against Amazon's
  published examples; no SDK, for one algorithm
- The panel holds the keys, encrypted; a node is handed a URL good for one
  object for an hour and streams the archive with `node:http`, Content-Length
  set. The bytes never pass through the panel; the keys never reach a node
- An off-site row means the bucket and nowhere else: the local copy goes once
  the bucket has it. A restore pulls the archive down onto whichever node the
  server is on now, hashed and refused if it does not match
- Retention and deletion reach the bucket; forgetting the bucket leaves the
  objects and says so
- `verify:backups` starts a MinIO of its own and walks the whole thing;
  demonstrated in the panel against MinIO on this PC

**Known limitations after this:**

- Verified against MinIO only; Amazon and other providers are untested
- One bucket per workspace; no per-server or per-node buckets
- Archives are not encrypted by Geeboard before upload

## Phase 6 — Extensibility

- `ModManager`, `WorkshopProvider`
- More games, more version providers

## Phase 7 — Production polish

- Security review, structured logging with correlation ids, deployment and
  upgrade documentation, end-to-end tests

## Rules that hold across all of it

- The project stays runnable after every step
- Nothing is removed silently
- Docker stays an implementation detail
- A new game is a definition, not a change to the platform
- Complexity has to earn its place: no Kubernetes, no brokers, no cloud
  provisioning
