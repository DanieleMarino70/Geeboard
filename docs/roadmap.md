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
- ~~Health policies are declared and not executed~~ — Phase 4, except the
  `query` and `rcon` probes, which are still skipped
- ~~Compatibility is tested but not yet wired into the creation wizard~~ — the
  Interlude, where creation started refusing what the wizard only advised against
- ~~Node capabilities are seeded, not reported by the agent~~ — Phase 3
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
- ~~Settings cannot be changed after creation through a game-aware form~~ —
  Phase 4
- ~~The sync is manual; nothing schedules it yet~~ — Phase 5b: the poller syncs
  the catalog whenever its oldest row is more than six hours old
  (`CATALOG_SYNC_INTERVAL_MS`), and `npm run games:sync` stays as the way to do
  it by hand
- A version removed from a definition is never retired; its row stays. Keep
  such versions with `supported: false` until that exists. (A *game* that
  leaves the registry is retired — `games.retiredAt`, which is how Phase 5f
  parked three of them. `game_versions` has no such column)

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
- ~~There is no UI for rotating an agent token; re-registering is the way~~ —
  Phase 5n, from the node's page, with the node in service throughout
- ~~Placement has no anti-affinity: nothing keeps two servers of the same game, or
  one owner's servers, off a single node~~ — Phase 5n, as a term in the score

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

- ~~`query` and `rcon` probes are declared and skipped, as above~~ — Phase 5n
  runs the queries, by the second of the two roads refused above, taken on
  purpose and bounded. RCON is still skipped; no game offered declares it
- ~~Player counts are still not read from any game; `playersOn` is whatever was
  last written~~ — Phase 5b, from each game's console
- ~~Installation progress lands in the activity log rather than streaming into the
  creation flow~~ — Phase 5n: the wizard shows the installer's step
- ~~A rebuild has no rollback: if provisioning the replacement fails the server is
  left in `ERROR` with its world intact, to be retried by hand~~ — Phase 5n, through
  the rebuild an update already used

## Phase 5 — Operations ✅

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

- ~~**Migration between nodes.**~~ — Phase 5k, through the off-site bucket.
- ~~**Scheduled verification** of archives sitting on disk, and pre-delete
  backups.~~ — both in Phase 5n.

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

- ~~A node still needs Node.js and this repository on the machine; there is no
  packaged agent, and nothing starts it at boot~~ — Phase 5l: a container under
  systemd on Linux, a scheduled task on Windows. Linux still builds the image
  from a checkout, because none is published
- ~~Only Terraria, TShock and Minecraft Java have been run from their own images.
  Bedrock and the Steam games are unverified, in particular whether their worlds
  are inside the directory the node mounts~~ — Valheim in Phase 5c, Zomboid in
  5d, Bedrock in 5e; the three that could not be run were parked in 5f
- ~~Minecraft Java's catalog stops at 1.21.4 while the game is on 26.2~~ — Phase
  5n: Paper 26.2 and 26.3, on a Java 25 image
- ~~The Docker-backed verify scripts tag a stand-in over the real Minecraft image
  name and remove the tag when they finish, so a machine that ran them pulls the
  image again on its next Minecraft create~~ — they now note what the tag named
  and put it back. `verify:create` and `verify:registration` already did;
  `verify:backups` was the one still removing it, until the release work
- ~~A server with no workload cannot be rolled back until it is rebuilt, even when
  a rollback point exists~~ — Phase 5n
