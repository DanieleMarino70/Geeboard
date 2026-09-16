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
- World size is never measured

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
