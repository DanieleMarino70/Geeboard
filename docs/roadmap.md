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

- File-target settings render to patches that nothing writes yet
- Health policies are declared and not executed
- Compatibility is tested but not yet wired into the creation wizard
- Node capabilities are seeded, not reported by the agent
- `linkExistingServers` is best-effort; a server whose version label no longer
  resolves keeps working with no catalog link

## Phase 2 — Game system

- `SteamVersionProvider` (app id → build id, branches), `GitHubVersionProvider`,
  `MinecraftLauncherProvider`, an official-download provider for Terraria
- `IGameInstaller` with progress reporting, and the three install strategies
  behind it
- Config file writing: create with `start: false`, patch `serverconfig.txt` and
  `servertest.ini` through the file API that already exists, then start
- Version outlook surfaced in the UI

## Phase 3 — Node platform

- Registration: panel mints a token, node registers, an admin approves, the node
  goes active; tokens revocable and rotatable
- Heartbeat with real CPU, memory, disk and capability detection, replacing the
  seeded figures
- Node health states over time — degraded at 30 seconds without a heartbeat,
  offline at two minutes, rather than one failed request meaning dead
- `NodePlacementService`: rank compatible nodes by headroom and region, and show
  the reasoning
- Compatibility wired into the wizard's node step

## Phase 4 — Server management

- Game-aware settings UI generated from `ConfigField[]`, replacing the fixed
  Minecraft-shaped settings form
- Health checks executed: port, log pattern, game query, RCON
- `UNHEALTHY` set by something rather than only defined
- Installation progress streamed to the creation flow

## Phase 5 — Operations

- Backups that copy bytes, with a storage abstraction (local, S3-compatible)
- Restore, verification, retention
- Updates: back up, stop, install, migrate config, start, health check, roll back
- Crash recovery policies with attempt limits, so nothing restart-loops
- Migration between nodes

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
