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

**Still outstanding in this phase:**

- **Updates.** The version outlook detects one; performing it needs the
  backup → stop → install → start → health-check → rollback sequence. The parts
  now exist (`PRE_UPDATE` backups, the installer, the recreate path); the
  sequence itself is not written.
- **Migration between nodes.** Needs an archive to move between machines, which
  means the node-to-node transfer that node-local storage does not provide.
- **Scheduled verification** of archives sitting on disk, and pre-delete
  backups.

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