- ~~Terraria's GitHub version source matches tags with `"^v?\d"` in a plain string,
  which is `^v?d` and matches nothing. Fixing it would feed TShock's own version
  numbers in as Terraria's upstream, so it wants a decision about what that source
  is for rather than an escape character~~ — decided in Phase 5n: the source
  was removed

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
  password reset, and the API scopes with no route behind them. (Two-factor
  and password reset arrived in Phase 5i, the scopes' routes in 5m)

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

- ~~A Valheim rebuild re-downloads 2.2 GB. The game is installed into the
  workload, and only the server's directory survives one. A second mount, or an
  image that installs into the mounted directory, would fix it~~ — Phase 5n, by
  the second mount
- ~~Valheim's players are not counted: its log names a character on connect and
  nothing identifiable on disconnect~~ — Phase 5h pairs the Steam id with the
  name; the patterns are declared and still unverified against a real player
- ~~Bedrock, Zomboid, Rust, Palworld and Satisfactory are still unverified against
  their own images~~ — Zomboid in Phase 5d, Bedrock in 5e; the other three were
  parked in 5f, never run

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

- ~~Sandbox settings beyond the preset — population, loot, day length — are a Lua
  file edited by hand with the server stopped. A Lua writer is a real piece of
  work, and until it exists the form offers only what it can apply~~ — Phase 5g,
  at creation; afterwards the file is still the game's and the operator's
- ~~Nobody has joined with a real client, so players are not counted~~ — counted
  from Phase 5h, on patterns no real player has confirmed yet
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
- ~~A hung vanilla Terraria reads healthy. The signals that would notice — a
  port probe, TShock's REST port, a console probe — each crash it, are not
  executed, or are not built ([docs/games.md](games.md#shipped))~~ — Phase 5n:
  Terraria's own first packet, which it answers and survives
- ~~Terraria's GitHub version source matches tags with `"^v?\d"`, which in a
  TypeScript string is `^v?d` and matches nothing, so TShock's releases never
  reach the catalog. Fixing the escape would feed TShock's own numbers (5.2.x)
  in as Terraria's upstream. Left as it is until its purpose is decided~~ —
  Phase 5n

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
- ~~No QR code for the secret: it is typed or opened as an `otpauth://` link~~ —
  Phase 5n, drawn by the panel

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

## Phase 5k — Moving a server between nodes ✅

Retiring a node meant deleting its servers. Now a server moves, from its
Settings page, through the off-site bucket — the two agents never talk to
each other and are not given a way to.

- Stop, back up off-site (locked for the duration), allocate a port on the
  target, provision there stopped, restore from the bucket, switch the row in
  one write, start, and only then remove the old copy and the local backups
  beside it. Each step undone on failure; between the switch and the start the
  old workload still exists, so a target that will not start puts the row back
- `MIGRATING` is a state of its own, platform-owned like the others
- The target passes the same checks a create makes, shown before the button
- The retirement checklist offers **Move** beside **Delete**
- Two agents on one Docker engine collided on the container name; the agent
  now takes `GEEBOARD_CONTAINER_PREFIX`, which is also what lets a second node
  run on a development PC
- Demonstrated on this PC: a Terraria server moved to a second agent and back,
  running on the other side with its world, in about seven seconds each way

**Known limitations after this:**

- A move needs the bucket; there is no agent-to-agent transfer
- Local backups on the old node are removed with it, not carried across; a
  locked one blocks the move until unlocked
- The host name stays and the port may change, so players may need a new port

## Phase 5l — The agent as a service ✅

A node needed Node.js, a checkout and somebody to run `npm start`. Now the
Add a node command installs the agent as something that starts at boot.

- **Linux: a container under systemd.** `daemon/Dockerfile` runs the same
  source with tsx, given the Docker socket, the data root at the same path it
  has on the host, and `/etc/geeboard`. `deploy/linux/install.sh` builds the
  image from the checkout, runs `join` once in a throw-away container, and
  installs the unit; run again it upgrades; `uninstall.sh` removes it
- **Windows: a scheduled task** in the signed-in account, where Docker Desktop
  lives: `deploy/windows/install-agent.ps1` after `join --no-start`
- `join --no-start` registers and saves without starting the agent, so the
  service is the one thing that runs it
- The dialog's command is the install; "npm start" is no longer the answer
- Verified on this PC: the first node as the scheduled task, a third node as
  the container image — a server moved onto it and ran there, with its world
  bound from `/var/lib/geeboard` inside Docker Desktop's VM — and back

**Known limitations after this:**

- No published image; Linux builds from the checkout. Publishing needs a
  registry and a release process
- The Windows task is interactive: it runs while its user is signed in
- Inside Docker Desktop on Windows, `host.docker.internal` is not something
  the Windows host itself resolves reliably, so a bucket shared by a
  container agent and host agents has to be named by a LAN address

## Phase 5m — The API does what the panel does ✅

Four scopes were listed on the API keys page with no route behind them, and
half of what the panel could do had no HTTP equivalent. Now every operation
the panel's buttons call is a route, and every scope is real.

- **Routes:** create and delete a server, both halves of settings (platform,
  and the game's own keys with the same rebuild plan and `recreate` answer the
  settings page uses), console command, files (list, read, write, make a
  directory, delete), backups (list, create local or off-site, get, delete,
  lock, restore), rollback, move, scheduled tasks (list, create, edit, delete,
  run now, pause), the audit log, and node drain, approve, reject and remove
- Each route is thin: authenticate, rate-limit, check the permission through
  the matrix with the server's owner, then call the same `*-ops.ts` function
  the server action calls. The file operations moved out of the server
  actions into `lib/file-ops.ts` for that, and the actions call them
- A refusal from an operation comes back coded, never as a 500; the
  operation's title decides between validation, conflict and state codes
- Rate-limit buckets are per principal *and per budget*, so reads do not
  spend the ten-a-minute that creation has
- `verify:api` mints three keys and calls every route through its handler,
  with no Next server running: `requireUser` loads `next/navigation` lazily
  and `getCurrentUser` answers "nobody" outside a request, which is what made
  that possible
- All ten scopes are marked ready; the `ready` flag stays so a future scope
  cannot be issued before its routes exist

**Known limitations after this:**

- Members, API keys, accounts and storage configuration stay panel-only
- Live console output and metrics history are the browser's SSE routes
- ~~File content is text: no upload, no binary read~~ — Phase 5n, `files/raw`
- Nothing pushes: a `202` is followed by polling

## Phase 5n — What was left before a release ✅

The limitations above that could be closed on the machine this is developed
on, closed; two decisions that had been waiting, taken; and what real runs
found on the way.

**Two decisions.**

- *Terraria's GitHub source is gone.* Its tag pattern matched nothing, and
  the fix would have put TShock's numbers (5.2.x) in as Terraria's upstream,
  telling every Terraria server the game had moved past what Geeboard
  installs. A TShock release is installable the day a version is added to
  the definition, not the day it is published, so the source had no news
  anybody could act on. The `github` provider stays for a game whose tags
  are its versions
- *Queries are executed.* Of the two roads refused in Phase 4, the second —
  an endpoint that writes bytes to a port — taken deliberately and bounded:
  only a port the server publishes, on the transport it publishes it on,
  one exchange, a kilobyte out and four back, five seconds. The node learns
  nothing about any game; what the bytes mean is in
  `domain/servers/query.ts`, tested with no socket. The panel can already
  type into that game's console and write its files, so bytes to its own
  port add no power. The real risk is the one Terraria taught — the wrong
  bytes can crash a game — so a protocol is declared only after it has been
  put to the real image (`scripts/probe-query.mts`)

What the measuring found: vanilla Terraria 1.4.5.8 dies when a connection
goes away *before it has finished accepting it*, and survives its own first
packet, which it answers with a disconnect and hangs up on itself — so a hung
vanilla server is finally noticed, five minutes at most after it hangs.
Valheim answers A2S only while it is listed and crossplay is off; with this
definition's defaults it says nothing, so the probe carries a `when` and most
Valheim servers are still judged on their log. And two things broken, found
on the real server: a reply judged on its first packet alone turned a healthy
Terraria server `UNHEALTHY` the second time it was asked; and **a server that
went `UNHEALTHY` stayed so for good**, because the state that only a health
check can clear was held in a way that skipped the health check.

**Operations.**

- **Archives are verified where they lie.** A `VERIFY` scheduled task, and a
  button beside each backup: a local archive is re-hashed by its node; an
  off-site one is asked after in the bucket, and downloaded to be re-hashed
  only when the task says so, because that is its whole size in egress every
  run. Damaged is said on the Backups page and once in the activity log; an
  archive nobody could reach is never called damaged
- **A last backup before a delete**, off-site, offered in the confirmation
  and on by default when it can be taken; if it cannot, nothing is deleted.
  And off-site backups **outlive their server**: the row stays, saying what
  it was a backup of, and can be checked, deleted or restored into another
  server of the same game. Until now deleting a server dropped the rows,
  left the objects in the bucket with nothing naming them, and said every
  snapshot was gone
- **A pending rebuild is said.** What each workload was made from is
  recorded, and compared with what it would be made from today — a changed
  build, variables, ports, limits — on the version panel, beside the button.
  Four copies of the plan became one function for it
- **A settings rebuild goes back** when the new workload cannot be made:
  the same rebuild an update uses, handed the old settings. The stored
  settings go back with it
- **A server with no workload can roll back**, which is usually exactly the
  server that needs to
- **Agent tokens rotate from the node's page**, in two steps so that a
  failure at any point leaves a node the panel can still reach. Nobody is
  shown the token
- **Anti-affinity** in placement: a server of the same game on a node is a
  whole neighbour, another of the same owner's half of one, the first of
  either costing the most. It took its weight from memory and spread, and
  cannot outvote capacity
- **The wizard shows the installer's step** while it waits — the step, not a
  percentage: the node does not say how far through a pull it is
- **A QR code for two-factor**, drawn by the panel from modules made on the
  server. The one new dependency (`uqr`, no dependencies of its own): a QR
  encoder has no published vectors to be checked against, only a phone
- **Minecraft 26.** The 2026 versions need Java 25; the pinned `java21`
  image downloads Paper 26.3 and refuses to run it. Paper 26.2 (recommended)
  and 26.3 (a preview: Paper's builds for it are alpha) run on the same
  release's `java25` tag, measured bare and then through the panel
- **Valheim keeps its game between workloads.** A second kind of mount — a
  cache: beside the data, out of every backup, gone with the server — holds
  `/opt/valheim`, and a rebuild went from a 2.2 GB download to a check of
  what is there (565 s to 98 s, measured on a Windows bind mount). Reading
  the image for it found that it **updated and restarted an idle server by
  itself every fifteen minutes**; that is off
- **The API moves bytes**: `files/raw`, streamed both ways through the panel,
  capped by the node at 256 MB

**Known limitations after this:**

- Valheim's version is still not pinned: Steam gives an anonymous login the
  current build and nothing older, so a start after Iron Gate ships is an
  update. It is no longer one that happens by itself
- Most Valheim servers are not queried (unlisted, or crossplay on), and RCON
  probes are not executed at all
- A version removed from a definition is still never retired
- No JSON config writer: no game offered, or parked, has a `json` setting
- No webhooks: a `202` is followed by polling. Decided against for this
  release — delivery, retries, signing and a page to manage endpoints are a
  feature of their own, and polling says nothing false in the meantime
- A workload made before Phase 5n has no record of what it was made from, so
  nothing is said about it until its next rebuild. Zomboid servers from
  before September 2026 are the known case, and still need one
- A cache mount does not move with a server; the other node downloads its own
- The file manager in the panel is still text; bytes are the API's

## Phase 6 — Extensibility, and what 1.0 says

Version 1.0 is declared when this is true, and not before:

> **Adding a game that runs from an image, is configured through environment variables,
> files in the formats Geeboard writes or command-line flags, and is judged by its log, a
> port, a query or a process, is a definition file and a registry line. Adding a node
> needs no change to the panel. Adding a DNS provider is one table entry and one client;
> any other is a webhook and needs none. Adding an S3-compatible storage is one preset.
> None of them changes the architecture.**

[Extending Geeboard](extending.md) is that sentence's proof: a recipe for each of the ten things
people add, what stops you if you forget a step, what nothing stops you from forgetting, and a test
that fails when the page and the code part. What the sentence leaves out — a store that is not
S3-compatible, a game whose console is only RCON, a setting format the panel cannot write, an
install that is not an image, mods for a second game, a runtime other than Docker, an architecture
other than x64 — is written there as the edge of the promise, because each of them is shared code,
not data. From 1.0 on the API and the two webhooks only grow inside a major version, and a release
only adds to the database (the same page, "The promise").

- `ModManager`, `WorkshopProvider` (Project Zomboid's mods are the first, written for it)
- More games, more version providers: [Extending Geeboard](extending.md)

## Phase 7 — Ready to install ✅ (for the first release)

Until now the only way to have an account was `npm run db:seed`, which wipes
the database and creates `mara@ashfold.gg` with the password `geeboard`
written in the source. A panel somebody cloned and put on a VPS was a panel
with a published password on it. That is what this closes.

**The first owner.** `npm run setup` — migrations with `prisma migrate deploy`
(never `migrate dev`, which may offer to reset), the game catalog from the
definitions, and **one** `OWNER` with a temporary password: random, shown once
in the terminal, stored only as a hash, good for 24 hours. Signed in with it,
the account sees nothing — every page redirects, the API refuses the session —
until it has been replaced with a password of the person's own, and only then
is two-factor asked for. That order is the point: a second factor enrolled
behind a password somebody else read off a terminal is not yours.
`accountGate()` is the one answer the pages, the API and the account page ask.

`setup` refuses once any account exists, in a serializable transaction so two
runs cannot both make an owner. `npm run admin:recover` is the way back in for
a lost temporary password, a day that ran out, a forgotten password or a lost
phone: a new temporary password, two-factor removed, every session ended, and
`installation.owner.recovered` in the audit log. Being able to run a command as
the panel is the proof of being the administrator — there is no web equivalent,
because on a VPS the first visitor to a new port is as often a scanner as the
installer.

The seed says what it is: `db:seed` and `db:seed:empty` refuse to run with
`NODE_ENV=production`, and the sign-in page mentions their credentials only
where that account exists.

**Running it.** `web/Dockerfile` — one image, five verbs (`panel`, `poller`,
`migrate`, `setup`, `recover`) — and `deploy/panel/docker-compose.yml`, which
publishes the database nowhere, has no default for any secret, and puts the
panel on loopback for a reverse proxy. `deploy/panel/init.sh` generates the
three secrets into a file it never overwrites. Without Docker,
`deploy/panel/systemd/` runs the same thing from a checkout.
[production.md](production.md) is the path from `git clone` to signed in;
[upgrading.md](upgrading.md) is the release after, and was tried: a database
left exactly as the previous release makes it, backed up, migrated, restarted —
rows intact, and the dump restored into a second database to match.

**What the panel refuses to start with.** In production: a missing
`DATABASE_URL` or one still on the development password, a secret missing,
short, identical to the other, or **looking like an example**. That last is why:
`.env.example` shipped `generate-with-openssl-rand-base64-32` in both secrets —
thirty-six characters, long enough for any length check, and printed in a
public repository.

**Structured logs with a correlation id.** One JSON object a line (a readable
line at a terminal), and an id made for every request by `src/proxy.ts`,
answered back as `x-request-id`, carried through everything the request does
with `AsyncLocalStorage`, sent to the node agent on every call, and logged
there too. The poller makes one per pass. So a backup that failed at 03:00 is
one string to grep for across three processes. No logging library: it is a
timestamp, a level, a message and some fields.

**A security review of the whole project**, which found the one that mattered:
**every page carried the signed-in person's whole `User` row into the payload
the browser receives** — `passwordHash` and the encrypted `totpSecret`
included — because the shell is a client component and each page handed it the
row. TypeScript was happy; only reading the bytes on the wire showed it.
`shellUser()` narrows it and `test/shell-user.test.ts` fails if a page stops
using it. Also found and fixed: a production compose file that shared its
project name with the development one, so `docker compose down -v` would have
taken the developer's database and its volume with it.

**CI**: `.github/workflows/ci.yml` — lint, typecheck, unit tests of both
packages, `npm run verify` against a Postgres service, the production build,
and a build of the panel image. The Docker-backed scripts stay local, and the
workflow says where they are.

**Known limitations after this:**

- One instance. Sign-in limits, two-factor limits and the API's rate limit are
  counted in the panel's process, and the poller must be single — two would
  each fire every scheduled backup. Said in
  [security.md](security.md#one-instance-and-what-changes-with-more)
- The panel image carries its development dependencies, because the poller, the
  setup and the migrations are the repository's own TypeScript. It is about
  1.8 GB
- ~~Nothing rotates `SECRETS_KEY`. Changing it means registering every node again~~ — 0.4.1, `rekey`
- No published image yet, for the panel or the agent — that is the release
  workflow, Phase 8
- ~~The sign-in form has not been driven from a browser by a machine here: the
  flow was proved through the operations, the gate against a running panel, and
  TLS through the documented Caddy configuration~~ — driven from Chrome by a
  script outside the repository since 23 September 2026, password and
  two-factor, for every proof of 0.3.0 in the running panel; nothing in the
  repository repeats it

## Phase 8 — A release somebody else can install ✅

Phase 7 made the panel installable. This one made it findable, versioned, and
possible to upgrade without guessing — and closed the "no published image" that
every phase since 5l had been carrying.

**The documentation site.** GitHub Pages serving `/docs` on `main`: Jekyll runs,
Jekyll fetches `just-the-docs` from its own repository, and there is no build of
ours to maintain. The pages are the same Markdown that reads on GitHub; the only
site-only syntax in them is the front matter at the top. Three things were
checked against a site built with the `github-pages` gem itself rather than
against its documentation. No document contains the doubled braces or the
brace-percent that Liquid would take for a tag of its own — and this sentence
does not write them either, because Jekyll runs Liquid before Markdown, so a
code span is no shelter and an unclosed one fails the build. Tables and code
blocks come out: 29 tables and 92 blocks over 21 pages. And a crawl of the
served site followed 622 internal links with no `href` left pointing at a `.md`
file and no missing anchor. Twenty-one links left `docs/` for `../web/src` and
`../LICENSE`, which a site served from `/docs` would have answered with 404;
they are absolute GitHub URLs now, valid in both places. Four pages were
missing and are written — a home page, troubleshooting, a Reference front door,
and one page for what does not work yet — and the README dropped from 315 lines
to 78: what it is, the commands to try it, the link. Its inventory of what works
was not deleted; it is `what-works.md`.

**Versioning.** `0.1.0`, and an honest `0.x`: the minor is where a breaking
change lands until 1.0. The number comes from `package.json` on both sides and
nowhere else — `next.config.ts` inlines the panel's, which the sidebar shows
under the name, and `loadConfig` reads the agent's, which `GET /version` had
been answering with a literal that two files had to agree on and never would
have.

**What happens when the two halves disagree.** They work together when they
share a release line — `major.minor` below 1.0, the major from 1.0 on — and the
rule is enforced three different ways, each of which would be wrong in place of
the others. Registration refuses, naming both versions, because a machine
joining with the wrong agent is a mistake worth catching in the terminal where
it was made. The heartbeat records and never refuses: an upgrade moves the panel
first and reaches the agents after, so in between every node is one line behind,
and refusing there would turn an upgrade into an outage. Placement refuses, so
the node keeps every server it runs, takes no new one, and says so on its own
page. A version nobody reported is unknown rather than wrong. See
[nodes.md](nodes.md#panel-and-agent-versions).

**The release.** A `v*` tag runs the whole of CI — the same jobs, called rather
than copied — refuses a tag that disagrees with either `package.json` or has no
section in `CHANGELOG.md`, pushes the panel and the agent to GHCR under the
version, the release line and `latest`, and opens a draft release from that
section. `deploy/linux/install.sh` pulls the tag matching its checkout and
builds from `daemon/` only when the pull does not work. `CHANGELOG.md` is
written for whoever installs this, not for whoever wrote it.

**Proved, not asserted.** The site answers at its real address, every page 200,
with `games.md` served as `/Geeboard/games.html`. Both images are pullable with
an anonymous registry token. The release workflow ran green end to end. And the
release-line rule has its own check, `verify:versions`, which walks all three
enforcement points and fetches the node's page from a panel it starts — because
a banner that exists in a component and not on the page is not a banner.

**What walking the installation as a stranger found**, on a copy of the tree
with no `.env`, an empty database and only the published pages to go on:

- The seed gave its fixture nodes a made-up agent version. Harmless while
  nothing read it; the rule above reads it, and every node in the sample
  workspace was refused every game
- `verify:console` served the panel with `next start`, which runs in production,
  where the panel refuses a `DATABASE_URL` still on the development password.
  That gate is right and no check against the development database can get past
  it, so the check starts a development server of its own
- Three checks that start a panel shared one build directory, and stopped it by
  signalling the npm wrapper rather than the server it started — invisible on
  Windows, where `taskkill /T` takes the tree, and a CI failure on Linux. One
  module holds both fixes now
- `setup` told everybody to run `npm run admin:recover`, the Docker
  installation included, where there is no npm
- `install.sh` wrote `GEEBOARD_IMAGE` once and never again: with versioned tags,
  an upgrade that pulls the new image and leaves the unit starting the old one
- `verify:registration` asserted eight games in the catalog. Three were parked
  in September and it kept passing anyway, because a database that has seen a
  catalog sync keeps the retired rows

**Known limitations after this:**

- Windows still runs the agent from a checkout rather than an image, and its
  scheduled task is interactive
- The images are not signed and carry no SBOM
- Publishing a release is still a person pressing a button on a draft, on
  purpose: the notes deserve a read before they are public
- ~~The sign-in form has still not been driven from a browser by a machine
  here~~ — since 23 September 2026; see Phase 7

## After 0.1.0

The release is out, so what follows is not a phase in the plan the first eight
were: it is the work that the first installations asked for. Written down as it
closes, one part at a time, rather than after.

### The games have covers ✅

Every game was a striped rectangle with a two-line abbreviation in it, in seven
places — the dashboard, the servers list, a server's page, a node's page, the
Games page and twice in the create wizard. The definitions carried no artwork,
because artwork is the one thing a game's own publisher owns.

**They are drawn here.** Flat shapes in `components/covers.tsx`, keyed by a
definition's id: a grass cube for Minecraft Java and a stone one for Bedrock, a
world in layers for Terraria, a mountain and a rune for Valheim, a town at night
for Project Zomboid. No gradients and no ids in the markup, because a list can
hold ten of them; no files and no requests, because a panel is expected to work
with the network gone.

Committing the real key art would have handed every fork of an AGPL project a
licence problem it did not choose, and pulling it from a store's CDN would have
put the same artwork in the panel anyway, needed the network on every render and
covered neither Minecraft. The operator uploading their own is the third answer
and stays possible — but a new installation would still have to start with
something, and this is that something.

**A game with no cover drawn falls back to the striped square**, which is what
`art` on a definition has been for all along: the seed's `nightfall`, whose
catalog row is missing, shows it beside servers that have a cover, and
`test/covers.test.ts` fails when a game in the registry has none.

### Phase 6 opens: mods, and Project Zomboid takes them ✅

The phase that was two lines — `ModManager`, `WorkshopProvider` — starts with
the game whose server already knows how to do the hard part. Project Zomboid
reads two keys out of its own settings file on every start: `WorkshopItems`,
which it downloads from Steam by itself, and `Mods`, which it loads. So the
panel writes those two keys and nothing else. No mod's bytes pass through it,
no package manager is invented, and the node does what it was always going to
do — measured first, on 41.78.19, before a line was written.

**The two lists are not the same list.** One Workshop item can carry several
mods, and the name the game loads a mod by lives in a `mod.info` inside the
download, which only the node can read. Guessing it from a Workshop description
is how a server is told to load a mod that is not there, which for Zomboid is a
refusal to start — so the agent answers one new question, `GET
/servers/:id/mods`, and the panel writes the load list from what came back.
That changes the contract between the halves, so this is **0.2.0**, and a node
still on `0.1.x` is refused until its agent is upgraded.

**The tab is a shelf, not a text field.** Nobody knows a mod by its id: the
Mods tab searches the Workshop with pictures, sizes and subscriber counts,
takes a pasted link where an installation has no Steam key, keeps a load order,
and switches a mod off without losing its download. Applying takes a backup
first, because a mod is the one change that can break a world rather than a
workload.

Proved rather than asserted, in `verify:mods`: a Zomboid server created through
the panel's own operation, two real Workshop mods added, applied, downloaded by
the game on the node, their real ids read back off disk, loaded, the world
restarted with them, one switched off, one removed, and the world started again
without it. Thirty-one checks, and the two mods are somebody else's: Let Me
Think and Tsar's Common Library.

What is still not true is in [limitations.md](limitations.md): nothing checks a
mod against the game's build, dependencies are the operator's to work out,
Minecraft plugins are a different mechanism and are not implemented, and the
HTTP API does not manage mods.

### The documentation site is built here now

Phase 8 put the site on GitHub Pages the cheapest way there is: Jekyll runs,
Jekyll fetches `just-the-docs` from its own repository, and nobody here builds
anything. It worked, and it cost three things. The theme is not ours, so a
project with a design system of its own — `web/src/components/ui.tsx`,
`design-canvas/` — looked like every other `just-the-docs` site. Liquid runs
before Markdown, so a pair of braces inside a code block is a template tag and
an unclosed one fails the build, which has happened. And the first thing a
visitor saw was a presentation, with the installation on a VPS filed inside a
menu.

**`docs-src/build.mjs` builds the site now**, out of the same Markdown, with
`marked` as its one dependency — at build time, in a `node_modules` no visitor
ever meets. The design is `design-docs/DESIGN.md`: obsidian surfaces, hairline
borders, one lime accent kept for primary actions and the active page, Geist
and JetBrains Mono. `design-docs/code.html` draws it with Tailwind and Google
Fonts off two CDNs; here the stylesheet is written out by hand and both fonts
are served from the site, because documentation that needs somebody else's CDN
to be legible is documentation that goes dark when they do.

**Installing on a server is the first page**, and the home page's own
invitation goes there rather than to an index. The three levels of reading are
in the navigation instead of implied — set it up, run it day to day, know how
it is built — and the three pages of an installation carry a rail that says
which of the three steps you are on without scrolling. No page was rewritten
and none moved house: the ordering is `docs-src/nav.mjs`, and the Markdown is
untouched.

**Every address the old site served still answers.** One HTML file per
Markdown file, flat, named the same — `reference.html` is linked from outside
this repository and cannot move. `check-links.mjs` walks the built site and
fails on a link to a file that is not there, on a fragment that matches no
heading, on an address that has stopped answering, and on a code block whose
characters are not the ones in the Markdown. It earned its place on the first
run: anchors were being generated with runs of spaces collapsed, and
`versions.md#lines--what-counts-as-an-update` — two hyphens, because GitHub
turns each space into one — was a 404 that nothing else would have caught.

**The search searches.** It is built from the same parse as the pages, one
entry per heading, and it is loaded when the palette is first opened rather
than on every page.

The switch was one setting in GitHub's own interface — the repository's Pages
source, from "Deploy from a branch" to "GitHub Actions" — and the order was the
point: until it was flipped, the workflow built and checked the site on every
push and published nothing, and the Jekyll site kept answering. It is flipped,
the served site is this one, and the front matter in each page and
`docs/_config.yml` are gone with it. They were Jekyll's, they went after the
switch and not before, and a reader on GitHub gets one fewer table of
metadata at the top of every page for it.

### The mark exists as a file

There was a logo and there was no logo file. The artwork lived in one PNG
sheet — ten variants and a palette — and everywhere the product says its own
name it said it with a placeholder: a lightning bolt from lucide in the
panel's sidebar and on its sign-in page, a lime square in the site's top bar,
and, in the browser tab of every installation, the favicon the Next.js
starter ships with. Vercel's triangle, on somebody else's panel.

**The mark is redrawn as SVG**, in `brand/`: a hexagonal ring opened into a G,
a rack of three units inside it, a node on a wire in the mouth. It is one path
of about 1.3 KB, wound so that overlaps merge and the dot on each unit is a
hole rather than a second colour, which is what lets the same file be the mark
at 128 px and still read at 16. The wordmark is not traced: "Geeboard" is set
in Geist, which both halves of the project already serve, so the lockup is
text and not a picture of text.

**It takes `currentColor` inside the product.** The artwork's green is
`#00E676` and the product's accent is lime; two greens seventy degrees apart
on one screen read as a theme that has broken rather than as a logo beside an
interface. So the mark is the accent where it sits next to one — lime in the
site, `--accent` in the panel, the darker green of the light theme when the
panel is in it — and the brand's own green is kept for where the mark stands
alone: the browser tab, the link preview, the README.

The panel carries its own copy of the path, because the panel's image is built
from `web/` and a file outside it is not in the build context. That is a copy,
so `web/test/brand.test.ts` reads both and fails on any difference — the
failure mode of a duplicated logo is a fork of it, not a missing one.

What is left is a setting, as it was with Pages: the repository's social
preview image is uploaded in GitHub's own interface, from `brand/og.png`.

### The name and the mark are reserved

Writing the mark down made the question unavoidable: the code is
`AGPL-3.0-only`, which says anybody may fork, change and host it, and says
nothing about a name. `brand/LICENSE.txt` answers it — the software is yours,
the badge on it is not — without touching `LICENSE`, which is the licence
text and is not ours to edit. Nominative use stays: a fork may say what it is
built from. What it may not do is present itself as Geeboard to somebody
installing it, who is the person the mark is for in the first place.

### The panel installs in one command (0.2.2)

Installing Geeboard for real was a page of commands, each of them right and all
of them the reader's to sequence: `init.sh`, a line echoed into `.env`, a pull,
a setup, Caddy installed, a `Caddyfile` copied and edited down to one of its two
blocks, and — for whoever had worked out that it applied to them — a node joined
with `--panel-ca auto`. Somebody who wanted a Minecraft server for their friends
read about certificate authorities first. And after 0.2.0 a fresh checkout on
some machines stopped at "Permission denied", so the advice going around was
`chmod 777` on a directory holding three secrets.

**`deploy/linux/install-panel.sh` is that page as one command**, eight stages
printed as they happen, two questions — a domain name or not, and who the owner
is — and a last request to the finished address to see that it answers. What it
never does is the half that matters: a second run regenerates no secret that is
there, removes no volume, server or backup, and leaves an edited `Caddyfile`
alone. Running it again is the upgrade and the repair. Without a domain name it
detects the public address, writes `tls internal`, waits for Caddy's authority
and copies it to `/etc/geeboard/panel-ca.crt`, where the node installer on the
same machine finds it untold.

**The panel decides `--panel-ca`, not the reader.** One thing settles it —
whether the panel's own address is an address or a name — and the panel is the
half that knows: `needsPanelAuthority` reads the URL the node is given, and the
Add a node dialog writes the option into the command itself. `auto` stopped
meaning one fixed path, which was wrong on every node that is not the panel's
machine, and names the one thing to do where the authority is absent. A Windows
node became one line too, `-ExecutionPolicy Bypass` included, because a fresh
Windows refuses every `.ps1`. The installers repair execute bits and Windows line
endings to `0755`, never `777`, and the documentation was rewritten around them:
[production.md](production.md) is the three commands, and everything as separate
commands is [advanced-install.md](advanced-install.md), which is what the
installer runs.

**Files got their buttons.** `PUT /files/raw` had written a file beside its
target and renamed it into place, refused anything outside the server's
directory and stopped at 256 MB since Phase 5, and `verify:files` had proved
it; what was missing was a button, so installing a jar meant `curl`. The Files
page uploads from a toolbar or a drop, with a bar while it goes and a question
before a name is written over, and every row downloads. XHR rather than
`fetch`, because `fetch` says nothing while a request body goes out, and a
200 MB modpack with no progress is a page that looks broken.

The same release let the wizard reach the checkbox that unblocks it — the
resources step refused a node short of memory before the review step could
offer to overcommit it — and put the mark on the three screens that still wore
a placeholder. It had been numbered 0.2.1 first; that tag was never pushed, so
no image was ever built, and a version nobody could install gave up its
section, as one had before 0.2.0.

### An address has to be an address (0.2.3)

On a fresh VPS the installer asked for "the address browsers will use" one line
after a question that really was yes or no, and got `y`. Every stage after it
did exactly as told: `PANEL_URL` became `https://y`, Caddy issued a certificate
for a site called `y`, the owner was created, and only the last stage noticed,
eight stages downstream. An address now has to be an IPv4 or IPv6 address or a
name with a dot in it, and digits and dots that are not a valid address are
refused rather than taken as names. The reason it reached a release was that
`deploy/` could not fail anywhere: `deploy/lib/verify.sh` is forty-two checks
over the installers' pure helpers, and CI runs it with a parse of every script.
A release of the installer and nothing it installs, so a running installation
needed nothing from it.

### A game's minimum is advice, and a collection can be pasted (0.2.4)

**The minimum.** Project Zomboid asks for 6 GB, and a person with a 4 GB machine
and three friends could not ask for less: the minimum was the slider's floor,
the settings field's, a refusal in `createServerOp` and a failed compatibility
check — four gates saying that this catalogue's opinion of somebody else's
hardware outranks an operator's about their own. It says what it thinks now —
"Project Zomboid asks for 6 GB. With 3 it may fail to start, or run until the
world grows and then stop." — and gets out of the way. `cpuPctMin`, declared by
every game and read by nothing, got the same warning. What still refuses is
what is not a judgement: the platform's floor, a game's ceiling, the node's
capacity unless overruled, and a disk too small for the image, which is not a
slow server but a download that cannot finish.

**Collections.** Zomboid is told item ids and cannot download a collection, so
pasting one's link expands it — keylessly, like an item — and shows what is in
it before anything is added. What Steam returns was measured across 235
collections first: up to 805 items, collections that link each other, chains
three deep, a linked collection repeating 180 of its 181 items.
`domain/games/collections.ts` walks that, each item once and each collection
once, and stops at 1,000 items or 50 collections, saying so. A pasted
collection had been offered as a mod of size nothing, which Apply would have
written into `WorkshopItems`; that is refused now, and so is another game's
item.

**The Steam key from the Mods tab**, by an owner or admin, tried against Steam
before it is kept, encrypted in a one-row table and never sent back.
`STEAM_API_KEY` in the environment still wins, and the tab says so.

**And the tab could be reached.** It was greyed out on every server page but
its own, so nothing in the panel led to it: the tabs now work out from the
server's game that it takes mods. Taking that fix is what made Build 42's
problem visible — mods downloaded and never loaded — so the release said so in
its notes, and the fix came with the agent in 0.3.0.

### Mods load on Build 42 (0.3.0)

Since 0.2.0 the Mods tab had worked on the build nobody was being offered.
Build 42 went stable in July and the wizard recommends it, and a Build 42
download keeps its `mod.info` in a folder per game version beside a `common/`
folder; the agent looked only at the top of each mod, where Build 41 keeps it.
So on a Build 42 server every mod was downloaded, called *waiting*, and never
written into the load list. `verify:mods` had not seen it because it only ever
made a Build 41 server.

**Measured before it was written**, on the two images, with test mods whose Lua
printed which folder they had been read from — seven starts of the game rather
than one reading of a wiki. Build 42 reads exactly one version folder, the
highest whose major.minor is not above its own (`42.20.5` on 42.20.4, the
patch not counted; `42.10` over `42.9`), together with `common/`; its
`mod.info` is that folder's, or `common/`'s when it has none, and there is no
falling back to a lower folder. The top of the mod is not read at all. Build 41
reads only the top. Both honour `versionMin` and `versionMax` on major.minor,
and both refuse a bound that is not one (`versionMax=42`). And the measurement
contradicted what this project had written down since 0.2.0: **a load list
naming a mod the game cannot find is not a refusal to start**. On both builds
the game logs *required mod not found* and starts without it — which is worse,
because nothing says so.

**The agent reports, the panel decides.** The agent's answer changed shape —
every mod directory, the folders in it, every `mod.info` with its bounds and
its `require` — and it chooses nothing, because which folder a build reads is a
fact about one game and belongs in its definition (`layout`, `buildTags`). The
panel keeps what the node found rather than a verdict, and judges it against
the server's version whenever it is read, so an update that moves the game is
judged again without asking the node. A mod the build will not load stays out
of `Mods` and its row says why. That is a changed contract, so it is 0.3.0,
and a panel does not ask an agent on another release line what a download
contains: an old agent's answer would be believed.

**The tags warn, the files decide.** Before anything is downloaded, the
Workshop's tags are the only word on which build an item is for: a
collection's preview counts them and a single mod tagged for the other build
is added with a warning. They are never used to refuse, because they are the
author's. The panel used to keep an item's first six tags only; a build is a tag
like any other and not always among the first, so it keeps twenty.

Proved in `verify:mods`, which now runs once per build, one after the other:
three real mods on each — two for that build and one for the other — applied,
downloaded by the game, read back, the load list written without the third,
and **the game's own console read** for the two it loaded.

**The proof in the running panel found what the scripts had not.** On the
server this was built against, with the Rawt Building Craft collection, Ask
the node found five Build 42 mods and the panel called all five ready; the game
loaded two. The other three `require=` tile packs the collection does not
carry, and the game — measured afterwards with test mods, on both builds —
skips a mod whose requirement it cannot find, and whatever requires that one,
while it loads a requirement it has whether or not it is listed. So a mod's
requirements are judged too, across the whole server at once, and the row
names what is missing. One difference between the builds: Build 42 reads
`require=\X` as `X`, and Build 41 looks for a mod called `\X`.

Reading the console is what found the next one. On Build 41 the console said
nothing about loading either mod although the settings file named both a moment
earlier: a start that downloads Workshop items writes the settings file again
once they are in, from what it read as it started, and the load list written in
between was gone. In between is exactly when the node first has the files, so
the order an operator follows — restart, Ask the node, Apply — lost the list,
and had since 0.2.0; the old check read the file straight after writing it and
never saw it go. Apply now waits for the game to say it has started. Two more
things the runs taught: Steam writes an item into its folder as it arrives, so a
folder with no `mod.info` in it is a download still going rather than an empty
one; and Build 41's Steam client can sit on a finished download for ten minutes
— *Staging library folder not found*, over and over — and finish it in under a
minute on the next start.

### The panel's fonts are in the repository

The documentation site has served Geist and JetBrains Mono from itself since
it was built here, because documentation that needs somebody else's CDN goes
dark when they do. The panel was still asking Google Fonts for the same two
families on every build and every development server, and one September
evening every page of the development server answered 500 in CI — and not on
this PC, from the same commit — with *next/font/google queries have exactly one
entry*. Turbopack rewrites each font URL into a request of its own that carries
the original as its one query entry; an original with a query string of its
own, the form Google uses for fonts it serves dynamically, makes a second entry.
That is inferred, not seen — the CI's copy of Google's answer is not kept — but
it is the one answer that reproduces the error: handed to the old layout
through `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, the same 500; handed to the new
one, nothing, because the new one does not ask: `next/font/local`, with copies of
the site's two files under `web/src/app/fonts` — copies, because the panel's
image is built from `web/` alone, and `test/fonts.test.ts` refuses any
difference between the two. Geist's file covers Latin, Latin Extended, Cyrillic
and Vietnamese; this JetBrains Mono covers Latin-1, and a monospace letter
outside it falls back to the system's.

Looking at the running panel to see the fonts arrive showed that one of them
never had. Every page was set in the browser's default sans — Segoe UI, here —
and had been with Google's files too: the theme defines `--font-sans` on the
root as `var(--font-geist)`, a variable inside a variable is resolved where the
outer one is defined, and `--font-geist` was set on the body. Nothing failed and
nothing warned; the monospace, whose utility reads the variable on the element
itself, looked right and made the rest look right by association. The variables
are on `<html>` now, and a test says so.

### The first create of a large image works (0.3.0)

On the evening of 23 September the first Project Zomboid server created from
the wizard on this project's own machine failed and vanished, and the second,
identical, worked. The arithmetic explained it before anything was reproduced:
the node gave an image pull two minutes, the panel gave the whole create three,
and Zomboid's Build 42 image is 2.2 GB to download and 10.4 GB unpacked. Docker
went on downloading behind the failure, which is why the second attempt found
the image. On any node with an ordinary connection, a first Zomboid server
failed by construction; so did an update to a new build, which pulled after the
server had been stopped.

**Measured first.** What Docker's pull stream actually says was written down,
line by line, on Docker Desktop's containerd image store: every layer is
announced at once; a layer's size arrives with its first *Downloading* line, up
to six at a time, so the size of the whole is known part way through; a small
or already-present layer finishes without a byte; *Extracting* counts seconds,
not bytes, and repeats itself every tenth of a second whether or not it moved.
And `docker rmi -f` on an image a stopped container still uses leaves its layers
behind, so a pull afterwards downloads nothing — a proof of a download has to
remove the container first.

**A pull is a job on the node**, started by the panel and asked after every
second and a half — `POST` and `GET /images/pull`. It counts layers and bytes
from that stream, and it fails when it stops *moving* — no bytes, no layer
finished, no extraction counted for two minutes — never because it is slow. A
create no longer pulls at all: it is refused at once if the image is missing,
because the install downloaded it a step earlier, in front of the person
waiting. The wizard draws the node's numbers — a bar only once the total is the
total — and the review step lost its "cached, or a minute the first time". An
update, a rollback and a rebuild download first, while the server still runs,
and show it the same way through the same key and route the wizard uses; before
the download, nothing is backed up, stopped or destroyed.

**Proved in the running panel**, twice: the Build 42 image removed from this
machine, and a Zomboid server created from the wizard on this PC's node, the
download watched from *Downloading: 16 MB of 2.2 GB* through a bar that climbed
for three minutes to *Unpacking: 3 of 9 layers*, and the server created at the
first attempt a little under four minutes in — past both of the old limits.
The first of the two was given 4 GB and was killed by the kernel while it
generated its new world, which the panel reported as it should, *It ran out of
memory*; the game asks for 6, the wizard said so, and with 6 the second said
*SERVER STARTED* on its first start. The server this project had been using,
whose workload had to go for its image to go, came back with **Rebuild** in two
seconds, its world and its mod intact. `verify:pull` does the same against the
real engine with a 50 MB image every run; what a stall looks like is the
agent's unit test, with the event shapes the stream was seen to send, because a
registry that hangs mid-layer is not something Docker Desktop can be pointed at
here.

**The update proved on Paper**, from the version panel, on the same node: 1.21.4
to 26.2, whose image was not there. The 334 MB came down and was unpacked in
under forty seconds with the server running the whole time, and the update was
done at forty-eight. Two things the proof found are fixed. After the backup the
page said *Downloaded* again, because the rebuild asks the node for the build
once more and reported the answer; a build the node already has reports nothing
now. And an update, unlike a rollback or a rebuild, never stopped the server:
the rebuild removed the running workload by force. Docker's own events now read
`die 0` — Paper exiting on its own command — before the workload is removed, on
an update, a rollback and a rebuild alike, each of which the page narrates step
by step.

**What downloading first changes elsewhere.** A settings change that needs a
rebuild downloads before the old workload goes, so one whose download fails
changes nothing, where before it left the server down and in `ERROR`. And an
agent still on `0.2` — every node, between upgrading the panel and upgrading
it — cannot download on its own: its servers are not updated, rolled back or
rebuilt until it is, and the panel says so before asking it anything.
`verify:versions` shows both, against an agent that answers as an old one does
and one whose registry says no.

### The audit log keeps a deleted server's history (0.3.0)

An event's link to its server cascaded: deleting a server deleted every line the
audit log had about it, and the Audit page, its CSV and the API all read that
one table. What was left was `server.deleted`, which the delete wrote without a
link precisely so it would survive. The rollback of a failed create deleted its
row the same way, and with it the install steps it had reported — which is why
the failed Zomboid create of 23 September left nothing behind to read.

**The link goes, the name stays.** The relation sets null now, and in the same
transaction as the delete the server's id, name and slug are written onto its
lines, as a backup that outlives its server already had them written. Written
at the delete rather than on every line: until then the link answers, and a
rename shows everywhere at once. Most lines already named the server in their
target; the ones that did not — a backup's name, a file's path, the command
typed, an install step's sentence — were exactly the ones a search by name could
not find, and it looks at the server's name, live or kept, now. `server.deleted`
carries its link like the rest, so it belongs to the history it ends. The page
had no filter by server, whatever this project believed — only the API did — so
the event's detail links to **Every event of this server**, which works on a
deleted one by its slug.

**A failed create says why, and where.** `server.create.failed` is written before
the row goes, with the step, the node's reason and what is left afterwards. The
step used to be known only for a failed download; the installer names it for
every failure now. And "Nothing was left behind" was said whether or not the
node had answered the clean-up.

**Proved in the running panel**: a Paper server created, sent a console command,
backed up, given a setting that needs a rebuild, and deleted — its nine lines
still on the Audit page, struck through, in its filter and in the CSV. Then a
create started on a Paper image this machine did not have, and the agent
stopped at 13 MB into the download: after the three minutes of silence the node
is allowed, the wizard said the node was unreachable and that something of the
server might be left there, and the audit log kept the preparation, the
download and the failure, with its step. `verify:create` does both against a
real agent every run.

### The mods' edges: collections out, an API, and what an item needs (0.3.0)

Collections made three edges visible, and all three are the panel's alone.

**A collection leaves as it came.** Pasting one adds hundreds of rows in a click,
and they left one click at a time. The choice was between remembering on each
row the collection that added it and a multiple selection; remembering won,
because it is a fact the panel already holds at the moment of adding, where a
selection is three hundred clicks again unless it grows a "select all" that
takes more than it should. So a row says *from Rawt Building Craft*, each
collection on the list has **Remove its mods**, and removing takes what that
collection added and nothing else. Rows from before had no collection to
remember; pasting the collection again adopts them, in place.

**The mods have routes.** Phase 5m's principle was that what the panel does has
a route, and the Mods tab had none: the list, an item or a collection added,
one or a collection's worth removed, the switch, the order, apply and **Ask the
node** are `/api/v1/servers/:id/mods` now, each the tab's own operation, its
refusals under codes. The mod operations had also been writing their audit
lines without an account, so the log said *system* for what a person did.

**What an item needs, where Steam will say.** Measured again: without a key,
`IPublishedFileService/GetDetails` answers 401 and the keyless endpoints do not
carry an item's required items. With the panel's own key, asked through the
running panel rather than by decrypting it anywhere else, Steam lists them —
*BuildingCraft - Erika's tiles* needs *Building Craft* and *Erika's tiles* — and
the row names the missing one with **add it**. It also showed the limit: *B&B
Building Craft Addon* lists nothing, and the node finds it needs
`B&B_Tiles_Craft`. So the author's list is said as the author's, and the node's
check, which reads the files, stays the one that decides the load list.

Found on the way: the tab's own search as it opens could land after a pasted
link's preview and replace it — seen by pasting the collection too quickly.
And `verify:mods` and `verify:pull` exited 0 on a crash: their exit sits in a
`finally`, so a run that died halfway reported what had passed until then as
all of it. Seen when the verify database was reseeded under a running
`verify:mods`; a crash counts as a failure now.

**Proved in the running panel**, on Zomboid Mods: the collection pasted again,
adopting the five rows it had brought before this existed and adding the one
removed in Part 2; removed as one; pasted again at once, before the tab's own
search had answered; the list read, switched, reordered, refused and asked
through the API with a key made and revoked on the API keys page; Ask the node
naming each item's requirements; and one of them added from its row. The list
was left as it was applied. `verify:mods` adds and removes the collection on
both builds, and `verify:api` checks who may call the routes.

### A world of your own, and a console that says what happened (0.3.1)

Found on a production server, not here: a Terraria world made in the game,
uploaded, that would not load; the server's own config edited by hand to fix it,
which made things worse; and a console that could not be trusted to say when
anything happened. Every item below was measured first, reproduced, and then
proved in the running panel.

**The upload was cut by the panel.** Next.js 16's proxy clones every request
body it sees, up to `proxyClientMaxBodySize` — 10 MB by default — and past that
ends the stream without an error. The file route streamed what it was given,
the node renamed it into place, and a 20 MB upload was stored as 10,485,760
bytes and answered `201`. The file route is out of the proxy's matcher now, and
the length the browser declared goes to the node, which counts what it writes
and refuses a short body before it renames anything. A panel talking to an
older agent checks the size afterwards and removes the file rather than call it
uploaded. 4, 20 and 60 MB arrive whole, and so does the 11.4 MB world through
the button.

**Which world the server opens is a setting.** It was a fixed line,
`world=/data/geeboard.wld`, written again on every save. So an uploaded world
could only be used by editing `serverconfig.txt`, which the next save undid; and
the edit on the production server, `world=/data`, pointed the game at the
folder, where it made a new world and could not save it. **World file** is a
setting now, a file name and nothing else, refused if it is a path, and a `.wld`
at the root of the server's folder has **Use as world** on its row in Files.

**A failure the game prints is the reason the panel gives.** Measured on
1.4.5.8: a world cut short reads to 88%, prints *Load failed! No backup found.*
and exits 0 — the panel said *Stopped*. The folder as a world prints *Failed to
create the file*, then *Server started* — the panel said *Running*. A definition
names such lines with the sentence to show; the first stops a server with that
sentence on its page and in the audit log, the second makes a running one
unhealthy at once.

**The console.**

- Every line was stamped when the agent sent it, so a reload moved the whole
  backlog to the time of the reload, and the reconnect's copy of the last
  hundred lines could not be told from new ones: a downloaded log had a hundred
  lines twice. Lines carry Docker's own time now, and a line with the same time
  and text is shown once.
- The browser formats the time in its own clock; it was formatted on the
  server, in UTC, two hours behind the wall in Italy. The downloaded file says
  which clock.
- A stop ended Docker's log stream and nothing noticed: a console left open
  across a restart stayed quiet for good. The agent follows the next run from
  the last line sent. Found while proving the rest.
- The agent read each chunk of a followed stream as whole frames and dropped a
  frame split between two chunks, with the chunk after it. Frames are carried
  across chunks now, tested at every possible cut.
- Terraria's progress is hundreds of lines, and the boot and its error were
  outside the window: a run of progress is folded to one line per kind, the
  page reads a thousand lines, and *last 6 lines* shows six. Kinds that take
  turns — *Finalizing world* and *Saving world data* — fold as well; only
  neighbours did, at first.
- Stack-trace frames were levelled `CHAT`, for the `<2112d06c…>` in each, and a
  byte-order mark Terraria writes to stderr was an empty `ERROR` row.
- The health check's two lines every five minutes, from the node's own Docker
  bridge, read as somebody trying to get in. They are dimmed and marked
  **Geeboard health check**.

**Two things said the opposite of what they meant.** The create wizard ticked
every reason under *Recommended*, including *Agent attached: No agent on this
node*; the reasons that count against a node are marked `!` now. And a disabled
**Save changes** was the accent colour at 45%, which reads as ready: disabled
primary buttons are grey. Looking at why, the form also refused a rename on a
node that was already over its memory, without saying why — the save allowed
keeping a limit the node no longer had room for, and the form did not.

**Proved in the running panel**, on World Lab on fra-node-02 with the production
world: uploaded whole through Files; **Use as world**; restarted, loaded and
running; a damaged copy chosen instead, and the page said why it stopped; the
console reloaded, restarted with the page open, and downloaded; the Settings
page untouched and then renamed and back; the wizard's card for Terraria.

### What a member reads of somebody else's server (0.3.2)

The matrix gives a member `server.read` on every server and
`server.console.read` on their own, and the console's stream asked exactly
that. The two pages that show a console did not ask anything: the console page
loaded a thousand lines of whatever server its address named, and a server's
overview showed the last six. So a member read every console in the
workspace — players' names and addresses, and whatever a game prints. It was
found reading the code before the node terminal was designed, because the
terminal is built on the same shape — a permission asked when a long stream
opens — and copying the shape meant copying the hole.

**Asked where output is shown, before the node is.** Both pages ask the
matrix first and say why there is nothing, the way Files already did for a
member on somebody else's server: *No console access*. The console page opens
on the first console its reader may watch, so a member arriving from the
sidebar lands on their own server. Looking for every other way a console
reaches a page found one more: a crash is reported as the line that matched
the game's crash pattern, stored as the server's health reason and shown on
its page to anybody. That is told apart by the text alone — whether the stored
reason matches the crash pattern — so no column was added, and somebody who
may not watch the console is told where the line is instead of shown it.

**A stream is authorised while it runs.** A page is asked again with every
request; a console stream is one request that lasts as long as its tab. It
now reads the session, the account gate and the permission from the database
every ten seconds, and closes with the reason when any of them has changed,
clearing what it showed. The stream had also skipped the account gate every
page asks, and so had the two other routes that read the session themselves —
the audit export and the create wizard's progress. A test now fails when a
route under `app/api` reads the session and does not ask the gate, like the
one that keeps the shell from being handed a whole user row.

**The rest of what `server.read` gave away.** Looking for every path a
console took found three more that were not the console, and each was decided
rather than fixed on sight. A join password was in the Settings form of every
page it was drawn on, read from the panel and from the server's files — the
matrix keeps config files behind `server.files.read`, and a Settings page read
them for anyone — and in the API's two answers about a server, and in the audit
line of every change to it. A definition now marks such a field `secret`: it is
given only to whoever may change the settings, drawn as *Hidden* to anybody
else, and logged as changed and never as a value; the registry refuses a game
whose password field forgets to say so. The Backups page and a server's page
listed every server's backups to everybody, while the API asked
`server.backup.read`; they ask too. And a console command's text in the audit
log follows the console: whoever may watch it reads it, anybody else reads that
a command was sent, and the search is narrowed by the same rule, because a line
that matches "password hunter2" says what was typed as surely as its text does.

Two things stay as they were, on purpose, and are written in
[security.md](security.md#permissions): the names of a server's players, read
from its console's join lines, and the commands its scheduled tasks will type
are shown to every account. Both are what somebody in the same community would
see; neither is the console.

**Proved in the running panel**, with two accounts made from Members for the
purpose and removed afterwards: a member's console page and overview for
World Lab said why they showed nothing; **Console** in the sidebar took them
to the Terraria server they had made, whose lines both pages showed; a
moderator read both; and a moderator watching World Lab's console, made a
member from Members by an admin, saw it close eight seconds later with the
reason and nothing left on the screen. `verify:console` does all of that
against a real agent, with a session ended from under a stream as well.
Then, against World Lab, with `playing` typed into its console by an admin: a
member saw its Settings with the password *Hidden*, neither form's Save button
and no Danger zone; *No backup access* on the Backups page, and the sentence
saying whose they are on the server's page; no workspace totals of backups;
and *command not shown* on the Audit and Activity pages and the dashboard,
where a search for `playing` found nothing. A moderator read the command and
not the password; the admin read both. `verify:api` does the API's half with a
key of each kind, and the audit line of a changed password.

**A review of the finished change found two more**, both fixed before the
release rather than listed. The console switcher moves within one page, and
the view kept its state across it: a console closed for a role taken away
hid its lines rather than dropping them, and the next console opened from the
switcher showed them again under its own. The view is keyed on its server and
drops what it showed. Proved on this machine: a moderator on World Lab's
console, then Zomboid Mods' from the switcher, without one of World Lab's
lines; made a member there, closed in four seconds; World Lab from the
switcher, *No console access*. And the Settings page's own form and Danger
zone were still offered to everybody, the second with a count of the server's
backups.

### A shell on the node, and a node that arrives by itself (0.3.5)

Three things, in the order they were built: a terminal on a node's machine,
the Add a node dialog following a machine all the way in, and the panel
installer making its own machine a node. The terminal is the first thing in
the panel that runs a program on somebody's machine rather than in a game's
container, so it was designed on paper first — six decisions — and the
measurements came before the design.

**Measured first.** Next 16.3.5 under `next start` closes a WebSocket upgrade
aimed at any app route (`router-server.js`, `socket.end()`), so a
browser-to-panel WebSocket would mean a custom server; the response side
already streams (the console's SSE), a route handler's `request.signal` fires
when the browser goes, and a request body held open dies at Node's 300 s
`requestTimeout` — so output is SSE and input is numbered requests, one at a
time, as the console already does. For the shell: `node-pty` ships no Linux
binaries and cannot build in the agent's Alpine image; `@lydell/node-pty`
loads there and crashes at the first spawn; `@homebridge/node-pty-prebuilt-multiarch`
carries musl builds in the package and was measured inside `node:24-alpine`
(a real pty, resize honoured, exit code back) and on this Windows PC under
ConPTY (PowerShell prompt in 244 ms, resize seen by the shell, a program the
shell started in its own window killed with the tree). Without a library,
`script` is not in the image and cannot resize, and a Windows shell on a pipe
has no size, no colours and no Ctrl-C.

**Decided.** Transport: SSE out, `POST` in, on a session route outside
`/api/v1`, with a sequence number per request, one in flight at a time, and
the panel's own `Origin` check, since Next checks it only for server actions;
a dropped stream picks the session back up within thirty seconds and never
starts a new shell. The shell: on Windows the agent's own account, not
elevated; on Linux `/bin/sh` inside the agent's container, said as such in
the page, because a shell of the host itself is a different deployment and
not this release. Consent lives on the machine: a `terminal` key in
`agent.json` or `GEEBOARD_TERMINAL`, written by the installers' `--terminal`,
never by the dialog's command; the agent reports it as a field of its own in
every heartbeat rather than as a capability, which is game vocabulary, and a
node that has never sent it is *agent too old*, because 0.3.2 and 0.3.5 are
one release line and the number cannot tell them apart. Who: owners only —
the one permission an admin does not share — in no API-key scope, with a
fresh authenticator code at every open, its step spent under a condition so
two requests with one code cannot both pass. Audit: opened, closed, refused,
with node, actor, shell, duration, reason and bytes, and never content.
Registration of the panel's own machine lands `PENDING` like any node;
approval stays a person's.

**Implemented.** In the agent, `terminal.ts`: sessions reserved with one
request and started when the stream attaches, so nothing runs unwatched; two
per node, fifteen idle minutes, four hours; the shell's environment stripped
of every `GEEBOARD_*` and `NODE_*`; the tree killed at the end — `taskkill
/T` on Windows, on Linux a hang-up to the process group and every descendant
read from `/proc`, then a kill, because the first Linux proof left a `sleep
300 &` alive: a shell with job control puts a background job in a group of
its own. In the panel: `node.terminal`, a `terminal` column on the node, the
session registry, the four routes, a Terminal page under Infrastructure with
a node switcher that says *on*, *off*, *no agent* or *agent too old* beside
each name, and xterm loaded only on that page, in the panel's own colours
read from the computed tokens. Add a node: the progress the dialog polls now
carries `lastSeenAt`, `lastReachedAt`, approval and, new, `reachDetail` —
the reason the panel's call back failed, which until now was returned only
to the agent — and a pure `lifecycleOf` turns them into the step the dialog
draws. The installer: a ninth stage, the `node-token` verb, a hostname made
to fit the node-name rule in `common.sh`, and `install.sh` run with the token
and this machine's LAN address; a machine already joined is upgraded, not
registered twice.

**Verified.** `daemon/test/terminal.test.ts`: the session manager with a
shell made of an object, then a real shell through the real library (Node's
own REPL standing in, on this Windows PC; bash on CI's Ubuntu), then the
agent's routes over HTTP and a WebSocket — refusals, a session end to end, a
frame over the bound, the panel letting go, the agent stopping. The Linux
container was driven from this PC against the built image: `/bin/sh` as
root in the container, `TERM` set, no `GEEBOARD_` variable in the shell's
environment, resize to 132×43 seen by `stty`, and after the close no `sh` or
`sleep` left in the container. `verify:terminal` runs two real agents and a
real panel: an admin refused, a wrong code refused and audited, *off* and
*agent too old* and *pending* named before any code is looked at, a session
opened with a fresh code, typed into, resized, picked back up after its
stream dropped, refused a second stream and an oversized frame, closed with
nothing left on the agent, and two sessions ended from under their owner —
by the sign-in ending and by the token rotating. `verify:registration` now
covers expired and revoked tokens, a token minted by the installer's verb,
and the dialog's steps: pending after the join, approved after approval, in
service after the panel's call back, and *not reachable* with the reason when
that call fails. In the running panel, as the seed admin: the Terminal page
says *Owners only*, and the node page shows *Terminal: on · giorg ·
powershell.exe* from this PC's agent, switched on with `GEEBOARD_TERMINAL=1`.

**Found in the running panel, and fixed.** The browser's page opened a
session, drew *Attached*, and then opened its stream again and again — every
check from a script passed, because a script holds no React: the emulator's
effect depended on a callback the parent made anew at each render, and each
state change tore the stream down and started it over. The callbacks are read
through refs now, and the effect runs once per session. **Proved on a VPS.**
A clean Ubuntu 26.04 machine with two cores: `install-panel.sh --build --ip
… --node --terminal --yes` built both images, made the owner, minted the
token through `node-token`, ran `install.sh`, and the node registered with
its public address and a terminal reported *on · root · /bin/sh* inside the
container; the panel's call back got through, the audit line named the
installer and linked no account, and the dialog's step read *pending*, then
*online* once approved; a Terraria server was created on it and ran. A second
run said *already a node* and upgraded the agent; `--no-node` and a bare
`--yes` left the machine a panel only. **Left for a change of its own:** the
rule refusing a terminal on an agent reached over plain HTTP across a network
that is not yours.

### A member who owns something, and records written for you (0.4.0)

Two things, the smaller first because the larger needed it.

**Measured first.** A member held most of the matrix "own" and read every
server, node, member and audit line — and owned nothing, because a server's
owner is whoever created it and members cannot create: there was no way to
give a server to anybody, though `removeMemberOp` had asked for one since the
start. On the DNS side, three facts decided the design: a server's address was
already a hostname a person types, proposed as `<slug>.<the workspace's
domain>`; a node had no address players reach it at, only the panel-to-agent
URL, often a LAN one; and there was no workspace setting to hang a provider on,
only two singleton rows — the bucket and the Steam key — each with the same
shape: probe, encrypt, upsert, audit, never shown again.

**Decided.** A member is somebody a server was given to: `server.assign`, an
Owner card on the Settings page and `POST /servers/:id/assign` give one; the
member sees their servers, starts, stops and restarts them, watches their
console, and holds nothing of the workspace and no key. The navigation filters
on the matrix, and every page says whose it is to anybody who types its
address. Several owners stay allowed. For DNS: the provider is a third
singleton on the same shape, owners' and admins', in no API scope; a record
is written only for a host under the provider's zone, only at a name the
panel made or that already said the right address, never over a record it
did not make; a failure is kept on the server and retried by the poller, and
is never a reason a server is not created, moved or deleted; the node's
address is set by hand or observed from its heartbeat's last `X-Forwarded-For`
hop, and an observed private address is named and not used. DuckDNS first —
it exists for the home connection whose address moves — Cloudflare with it in
code and tests. Kept out: SRV records, CNAMEs, a second provider, and any
call from the agent to a provider.

**Built.** `domain/dns/rules.ts` holds every decision as a pure function —
what is public, which hop is the peer, what to do at a name with what is
there, when the poller should try — and `lib/dns-ops.ts` carries them out
through one client interface that Cloudflare and DuckDNS each answer. Four
hooks in the lifecycle, each a few lines behind "no provider, return": create,
move, a host change, delete. One poller pass. A DNS page with the provider
card and every record; a public address on the node's page; a DNS row on the
server's; the wizard proposing the zone and saying whose the record is.

**Verified.** Unit tests for the rules, the table of "a record is already
there" one row per case. A verify script against a fake Cloudflare and a fake
DuckDNS on local ports, eighty checks: no provider means no call and no change;
a wrong token saves nothing; the node's address arriving writes the record;
the node moving moves every record; a refused subdomain, a provider down, a
record that will not go; adoption, refusal, an update by id; the token in no
audit line. In the running panel as the seed admin: the DNS page refusing a
wrong token and taking the right one, the node's Configure with a public
address, a server's address moved under the zone and its row reading
*points at 203.0.113.9*. On the throw-away VPS, upgraded in place as
[upgrading.md](upgrading.md) says: `panel migrate` applied the one migration
on the live database, and the node's page read *217.182.128.27 · as the panel
sees it* before anybody set anything — the address of its own agent's
heartbeat, read from the last `X-Forwarded-For` hop the panel's Caddy wrote,
which is the measurement the observed-address rule rested on. A member signed
in there saw their dashboard and was refused the DNS page. Then a real DuckDNS
account: the owner set its token on the DNS page; a Terraria server created
with the subdomain as its address came up with *geeboard.duckdns.org points at
217.182.128.27* in its toast and `server.dns.set` in the log; the node's
public address set to a documentation address moved the record there within a
poll, and unsetting it moved it back to the observed one, each seen from
`1.1.1.1` and `8.8.8.8` after the record's minute; deleting the server left the
name resolving to nothing. **Found on that account, and fixed:** the token
check on a subdomain that had no record yet sent the documentation address
`192.0.2.1` as a placeholder, and DuckDNS took it like any other — a Check
pressed on the subdomain the panel had just emptied left it pointing there. A
subdomain with no record is cleared instead, which changes nothing. Found at
the same time: the wizard proposed `<name>.duckdns.org` for a new server, a
name that is nobody's until it is made on duckdns.org, and DuckDNS refused it;
the address hint says so now when the zone is DuckDNS. **Then, asked whether
something custom could make the subdomain:** it cannot — the site's add and delete
are logged-in form posts, and the API has neither — but DuckDNS resolves every name
under a subdomain of an account to that subdomain's address, checked at two depths
from two public resolvers, so one subdomain per node serves every server on it. The
panel accepts a name at any depth under `duckdns.org`, writes through the subdomain,
lets servers on a node share it, refuses a server on another node with the reason,
and clears it with the last. The first version of that let a server that had been
refused, being older, hold the subdomain against the ones that could use it; a
subdomain is held by a written record and nothing else. On the real account, two
servers named `wild1` and `wild2` under `geeboard.duckdns.org` on the VPS: the
first wrote the subdomain, the second was logged *Shared with 1 other server* and
asked DuckDNS nothing, and both names — and `geeboard` itself, and a name never
created — resolved to the node's address from two public resolvers; deleting the
first left it there, saying who still used it, and deleting the last emptied it.
**Then Cloudflare, on a zone bought for the purpose** (`geeboard.party`, empty,
on Cloudflare's nameservers), through the panel on the VPS with a token limited to
that zone: the check verified the token, found the zone and proved DNS:Edit with a
text record it removed. A server named under the zone got an `A` record, unproxied,
with a 60-second TTL and a comment naming the server; moving the node's address
updated that same record by id, and moving it back did too; renaming the host
removed the old name and wrote the new; deleting the server emptied the zone. Each
step was read back from the zone's API and from its authoritative nameserver, and
from three public resolvers once their caches had turned over. The three cases of a
record already there, made by hand: one saying the right address was adopted (the
comment written onto it, its TTL made 60, removed with the server); one pointing
elsewhere was left alone, the server was created and told, and the record was still
there, untouched, after the server was deleted; a `CNAME` at the name was the same.
The zone was empty at the end. **Found while testing, and only a note:** the
nameservers answer a few seconds late and a resolver that looked a name up before
it existed keeps it missing for 30 minutes, which would have read as a fault in the
panel had it been tested the obvious way; it is in [servers.md](servers.md#dns).
**Found at the cut:** the plan, and the first changelog, said a 0.4.0 panel would
work with every 0.3.x agent because the agent has no change of its own. It would
not: a panel and an agent work together when they share a release line, and 0.4 is
not 0.3, so a 0.4 panel would have refused to put a server on every node it had and
refused a 0.3 agent joining. The release is cut the way 0.3.0 was — the agent's
version moves to 0.4.0 with no change of its own, and the upgrade is the panel and
then every agent — and the texts that said otherwise were written again.

**Asked for afterwards:** a server created on a name that could not work, with no
provider to say so. The wizard's *Name and address* now looks the typed name up a
moment after the last keystroke and says what it comes to — at a node, not created,
at something that is not a node, outside the provider's zone, or with no node able
to give an address — and, with no provider, offers the DNS page for a name of one's
own, in a new tab so the draft is kept. The pure wording is tested one sentence at a
time; the lookup is the DNS's own and never the hosts file's, and a lookup that fails
is said and does not block. Seen in the running panel with no provider, with a provider
for a name under its zone, and for one outside it, in both themes.
**Left for a change of its own, and made in 0.4.1:** the 0.3.5 plain-HTTP terminal
rule, whose `isPublicAddress` now exists.

### Closed gaps, a contract, and a key that can change (0.4.1)

No new feature: 0.4.0 made sturdier. Nine parts, the first of them a note written
before any code, each of the others answering something that note, or the 0.4.0
cut, had found.

**Measured first.** Five things, each with a script against the verify database
and not a reading of the code. A create the panel did not live to finish left its
row `INSTALLING` with no workload, and nothing read it again: the poller looks only
at servers that have a workload, `settleStale` settles only simulated ones, and
the delete had no state to refuse on. `Server.host` was unique only in the code, and
compared exactly: `Aurora.example.com` and `aurora.example.com` both went in, and
two creates at the same moment on different nodes both went in five times in six —
the same node is saved by the unique `(nodeId, port)`. Nothing removed an expired
session; the demo database had none yet, the first would expire on 2026-10-06. Of
the route handlers outside `/api/v1`, four accept anything but GET with the cookie,
all of them the terminal's, and all four check the origin; Next's own check on a
server action was measured too, and refuses a foreign origin and the opaque `null`
of a sandboxed frame (a 500, `E80`) while letting the panel's own and an absent
`Origin` through. And `encryptSecret` protects exactly five fields — the node tokens,
two-factor secrets, the off-site bucket's key, the Steam key and the DNS provider's
token — under a key that is `SECRETS_KEY`, or `SESSION_SECRET` where that was never set.

**Decided.** The contract is an integer, written in the panel and in the agent as two
constants with a test that reads both files and fails when they differ; panel and
agent are compatible when the numbers are equal, and an agent that sends none is judged
by its release line as it always was, so nothing already installed is refused by this.
It goes up only when one side could no longer read the other, and each release says
so in one line of its changelog. `rekey` opens everything with the key the environment
holds and seals it again with `SECRETS_KEY_NEW`, in one transaction, refusing and writing
nothing if any value fails to open; the new key is read from the environment and never
the command line; the panel and poller are stopped first, as for a migration; the agents
are not touched, since only the panel's copy of a node's token is encrypted. The address
is lower-cased where it is written and guarded by a `CHECK` and a unique index, rather
than by an expression index, so that the Prisma schema stays the truth; the migration
refuses, naming them, to choose between two that already collide. Expired sessions go
with no margin, because nothing reads an expired row. The sweep is for a create only,
after ten silent minutes — a live create writes its row every second and a half while it
downloads, and an agent that stops answering fails a create in three. The origin check
needed a test and no code. A terminal is refused over `http:` at a public address, and at
a name, which is not known to be private — `localhost` included, as the plan wrote it:
the node on the same machine is reached at `127.0.0.1`. Private and loopback addresses
stay allowed over `http:`, and `https:` is allowed anywhere.

**Built.** `domain/nodes/agent-version.ts` decides by contract or by line, and says which
in every message; `daemon/src/contract.ts` is the agent's number, sent at registration, in
every heartbeat and in `GET /version`; `nodes.contract` holds it, replaced together with the
version so that an agent put back to an older one is judged as that one. `lib/rekey-ops.ts`
and a `rekey` verb on the image (`npm run rekey` from a checkout). `lib/db-errors.ts` reads
which constraint a unique violation names — Prisma 7 with the pg adapter leaves `meta.target`
empty and the name is in the driver's own error. `domain/servers/interrupted.ts`, the sweep
and `pruneSessions` in the poller. `plainHttpRisk` beside `terminalDecision`, and a word in
the Terminal page's node switcher so a refused node does not read *on*.

**Verified.** The regression before the cut: typecheck and lint; `npm run verify`, 446 unit
tests and every script in its chain; registration, console, terminal, poller, agent, create, pull,
files and mods; the production build; the daemon's typecheck and its 201 tests; `deploy/lib/verify.sh`;
the documentation site's build and link check, 1674 internal links. Unit tests for the rule, in both halves of the contract, the one for a number
that is not a contract, the sweep's decision, and every address class over both schemes.
Verify scripts: `verify:hosts`, twenty-five checks, including six pairs of creates at the
same moment on two nodes — which went in five times in six — each now leaving one server and
one *Address in use*; `verify:rekey`, thirty-five, including the transaction rolled back
by a write that changes under it and no key or secret in any line it prints or audits;
`verify:poller` for the sweep and the prune; `verify:versions`, forty-nine, for a contract of
the panel's number on another line, one of another number on the same line, a nonsense
number, and a node put back to an agent that sends none; `verify:terminal`, fifty-two, for a
foreign origin on a server action and the three address cases through the real route. In the
running panel as the seed admin: a stuck create seen as *Installing*, swept, and read as an
error saying where it had got to; a Settings save to a taken address refused as *Address in
use*; the real `fra-node-02` agent, started from the new code, filling `nodes.contract` from
its own heartbeat so that the page read *0.4.0 · contract 1*, then, with the number changed,
a banner naming both contracts, and the next heartbeat putting it back. As the owner, against a
second panel on the verify database: the Terminal page for a node whose machine says *on*,
open at a loopback address, refused at a public one over `http:` and at a name, and open again
at the same public address over `https:`. On the throw-away VPS, the panel built from the tree
and migrated, `rekey` was run against the real panel's database: a dry run counting three
secrets, the run, then the old key in `.env` no longer opening the owner's two-factor secret,
the node's token or the Cloudflare token, and the new key opening all three — the node's agent
answered `/version` with the decrypted token, Cloudflare's check accepted the stored token, the
audit log had one `secrets.rekeyed` with counts and no key — and a second run with the key that
was now the current one was refused. **Found there, and fixed:** the `sudo` on a current Ubuntu
is sudo-rs, which ignores `-E`; the first run reached the container without the variable, stopped
at once saying it was not set, and wrote nothing. The instructions pass it with
`--preserve-env=SECRETS_KEY_NEW`, which both `sudo`s take, and the message says so. And the
proof script itself, written without `set -e`, went on after that refusal and wrote the new key
into `.env`, so for a while everything on that panel was sealed with a key no longer in the file
— the case the security page calls *edited, not rotated*. Putting the old value back, as the page
says, and running `rekey` was the way out, and is now what was tried.

**Found at the cut, and not mine:** the daemon's test *an agent that stops takes its shells with
it* fails about one run in two on this Windows machine — a pseudo-console torn down with its agent
outlives it by more than the thirty seconds the test allows. It failed the same way on a clean copy
of 0.4.0's daemon and passed on the next run, so it is a flake of that test on Windows and not a
change here; the daemon's suite was run again and passed.

**Left out, and why.** Only a create is swept: the other transitional states — an update, a
rebuild, a move, a backup — can legitimately take long, and a rule for "silent too long" there
needs measuring of its own; it is in
[limitations.md](limitations.md#interrupted-operations). The contract has no minimum: equal, or
refused; a panel that could talk to the number before its own is a promise the project has not
needed to make. A terminal session already open is not closed when the address it was opened over
changes; a node that registers again rotates its token, which does end it. `rekey` does not
change `SESSION_SECRET` — that one signs people out and costs nothing — and is not a button in
the panel, since it needs the panel stopped. `verify:backups` was not run: it needs the S3
stand-in whose image can no longer be pulled. Not started: Server Address and SRV (0.7), user
templates and notifications (0.5), community games (0.6), metrics and a second kind of provider
(0.7, 0.8).

### Notifications, templates of your own, and clone (0.5.0)

Two things that do not depend on each other, and one that both needed: a way to
send a message to somebody else's address without the panel becoming a way into
its own network.

**Measured first.** Against the real poller, a real agent and real containers,
with a script that writes down which audit row appears for each thing that goes
wrong. A crash writes one `server.crashed`; with the default restart policy it
writes a second row, the Watchdog's `server.recovered` with the attempt, in the
same pass, so one crash is two rows. A crash loop is closed by the panel itself —
three restarts, waits of 0, 30 and 120 seconds, then `server.recovery.abandoned` —
six rows at most. Typing `stop` at a game's console writes `server.stopped.unexpectedly`,
the same row as a server that went wrong, so it cannot be an alarm. A node that goes
quiet writes one `node.unreachable` after five minutes, once, and nothing for its
servers; a backup asked of it in that time writes a `backup.failed` saying it is
unreachable. A verification with the node down says *unchecked* and never *damaged*.
"Update available" was not a row at all but a calculation made when a page was
drawn. And the outbound calls of the panel: the DNS providers, Steam and the version
sources go to hosts written in the code, the agent to an address a node registered —
and the **bucket to whatever an owner or admin typed**, signed, with the status and
the store's own error text shown in the answer. That last one is not new with this
release, and it is the reason the rule below is not only for webhooks.

**Decided.** Notifications read the audit log after a cursor and never hook the
places the events are written, so a row that changes cannot silently stop being one
and nothing that starts a server can be slowed by it. Six events, and the ones that
would be noise are out: a clean stop, a health flap, a verification summary. The rows
are tidied before they are sent — a crash and its restart are one message, servers
that fall together are one, a backup that failed because its node is down is the node
being down — and a channel is held to ten messages a minute, which a server cannot
reach alone and a node going down can. Delivery is at least once with a queue in the
database, because a Discord outage of ten minutes would otherwise lose exactly the
message about the node that fell. The rule about where a webhook may point is the
decision that matters: Discord only at the addresses Discord issues; a webhook only
over `https` to public addresses, with a name looked up once and every address judged
and the call made to a judged address, so that DNS rebinding has nothing to walk
round; no redirect; nothing of the answer kept; and one switch that widens it for
the LAN, set in the panel's environment by the person who owns the machine, never
on a page, as the node terminal's consent is. This machine itself and link-local or
metadata addresses stay refused even then. The bucket gets the same guarded call
with its own rule: a store on the machine or on the LAN is the usual way to run it
and stays allowed, so only metadata and the ranges that mean nothing are refused.
Templates keep the settings, limits and version and leave behind what belongs to a
server — the world, the address, the schedule — and two kinds of setting: a password,
because a template is read by whoever may create a server, and a setting that names a
file in the server's own folder. A clone is the same start taken from one server and,
with a bucket, its world through a backup and a restore, the way a world already
travels; with no bucket the copy is the settings and a new world, and the panel does
not move folders between machines on its own. The agent does not change and the
contract stays 1.

**Built.** `domain/net/address.ts` names the class of an address, looking through
IPv4-mapped, NAT64 and 6to4 forms, and `domain/notify/destination.ts` turns that and
a policy into a verdict; `lib/net/guarded-fetch.ts` is the call, which resolves once,
judges every address, connects to the judged one by number and keeps the name for the
certificate. `domain/notify/{events,format,rules}.ts` are the six events, the two
bodies and their signature, and every rule above as a pure function; `lib/notify/ops.ts`
the dispatcher, the delivery with its retries and the update scan, and
`lib/notify/channel-ops.ts` what the page does. A Notifications page, a Templates page,
a card on a server's Settings page and the wizard opening on a template or a clone.
`rekey` seals the channels' addresses and signing keys. Two migrations.

**Verified.** The regression before the cut: typecheck and lint; `npm run verify`, 521 unit tests and every script in its chain; registration, console, terminal, poller, agent, create, pull, files and mods; the production build; the daemon's typecheck and its tests; `deploy/lib/verify.sh`; the documentation site's build and link check. `verify:notify` is eighty-nine checks: with no channel
nothing is queued; the rows as the poller writes them become messages for the channels
that asked and for no other; a webhook gets a signed POST that checks out with its own
key, Discord the embed to its own address; a 503 is tried again after a minute, five and
thirty and then given up on, a 404 not at all, and neither the receiver's words nor the
token come back anywhere; a storm is held to ten and one notice; rows a day old are not
news; and the poller itself, run as its own process with the switch set and a receiver
on this machine's LAN address, sends the crash once and not again. The address rules
have their own tests in every spelling of the cases that matter. `verify:storage` runs
the real bucket operations against a stand-in: the metadata address refused six ways
before anything is called, a redirect not followed, an endpoint saved before the rule
refused without a call. `verify:templates` is thirty-nine checks, the last of them for
real: two containers and a real agent on this machine, a stand-in bucket, a backup of
one server's world into it and a restore into the other, and the file that was in one
world read from the other, the new world's stray file gone, the source untouched and
still running. In the running panel as the seed admin: the Notifications page refusing
a LAN address with the variable named, and a Discord address that is not Discord's;
then, with the switch on, a webhook on this machine's LAN accepted, its key shown once
and checked against the signature of the test message the receiver got, the address
never on the page again, a crash row turned into a signed message by the same two
functions the poller calls, the events changed, the channel turned off and removed.
And the Templates page: a template saved from a server's Settings page, listed, the
wizard opening on it and on a clone with the review saying where each came from.
**Found while testing, and fixed:** the rate limit's notice only fired for a batch
that crossed the line itself, so a storm of one message a pass was dropped without a
word; a delivery took the database's clock for its age while the dispatcher used its
own, so retries and the limit measured different times; and the first run of the
poller check said *did not answer in time* because the test had waited for the child
synchronously and a process that is waiting cannot answer — the receiver was in it.

**Left out, and why.** Mods are not in a template: they are a list the panel keeps per
server and applies through the node, and a clone with its world carries the files, so
the copy runs with them, but its Mods tab starts empty. A saved template cannot be
edited, only saved again under another name. No email, because the project has no mail
server and the plan said so; no per-person notifications, no Slack or Telegram of their
own — a webhook with a small adapter reaches them — no answering from the chat, and no
setting for the ten-a-minute limit until somebody measures a need. A webhook cannot be
pointed at this machine even with the switch, as agreed; a service on the same host is
reached by its LAN address. The bucket's rule lets this machine through, which is a
change from the plan's first wording, because a store on the same host is the common way
to run it and has nothing to steal. `verify:backups` was not run: it needs the S3
stand-in whose image can no longer be pulled, and the clone's world is proved against a
smaller one instead. Template sharing between panels is the Community Games question and
waits for its trust rules (0.6). Not started: Server Address and SRV (0.7), metrics
(0.7), a second kind of provider (0.8).

### Community games (0.6.0)

A game written by somebody who is not a maintainer, run on a node the project does not own.
It is the first release that runs code a person chose, and the plan said so in its title:
the trust rules first, the feature after.

**Measured first.** Against the real definitions, a real agent, real containers on Docker
Desktop and on a throw-away Linux machine at a cloud provider, and Node itself.
All eight definitions Geeboard has — the five offered and the three parked — go through
`JSON.stringify` and `JSON.parse` without losing anything, so a manifest is the definition,
in JSON, and there is nothing to translate; they are 2 to 18 KB, which is a paste. But the
registry is not data: `DEFINITIONS` is a constant array, `findGame` and `allGames` are
synchronous, `lib/catalog.ts` turns the list into a constant that reaches the browser, and
about forty files use them, so a game that comes from the database cannot make all of that
asynchronous. The agent's door was already narrow: a request body carrying `privileged`,
`binds`, `capAdd`, `networkMode`, `pidMode`, `user`, `devices`, `securityOpt` and the rest
produces a container whose host configuration holds `Binds`, `LogConfig`, `Memory`,
`MemorySwap`, `NanoCpus`, `PidsLimit`, `PortBindings` and `RestartPolicy` and nothing else, and
whose only mount from the node is the server's own folder. But it takes an image from **any
registry**, with **no digest and no tag**, and any command, so those rules have to live in the
panel. Inside such a container, on Docker Desktop and on a Linux machine: root, with Docker's
default capabilities; no mount, no Docker socket, no node files; and **a route to the machine
it is on**. From a container on the default bridge of the real node: SSH on the gateway
address, the agent's port, the proxy's ports and **the cloud metadata service at
`169.254.169.254`** answered; the panel's own port and its database did not. That was true
of every game already, and it is the reason this release says what it is not. A regular
expression a manifest brings is run by the panel on every line the game prints, and
`^(a+)+$` on 32 characters freezes the process for 21.8 seconds; a `node:vm` timeout cuts it.
Late in the work, running the first real manifest found one more: **a JSON settings file is
a type the panel cannot write** — `applyPatch` throws for it — so a game that used one would
have been approved and then failed at its first server.

**Decided.** The format is the definition, in JSON, with `"manifest": 1`, and checked as a
closed list: a field that is not known is an error, and what comes out is built field by field
from what was checked, so nothing unchecked can be in it. A manifest is pasted or uploaded and
never fetched, so there is no address for anybody to point the panel at. An image is named by
its digest, from a registry on the owner's list, `docker.io` and `ghcr.io` to begin with.
Approval is an owner's act, with a fresh authenticator code — the check the node terminal
already used — bound to the SHA-256 of the canonical manifest, which the page shows and the
operation compares with the stored one, and which is checked again when the game is loaded
from the database, by every process. Consent to run it on a node is the machine's, as the
terminal's is: the capability `community-games`, declared on the machine, with no switch in the
panel. Regular expressions get three defences, because one is not enough: a static rule at
proposal, a timed run at proposal and at approval, and a guard at run time on the patterns of
an approved game only, so the games Geeboard ships are not slowed. The registry becomes
loadable, with the community list on `globalThis`, filled when the web process starts and every
ten seconds after and by the poller on each pass. And the project does not say *sandbox*: the
approval page lists what an image can do in the words of the measurements above, the node
needs to have agreed, and a script is offered for the node's side.

**Built.** `domain/games/manifest.ts`, the checker, with `safe-regex.ts`, `regex-guard.ts`,
`image-ref.ts` and `audit.ts` (extracted from the registry, so a manifest faces the audit a
shipped definition does); `preview.ts`, which turns a definition into what the owner reads;
`matcher.ts`, which runs a pattern under the guard. `lib/community-games.ts` — propose, approve,
turn down, retire, set the registries, and the loader. Two tables, a permission pair
(`community.propose` for owners and admins, `community.approve` for owners, neither in any API
scope), a new capability, and `verifyFreshCodeOp` taking the purpose it is asked for. A
*Community games* page with the proposal form and its validation report, the revisions and
the registries; a page for one revision; labels on the Games page, the wizard, the review step
and a server's page; the node page and the pending-node card saying what the capability
means; no checkbox for it in *Add a node*. `--community-games` and `-CommunityGames` on the
installers, the Linux one through a helper that `deploy/lib/verify.sh` tests;
`deploy/linux/container-firewall.sh`. The API names a community game and its approved
revision. `docs/community-games.md`, whose manifest is read and checked by a unit test.

**Verified.** The regression before the cut: typecheck and lint; `npm run verify`, 625 unit tests and every script in its chain; registration, console, terminal, poller, agent, create, pull, files and mods; the production build; the daemon's typecheck and its 206 tests, one of them skipped as before; `deploy/lib/verify.sh`, 64 checks; the documentation site's build and link check, 1878 internal links. The new unit tests: `safe-regex` (20), `image-ref` (10), the manifest checker (44, every rule with a manifest that breaks it, and all eight games Geeboard has accepted as manifests), the loadable registry (14), the preview (11), the page and the code held to each other (4), and four in the agent that pin the options a container is made with. `verify:community` is seventy-one checks against a database and, for the last part, a real agent and a real container made from an image named by digest: a hostile manifest refused at the field; a good one proposed; a code that is spent cannot approve a second thing; a stored row edited by hand neither approves nor loads; a second process that started knowing nothing finds the game from the database, checked, with its patterns guarded; a newer revision supersedes and never two are approved; a node that has not declared the capability is refused with a sentence and nothing is written; a registry off the list is refused and narrowing the list stops a waiting revision; the container is unprivileged, has no added capability and one bind; a retired game is not offered, is still found, is refused a new server and leaves its server running; the audit log holds names, hashes and counts and never a setting or a password. In the running panel, against a second panel on the verify database as the seed admin and as the owner (enrolled in two-factor there and nowhere else): a hostile manifest refused naming `privileged`, the missing digest and the panel's own variable; a good one kept; its page read, with the hash in full and the metadata service in the list of what an image can do; the admin told only an owner can approve and shown no button; the owner refused with a wrong code and accepted with the right one; the game in the Games page and the wizard with its label; retired; and the audit trail, with no code in it — 29 checks. Then the real game: a real agent joined with `--capabilities community-games`, its capability arriving by heartbeat, the owner approving the node on the Nodes page with a sentence about what it declared; Factorio from `factoriotools/factorio`, by the digest of its index (2.0.77), proposed, approved with a code, and created through the wizard — the other nodes listed as *cannot run this game — Missing Community games*; running, with the ready line `Hosting game at` in its console and a command typed in the console answered; a backup, a template and a clone of it; the game process sent a segmentation fault, which the panel read as a crash, restarted, and told a signed webhook about; and the game retired from its page while the server ran, after which the server went on running and could be stopped, a template of it and a clone of it no longer opened the wizard, and the wizard no longer listed it. A hand-written create body carrying `privileged`, capabilities, a device, a host bind, the host's network and PID namespaces and a security option, sent straight to the real agent: it made an ordinary container, which Docker's own inspection confirmed, with 13 checks. The agent pulled by digest an image the node did not have, made a container whose image is the digest, and refused a digest the registry does not have. On the throw-away VPS, at a cloud provider: a container reached SSH, the agent's port, the proxy and the metadata service; with `container-firewall.sh` started from a systemd unit it reached neither SSH, nor the agent's port, nor the metadata service — the proxy's port, which is not on the default list, still answered — and still reached the Internet, DNS and an HTTPS page, and a published port still answered from another machine; the unit stopped, the rules were gone, and the machine was put back as it was found.

**After the tag.** `npm run manifest:check` runs the checker on files and directories, for
somebody with no panel and for a repository that collects manifests, with six tests of its own run
as the process it is, for its exit status. It was written the day `v0.6.0` was tagged and is **not
in that tag**: it is in `main` and will be in the next release. Typecheck, lint, the unit suite (631
in all) and the documentation build were run again for it; the rest of the regression was not.

**Found while testing, and fixed:** a retired community game could still be given new
servers by anything that did not go through the wizard — the create operation, a template, a
clone — because they asked the registry whether it *knew* the game and not whether it still
*offered* it; the manifest checker accepted a JSON settings target the panel cannot write;
the first draft of the capability merge in the Linux installer added an empty `--capabilities`
to a run that was not joining anything; and the one I did not write: the parked Palworld
definition **fails the registry's own audit** — its query probe names a port it does not have —
which no one had noticed because it is parked.

**Left out, and why.** There is no catalogue and no fetching of manifests, by design; nothing
in this release makes a community game easier to *find*. There is no sandbox of the network:
an approved image reaches what any container reaches, and the answer to that is the node's
consent and the firewall script, which is Linux only, is not run by the installer and was not
tested across a reboot or a restart of Docker. A JSON settings file cannot be written, so a
game whose settings live in one is not expressible. The one game run for real, Factorio, was
checked to the ready line, the console, a backup, a template, a clone, a crash that reached a
webhook and a retirement with the server running, but **no client joined it**, so its player
count is only the pattern from the game's documented log format. The Linux installer's
`--community-games` was run through its argument handling and its helper's tests and the real
`join --capabilities community-games` was run on this machine, but a fresh join through
`install.sh` on a second Linux node was not: the throw-away VPS already holds a node and a
panel at 0.4.1, and upgrading it was not part of this. `verify:backups` was not run: its stand-in
image can no longer be pulled. Not started: Server Address and SRV (0.7), metrics (0.7), a second
kind of provider (0.8).

### A server's address, and a month of history (0.7.0)

Two features that do not depend on each other, cut together: the records behind an address — so that
a Minecraft server is reached by its name alone — and the history the panel keeps of servers and nodes,
with the network in it.

**Measured first.** Against the real code, the verify database, Docker Desktop and the throw-away
Linux machine at a cloud provider. A server had one `host`, one `port` and at most one record, in four
columns; there was no table of records, no SRV, and a node had a single address. A second Java server
on a node holds 25568, not 25565, and a server that moves takes the first free block on the node it
arrives at, so **its port can change** while its name does not — which is the whole case for SRV.
`decide` refused two records at one name, so an A and an AAAA together were an error and not a case.
On the VPS, Docker 29.8.1 with no `daemon.json` published a container's TCP and UDP ports on `0.0.0.0`
and on `[::]`, and a `curl -6` from the machine to its own global address was answered; **an arrival
from another IPv6 machine was not measurable**, since this PC has no IPv6 and there is no third host.
That decided IPv6: an AAAA for an address the panel merely observed would be an address it made up, so
the other family is **the operator's to say**. The agent never sampled — `GEEBOARD_SAMPLE_MS` printed
at start and drove nothing; the panel read the agent's `docker stats` on each pass, wrote CPU, memory
and players, wrote `tps` as the constant 20 for nothing to read, and **read the network counters and
threw them away**. So the plan's line that network metrics needed an agent change was wrong: the
contract stays 1. Four servers for thirty days at 15 seconds, 691,200 rows: **310 bytes a row with its
index, 51 MB for a server over thirty days, 1.0 GB for twenty**; the week's chart loaded about 40,000 rows
and took 160 ms, a month read the same way 560 ms, and the same buckets made in SQL with `date_bin` took
10 ms for a week and 80 ms for thirty days; built, the route's week took 20 ms and its thirty days about
190 — so there is **no table of rollups**, because it would
buy speed that aggregating where the rows are already buys, and costs a second source of truth. Docker's
counters are cumulative **from the container's start and begin again at every restart**: 5.11 MB sent,
then 1.17 kB after a `docker restart`, again after a stop and a start. A delta between two readings is
therefore not a subtraction.

**Decided.** A server's records are rows — A, AAAA, SRV, each with the name it is at, so a record is
removed from where it was written even after the address changed. `wantedRecords` is a pure function
of the host, the node's addresses by family, what the provider can hold and the game's `srv` plan;
`decide` is per kind; the SRV is `0 5 <port> <host>` at `_minecraft._tcp.<host>`. SRV is written
automatically for Minecraft: Java Edition on Cloudflare and for nothing else: Bedrock's client does
not look one up, DuckDNS cannot hold one, and a **manifest cannot carry `srv`**, because it would
write into the owner's own zone. A hand-set node address wins entirely; the observed one is a fallback
for IPv4 only. DuckDNS holds one IPv4 and one IPv6 for the whole subdomain, and its `clear=true`
clears both, so removing one family rewrites the other. History keeps thirty days of raw samples; a
chart asks for at most 120 buckets made by the database. Network is differenced in the panel, with the
rule that a changed `startedAt` or a counter that fell means the delta is the current value. A node
keeps a sample for each poll in which it was reached, and a gap where it was not. Charts are small
multiples — one scale for each measure, never two on one — with a crosshair across them, a tooltip, a
table of the numbers and a window of up to thirty days.

**Built.** `domain/dns/rules.ts` (`wantedRecords`, `decide` for each kind, the SRV plan),
`domain/servers/network.ts` (the delta with its restart rule), `domain/metrics/ranges.ts`,
`lib/metrics.ts` (the SQL), `lib/chart-panels.ts`, `components/usage-chart.tsx`; `SrvPlan` on the game
definition and `srv` on Minecraft: Java; two migrations — the first **copies each server's record into
the new table before dropping the four columns** — and a node's *Public IPv6 address*; the providers
take a record kind; `lib/dns-ops.ts` syncs, forgets and reconciles by kind; the poller writes network,
the world's size and a sample for each node, and prunes both; the DNS page, the server page, the wizard's
review and the node page say what the players will type and which records exist; two routes,
`GET /api/v1/servers/:id/metrics` under `metrics:read` — the scope that opened nothing until now — and
`GET /api/v1/nodes/:name/metrics` under `node.read`; Palworld's query port; `tps`, removed.

**Verified.** The regression before the cut: typecheck and lint; `npm run verify`, 655 unit tests and
every script in its chain — `verify:dns` 144 checks, `verify:poller` 65, `verify:community` 71 — and
registration (114), console (44), terminal (52), agent (24), create (82), pull (14), files (32) and mods
(112); the production build; the daemon's typecheck and its 206 tests, one skipped as before, and **one
failing on the first run and not on the second**, the known Windows test `an agent that stops takes its
shells with it`, in code this release did not touch beyond the version string; `deploy/lib/verify.sh`,
64 checks; the documentation site's build and link check, 1892 internal links. New unit tests for the
rules in every combination of family and provider, the network delta across restarts and resets, the
chart's panels, and an audit that holds every definition, parked ones included, to the registry's rules.
In the running panel, in a browser, against a second panel on the verify database: a node given an IPv4
and an IPv6 and the two refused in each other's field with a sentence; a Java server's A, AAAA and SRV
written at a fake Cloudflare, shown on its page and the DNS page and in the API's `records`, moved to
another port and the SRV with it, and removed with the server; twenty checks. The charts, against a real
container with traffic going through it, restarted once in the middle, managed by a real agent and read
by the poller: a panel for CPU, memory and network, each with a scale of its own and a latest value; a
pointer in a stretch with no data showing no tooltip; a hover reading every panel at one moment, with
the network as rates and their units; the table, newest first, with a dash where nothing could be
measured and no negative number; the 30-day window; the node's own history; and the API with a key —
at most 120 buckets of the width it says, real rates, **none negative and none absurd across the
restart**, a window that does not exist answered with a 400 that names the choices, and a 401 with no
key. Against **the
owner's real Cloudflare zone**, on the VPS and with the owner's yes, using documentation addresses at a
name no server uses: the A, the AAAA and the SRV the new rules would write, written, read back and
found to be what was wanted, the SRV moved to a new port, a record that was not the panel's refused and
not overwritten, and **everything removed — nothing left at the provider** — 15 checks. The migrations, run
on a copy of rows of the old shape: each server's written record came out as a row in the new table.

**Found while testing, and fixed:** the API's one-server route did not load the records, so its
`address.srv` read false for a server that had one; the chart's tooltip took the nearest bucket from
anywhere in the panel, and its crosshair and axis were offset by the width of the axis labels; the
scales ended at 195 KB/s and the like, and now end at a round number; removing a DuckDNS record
cleared the other family too; a node's *Configure* appended to the address already there; and the
`v0.6.0` tag does not contain `manifest:check`, which is in `main` and is in this release.

**Left out, and why.** **No Minecraft client was pointed at the SRV record**: the proof is that the
panel writes the record, that Cloudflare keeps it and that it moves, not that a Java client resolves
it; there is no client here to do it with. **An AAAA was never reached from outside**: the port listens
in IPv6 and the machine answers itself, and that a provider lets it through from another machine is
unproven. SRV is for Minecraft: Java only, and not for any other game or any manifest. There are no
rollups, and nothing is kept past thirty days. A node's network is not recorded, only a server's. The
fresh join through `install.sh --community-games` on a second Linux node, and the container firewall
across a reboot, are still open from 0.6.0, as is `verify:backups`, whose stand-in image cannot be
pulled. The community games repository's CI is pinned to `main` and should move to `v0.7.0`. Not
started: a DNS provider that is a webhook, and Backblaze — which is S3 and needs no new kind (0.8).

### A DNS webhook, and S3 proved (0.8.0)

The roadmap said *no framework before the third case*, and the third case is here. A third DNS provider, which is
any DNS that can be reached by a small program of the operator's own, and the off-site bucket looked at again,
because *Backblaze is S3 and costs no code* was a sentence in the plan and not a result.

**Measured first.** Against the real code, the verify database, Docker Desktop and the images that can still be pulled.
The two providers the DNS code knew were written into it as **`cloudflare ? … : DuckDNS`**, in about a dozen places: three in
`dns-ops.ts` that turn a kind that is not Cloudflare into DuckDNS *in silence* — the client, the configuration, and the
label of every toast and audit line — two in `address.ts` that disagree about which is the default, a wizard and a
settings hint that test the zone for the string `duckdns.org` and not the kind, and a guide the page assumes has exactly
four steps. That DuckDNS cannot be *read* was a `return []` with a comment and not a capability, and `DNS_RECORD_CONFLICT`
was thrown by nobody. What depends on reading is one thing: `decide`, which is the protection from overwriting a record
the panel did not make; **a record changed at the provider by hand is noticed for neither provider**, because the poller
compares rows with what is wanted and never asks. The notification webhooks have what a DNS one needs — the judging of an
address and of every address it resolves to, the guarded call by number with no redirect, the signature — and the DNS
clients' own `askProvider` has none of it, which is safe for two hosts fixed in the code and would be a hole for an address a
person typed. A signature and a timestamp are not an identifier: a notification is signed again with a new timestamp on every
try. And creating, moving and deleting a server wait for the DNS call, so a receiver that is down costs a timeout *for every
server a pass touches*, which was **read and not measured** until the build. On the storage side, SeaweedFS 4.48 took all
eight things the panel asks of an S3 store — a bucket made with the panel's signature, a signed `PUT`, `HEAD`, a presigned
`PUT` of 3 MB with `Content-Length` as the node sends it, the same bytes back from a presigned `GET`, a wrong key refused, a
`DELETE`, and the object gone — in path-style (virtual-hosted could not be tried on this machine, where
`bucket.localhost` does not resolve); keys from its environment, no file. `docker.io/minio/minio` is denied and
`quay.io/minio/minio` has no manifest any more; SeaweedFS, Garage, RustFS and LocalStack can be pulled, and so can BIND, Knot,
PowerDNS and CoreDNS: **a webhook can be proved to the end against a DNS server that is real**.

**Decided.** One table says what a provider is: `DNS_PROVIDERS` has the label, the fixed zone, whether it holds an SRV,
whether it can be read, and what the panel may call a record it took — *written* for Cloudflare and DuckDNS, *accepted* for
a receiver, whose `2xx` says it will act and not that the DNS changed. A kind that is not in it is an error. The webhook is
**blind and declarative**: `dns.set` with the whole record, `dns.remove` with its type and name, `dns.test` when it is saved;
signed as a notification is; each of them something that can be said twice, since a record is its type and its name and a set
replaces; with a delivery identifier made of what is asked and not of when. A `2xx` is accepted, `401` and `403` are the
secret refused, `408`, `429`, `5xx` and silence are a failure the five-minute retry covers, any other `4xx` is that record
refused — so a receiver that keeps no SRV can answer `422` — and the receiver's words are **never read**. It goes out through the
notification guard and its address rules, with the same environment variable for a receiver on the LAN and no new one. The secret
is made by the panel **in the form, before the receiver has to hold it**, because a receiver that checks signatures cannot
answer the test that saves the provider without it, and a secret shown after saving would mean a test that fails by design; the
address is stored encrypted beside it, in a column of its own, and `rekey` seals both. The panel sends **what changed** and not
everything: with nothing to read, what it kept of the last send is what it knows, and *Retry now* is the one thing that sends
again. A provider that could not be asked at all is not asked again in the same pass, nor for five minutes. For storage:
the presets are data, the region **follows the endpoint** where the endpoint carries one and a region that contradicts it is refused
with the right one, a store's refusal is explained where there is something to do, and a provider Geeboard has not been run
against says so on the form. The stand-in store is SeaweedFS, pinned.

**Built.** `DNS_PROVIDERS` and `providerFacts` in `domain/dns/rules.ts`, read by the guide, the address wording and the ops;
`domain/dns/webhook.ts` (the bodies, the delivery identifier, the reading of a status, the secret's rule) and
`lib/dns/webhook.ts` (the client, through the guarded call); `ProviderUnreachable` and the poller's backoff, with the
count of what was left for later in its report; `DnsProvider.endpoint` and its migration; the form with its secret and its
address; *accepted* and *not taken* on the DNS page and the server's page; `examples/dns-webhook/receiver.mjs` and
`docs/dns-webhook.md`, which shows it. `domain/storage/presets.ts`, the form that asks where the bucket is, the check that refuses
a contradicted region, and the advice on a store's codes; `verify:backups` on SeaweedFS; and `PROBE_ATTEMPTS` in the regular-expression guard.

**Verified.** The regression before the cut: typecheck and lint; `npm run verify`, 689 unit tests and every script in its chain, among them `verify:dns` at **189 checks** (it was 144), `verify:rekey` at 36 with the webhook's address as an eleventh sealed value, `verify:poller` and `verify:community`; registration, console, terminal, agent, create, pull, files and mods; **`verify:backups`, 148 checks, which had not run since MinIO's image went**; the production build; the daemon's typecheck and tests; `deploy/lib/verify.sh`; the documentation site's build and link check. New unit tests: the table of providers and what a kind that is not in it does (`dns-webhook`, 14), the receiver — the file the page shows, run as a process against a stand-in for `nsupdate`, asked every status the page names (`dns-webhook-receiver`, 9) — the presets and the region check (`storage-presets`, 5), and the guide, the address wording and the hints for three kinds in `dns`. `verify:dns` stands a receiver that checks signatures at this machine's address on the network, since a webhook is never called on loopback, and runs: configure with a private address refused unless the operator allowed it, the machine itself refused whatever was allowed, a short secret, a secret the receiver does not hold (**refused, and called the secret**), a receiver that answers 503 (**not the secret, and its words nowhere**), a good one saved with a signed `dns.test` and the secret and the address stored encrypted and opening to what they were; a Java server sent its A and its SRV and nothing else, with the zone, the name, the address, the time to live, the marker, the port as text and as four fields, a delivery identifier of its own on each; *Retry now* sending both again **with the same identifiers**; a change of port sending the SRV alone; a node that moved sending the A alone; an IPv6 address sending an AAAA and taking it away sending a remove; a `422` for the SRV failing the SRV and not the A, with the status and not the receiver's words in the audit log; a name outside the zone never sent; a receiver that never answers — **a pass over six servers took 5.1 seconds, one timeout and not six, and the next pass did not ask**; a server created while it answers 503, created, with a warning; deleting sending a remove for each record; and the audit log with neither the secret nor the path in it. In the running panel, in a browser, on the verify database as the owner (enrolled in two-factor there and nowhere else), and against **a real BIND 9.20 in a container, a zone that takes updates signed with a key, and the reference receiver running `nsupdate` against it** — 26 checks: the third provider offered with its steps; a secret made in the form, said to be shown once, and nothing stored by making it; the receiver started with it; the test answered and the provider saved, BIND's serial unmoved by it; the page naming the receiver's host and the zone and neither the secret nor the path, **in the page or in its source**; a Java server made in the wizard with the address hint saying the record goes to the receiver; the server's page saying *accepted by the receiver* and *found by SRV*; **`dig` answering the A, the AAAA and `0 5 <port> aurora.example.test.` at `_minecraft._tcp`**; the DNS page counting it accepted with its three records; *Retry now* sending all three again and BIND unchanged; a change of block sending the SRV alone and BIND answering with the new port; the receiver stopped — the panel saying so, the server untouched, BIND still with the old address, the page saying *not taken* and why — and started again, the next try taken and BIND answering with the new address; deleting the server and **BIND answering with nothing for all three**; neither secret nor path in the audit log; and a request with a wrong signature, sent straight to the receiver, changing nothing. And the storage form, in a browser, against a SeaweedFS in a container — 15 checks: the four stores offered; what Backblaze asks for and that Geeboard has been run against it, and has not been against Amazon; the region filled in from the endpoint; **a region the endpoint contradicts refused before any request, naming the right one**; a real store taking the test upload and the bucket saved without the secret on the page; and a wrong secret at a real store refused with its code and what to check. **And a real store**: a private Backblaze B2 bucket in eu-central-003 and an application key for that bucket alone, with the off-site half of `verify:backups` pointed at it (`GEEBOARD_VERIFY_STORE`, a file outside the repository, under a prefix the run makes up). **The first save was refused: `411 MissingContentLength`** — *Backblaze is S3 and costs no code* was wrong by one line. Then **147 checks passed virtual-hosted and 147 path-style**: the keys, the test upload and its delete, an off-site backup in the bucket and not on the node, a verify with the node pulling it down and hashing it, a restore, a scheduled backup, retention, deleting a backup and a server's last backup, a move through the bucket; and what each run left was removed through Backblaze's own API, since a `DELETE` over S3 hides. Step 11, measured: with the lifecycle rule *keep only the last version*, every object the run had deleted was still in the bucket — the upload and a hide marker — minutes later, since the rule is *delete a hidden version a day after it was hidden*. A deleted backup is billed for about a day, which the form and the page now say.

**Found while testing, and fixed:** **the panel's own test upload was sent chunked**, which Backblaze refuses with `411 MissingContentLength` and MinIO and SeaweedFS do not — the guarded call wrote the body and then ended the request, and Node sends that without a length — so no store the panel had been run against could have shown it, and a first save at Backblaze could not have worked; a body now goes with its length, for the notification webhooks and the DNS one too, which a test now holds to be so; the wizard's and the settings' address hints decided *DuckDNS or not* by testing the zone for the string `duckdns.org`, so a webhook on that zone — or a third kind on any zone — would have been worded as the wrong provider; a kind that was not Cloudflare became DuckDNS in `dns-ops` without a word; **a blind provider sent every record of a server when one changed** — an SRV with the A of a node that moved — which a test written to say otherwise showed, and it now sends what changed, and everything on *Retry now*; a server whose first record met a receiver that was down left its other records with no row, which the poller would have taken for ones it had not tried and called again on every pass, so they are marked failed without a call; the first design showed the secret *after* saving, which a receiver that checks signatures cannot live with, since the test that saves is signed with a secret it has not been told; a store's refusal read *signing method.. That is usually* with two full stops, which the screenshot showed; the first full `npm run verify` of the regression **stopped at its first failing unit test and never ran the scripts after it**, which is how a chain joined by `&&` reports, and why it was run again once the test was right; and the manifest checker, which gives a regular expression 40 milliseconds on a line of 2001 characters, **refused good manifests on a busy machine**: three tests failed with `verify:backups` running beside them and a fourth in the regression's own run, and they pass alone. The watchdog that cuts a script off fires when its thread is not scheduled as much as when the expression is slow, so a person who proposed a fine game was told to rewrite it. A line is now tried **three times, and an expression is slow only if it is on every try**; a backtracking one is cut off at the budget each time, so it costs three budgets and not one and is still refused. That is a change to a 0.6.0 defence, made because the defence was wrong in the direction that costs somebody an evening and not in the one that costs a node.

**Left out, and why.** **No receiver but one was run**: BIND 9.20 with `nsupdate`; Knot and PowerDNS take the same update and were not tried (they were, by the same receiver, in the audit before 0.9.0: 33 checks, none failing), and no receiver was written for an API (Route 53, Gandi, OVH), which is what a receiver is for. **The panel does not read**: through a webhook it cannot tell a record somebody else made from its own, and **a record changed at the DNS by hand is noticed for no provider** — the poller sends what changed, not what is there; a webhook that answers *what is at this name* would give a deviation a name, and was not built. **Amazon S3 and Cloudflare R2 were not run**: what the form asks for them is from their documentation, says so, and the procedure for a real one is in [field-checks.md](field-checks.md#off-site-backups-against-a-real-provider). Backblaze was run in one region, eu-central-003, with one key, and with a bucket that already had its lifecycle rule; the same run **without** the rule, which is Backblaze's default, was not made, and what it keeps is said from the measured behaviour of a delete and not from a second bucket. Virtual-hosted addressing was run against Backblaze and against no local store, since `bucket.localhost` does not resolve on this machine and SeaweedFS wants a domain configured for it. The bucket's own lifecycle is not read or set by the panel. The delivery identifier is stable and **no receiver in the repository uses it**: the reference one is safe to repeat because a set replaces, and says so. The things still open from 0.6 and 0.7 — `install.sh --community-games` on a second Linux node, the container firewall across a reboot, an AAAA reached from another IPv6 machine and a Minecraft client pointed at an SRV record — go with the matrix in 0.9, by the answer given in the plan; `verify:backups` **is closed**. The community repository's CI is pinned to `main` and should move to `v0.8.0`.

**After the tag.** `v0.8.0` was pushed and its release did not happen. The panel job of CI, which the release runs first
and publishes nothing without, had been failing since 0.5.0: `verify:templates` starts a real agent from `daemon/`, the job had
never installed the agent's packages, and the script timed out waiting for it; `verify:community`, after it in the chain,
refuses a database not named `geeboard_verify`, which the job's was not. Neither showed locally, where both pass, and the result
of CI was no part of a cut's checklist: three pushes in a row failed without anybody reading it. So no image was published for 0.5.0
or 0.8.0, and `v0.6.0` and `v0.7.0` were never pushed. Both repairs were tried on a branch before `main`, and the panel job passed —
the unit tests, the whole `verify` chain, the build. The job that builds the panel's image did not run on that branch: GitHub could
not give it a runner, twice, and it had passed on the push before. The tag was left where it was and the fix released as
**0.8.1**, rather than moving a tag that had been public for a day. What changes in how a cut is made: its last step is to read
the CI of the commit that was pushed, and not only the regression that was run here.

### Nothing is trusted because it is written (0.9.0)

0.9.0 adds nothing a player would notice, on purpose. The brief says 1.0 is when adding a game, a node, a provider or a storage needs no change of
architecture and the thing has been run, and the honest state at 0.8.1 was that the code said many things nobody had made it prove. So the release was
an audit, and then the work the audit asked for: thirteen reports written from the code and from machines (the installers, the upgrade path, the
agent and the panel under failure, error messages, accessibility, performance, the release process, the extension points, the documentation against
the code), merged into thirty-four parts, each with the finding behind it and a line that says when it is done; and a list of real situations, run
on real machines, which is what [release-matrix.md](release-matrix.md) is.

**What the audit found, in a sentence each, that was serious.** A request of one line, sent to a node's port with no token, made the agent exit. A page
asked "are you an owner, an admin or whoever owns this server" and never what the person's role may do, so a member could delete a server the REST API
refused them. An upgrade took no dump, migrated under a running panel, and printed nothing about going back. The cleanup of backups kept the newest
rows and a row can be a failed backup, so seven days of failures removed every good one. A restore emptied the world before it knew the archive was
whole. After a reboot every server stayed down whatever its restart policy said, and nothing said why. A Windows node could not join a panel at an
address at all (the certificate), had no log, was not supervised and was not replaced cleanly by a second install. A second poller would have sent
every notification twice and run every scheduled backup twice. A path checked and then used by name could be swapped by a game for a link out of its
folder. `git pull` aborted on a checkout the installer had touched. The documentation named an image that did not exist for days after a tag.

**What was built** is in [the changelog](https://github.com/DanieleMarino70/Geeboard/blob/main/CHANGELOG.md) at length; in short. *Safe by default:* one
permission table for every page and route; an agent that survives bad input and stops in under a second; backups that count only complete ones and
restores that unpack beside the world and swap; an upgrade that dumps, stops, migrates once, starts, says how to undo and refuses a database it does
not match; an installer re-run that reads the machine (a domain stays a domain); servers that come back after a reboot by their policy, and say why
when they do not; one poller, enforced by a lock in the database; a watchdog that shows its last pass. *Installable by a stranger:* the scripts are
recorded executable; the installer says what it checked before it changes anything, closes the agent's port to everybody but the panel, makes a nightly
dump, and works on Ubuntu 22.04 and behind NAT; the node trusts the panel at an address by a fingerprint in the command; the Windows agent has a log, a
supervisor, a data root only its account reads, and a doctor; a lost panel can be put back from a dump and a copy of its secrets. *Believable:* every
operation has an owner and a beat so that a stopped process gives it back; errors keep their cause and carry a reference; pages do not wait on a node that
is down and show its servers as unknown; the API says what it does (a code with every refusal, every route held to a page by a test). *Usable:* every page
has a title and a way past the sidebar, reaches a phone at 320 px, keeps its feedback until read, and meets contrast in both themes; the console does not
speak every line; the first server on a 3 GB machine is the size the machine can hold; a machine that is gone can be forgotten. *Releasable:* a cut that
cannot publish a lie (the tag must be on a pushed, green main; both images are pushed under a name nobody reads before the names people use; the draft is
made once; `stable` moves last), CI that installs the panel, builds both images and parses every script under Windows PowerShell 5.1, a weekly run of
every check, and `docs/extending.md`, which says what adding a game, a node, a provider or a storage costs in files and holds the claim with a test.

**Measured first, and again at the end.** Against the real code on the machines the project has: a Debian 13 VPS, a Windows 11 PC with Docker Desktop and
two WSL2 distributions, GitHub's runners. The list and its results are in [release-matrix.md](release-matrix.md). Among the numbers: a panel from 0.4.1 upgraded
in place with two running Terraria servers was out of service for 27 seconds and its game containers did not restart; the panel's image builds in 2 GB and
not in 1.5; a database of a month of three servers and a year of audit answers every page in under half a second, and ten times that in about two seconds at the
slowest (a free-text search of the audit log); the poller's pass over three servers went from 5.3 s to 0.3 s; a panel behind a router that cannot reach itself is told so by the installer instead of
being called broken.

**Found on machines, and fixed.** A 0.4.1 panel upgraded to 0.9 read every running server as unhealthy (it had never written down when the console said it
was ready). Ubuntu 22.04 has no Caddy package and the installer died after building the image. Behind NAT the last check asked the machine's own public
address and called a good install broken (and curl, which sends no name for an address, cannot ask Caddy for one: openssl can). The installer replaced a
newer build with the published older image and said all was well. The database container's 64 MB of shared memory stopped a VACUUM on a large table. A node's
own page drew a dead node's servers as Running. A port unit outlived the node it belonged to. An agent on 0.4.0 does need upgrading for a 0.5 or later panel, which the notes of five
releases had said it did not (a real 0.3.5 agent, which sends no contract either, was refused by every panel it was tried against). Each is in the changelog with the line that fixes it.

**Decisions, and what was chosen.** The owner's answers: after a reboot, a server's policy decides (panel-side, no agent change). The upgrade is the installer's
re-run, with a dump on by default. A node at an address trusts the panel by a fingerprint in its command. The panel–agent channel is declared plain HTTP, closed to
all but the panel by default, with a VPN advised for a remote node. One panel and one poller, declared, and the poller enforced. A restore needs room for two copies,
or says so and offers to restore in place. The wizard fits a small node. The cut is rehearsed without publishing, and arm64 is a line in the documentation. The Windows
agent never elevates by itself and starts at sign-in. The 1.0 sentence is written with its boundaries. A release only adds to the database and the next one removes,
which is what makes an image-only rollback possible. The audit log is kept for ever, with indexes. **Taken while the owner was away, and open to change:** contrast keeps
the brand's fills and adds darker text and a control border; a dead node's server can be forgotten; the API's error codes were fixed now, while that is cheap, and `v1` is
additive-only; the repository's settings are files in `.github/` (a ruleset for tags, Dependabot, `SECURITY.md`), the tag ruleset to be applied after the last tag.

**Left out, and why.** *Not run:* Cloudflare and Let's Encrypt from this build (no token or name at the time), a second Linux node for community games, an arm64 machine
(the images are amd64 and the documentation says so), a fresh Windows with no Node and no Docker, a Windows node reached by a panel (only registered and heartbeating),
and a person with NVDA, Narrator or VoiceOver. *Known and written down:* the panel–agent channel is not encrypted; images are not signed and have no attestation;
the tables are CSS grids; a burned tag is not recovered by a dispatch; the community repository's pin to a
release is by hand. [limitations.md](limitations.md) is the whole list, and what 1.0 should be is what is on it.

### Audited, and says when to be replaced (0.9.5)

0.9.5 is the last release before 1.0 and it is named for what it is not: not a 1.0, because half of what closes the promise (IPv6 from another network, the
official Minecraft client, a screen reader, a clean Windows PC) is not something the people who write the code can do, and not a new wave, because it adds one small
feature and a lot of proof. The plan was written from the owner's own list of what 1.0 needs, compared with the repository: what 0.9 had already done was taken
out, what the list had missed (a real certificate, a real DNS zone, an upgrade *to* a release and a panel put back) was put in, and the proofs were run **before**
the code so that what they found could be fixed in it.

**The proofs found three installer bugs and one memory floor.** On a Debian VPS from the published 0.9.0, with a real domain: Caddy was never reloaded, because
`systemctl list-unit-files | grep -q` under `pipefail` said the unit was not there (the writer died of the closed pipe); changing a panel's address from an IP to
a name left the node on the same machine calling the old one; and a name that resolves to the machine was not read as the machine, which left the Docker networks
out of the agent's port rule and the node degraded. Paper at its listed minimum of 1 GB was killed by the kernel; the minimum is 2. Cloudflare wrote the records and
four resolvers read them; a protocol client joined a server by a name with no port through the `SRV` record. [release-matrix.md](release-matrix.md) has the list.

**What was built.** A *check for a newer release* (one request in twelve hours for one static file, a person's own policy in `release-policy.json` deciding what is an
update, a recommendation or a security fix, the Dashboard, a page, a notification; off with one line); a *first hour* of four steps on the Dashboard; a sentence for every
state of a server; *rename* in the file manager; controls with the cursors and the gentle motion a person expects; images with a bill of materials, provenance and a
keyless signature made by a workflow that can be run again. And **an audit**: nine reviewers, told to attack, read the whole of it (permissions, sign-in, secrets, the
terminal, files and archives, outgoing requests, the agent, errors and logs, community games), found about fifty things and every one is fixed or written down. The ones
that matter: an admin could make an account an owner by sending an object where a role was declared; a game's process could send the backup archiver through a link it swapped in;
a key that restarts a server could type in the console and delete backups through a scheduled task; a registration token that travelled could take an approved node over;
the agent token was on a command line every local account could read; a manifest's regular expression could be made exponential and was run with no time limit in two
places. The class behind the first is now closed in one place (an argument is checked where it arrives), the class behind the second by walking through directories held open, and
the rest case by case; [limitations.md](limitations.md#found-by-the-audit-of-095-and-left) lists what was found and left, and why.

**Run on the machine, again.** The upgrade from 0.9.0 to the branch with five game servers running: 3 minutes with the build, 5 seconds without the panel, no game container moved;
going back with the commands the installer printed, 5 seconds; a panel lost with its database and secrets and put back from a dump, 67 seconds, the old owner signing in
(the proof that the key came back); the update check against a real file over a real certificate; the firewall script against a rule iptables refuses. Not done, and said: IPv6 from
outside, the official client, a screen reader, a clean Windows PC, arm64, the keyless signature (it exists only for a release that has been cut).

**Decisions, and what was chosen.** The name is 0.9.5, and 1.0.0 will be a cut with no code in it, made when the owner's own proofs are in. The check is on by default and
one line turns it off; it asks for a file and not the API; what is a security update is decided by a person at the cut. Rename is the agent's (it refuses a taken name on every node). Signing
is a separate step after the release, so a failed one is run again without a new tag. Dependabot does not propose the majors a person has to decide (Postgres, Node, TypeScript).
Motion is `transform` and `opacity`, short, and only where the system does not ask for less. A password longer than the hash reads is refused and not cut. A name is one account's,
because the audit log names people by it. No release candidate is ever tagged in public.

## Rules that hold across all of it

- The project stays runnable after every step
- Nothing is removed silently
- Docker stays an implementation detail
- A new game is a definition, not a change to the platform
- Complexity has to earn its place: no Kubernetes, no brokers, no cloud
  provisioning. The one thing done at a provider is a DNS record (0.4.0),
  opt-in, from the panel, with a token that can do that and nothing else
