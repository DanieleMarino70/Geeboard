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

## Phase 6 — Extensibility

- `ModManager`, `WorkshopProvider`
- More games, more version providers

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
- Nothing rotates `SECRETS_KEY`. Changing it means registering every node again
- No published image yet, for the panel or the agent — that is the release
  workflow, Phase 8
- The sign-in form has not been driven from a browser by a machine here: the
  flow was proved through the operations, the gate against a running panel, and
  TLS through the documented Caddy configuration

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
- The sign-in form has still not been driven from a browser by a machine here

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

## Rules that hold across all of it

- The project stays runnable after every step
- Nothing is removed silently
- Docker stays an implementation detail
- A new game is a definition, not a change to the platform
- Complexity has to earn its place: no Kubernetes, no brokers, no cloud
  provisioning
