# HTTP API

Base path `/api/v1`. Everything speaks in games, versions, nodes and servers.
No route mentions a container, an image or a Docker id — those are internal to
the runtime, and a client that learned to depend on them would break the day a
node ran something else.

## Authenticating

Either a session cookie (the browser, already signed in) or an API key:

```
Authorization: Bearer gbk_live_…
```

A key's scopes narrow its owner's permissions and never widen them. See
[security.md](security.md).

## Errors

```json
{ "code": "NODE_INCOMPATIBLE",
  "message": "mil-node-01 cannot run Project Zomboid.",
  "details": { "missing": ["steamcmd"] } }
```

`code` is stable and is what to switch on. `message` is written for a person.
`details` is optional structure.

| Code | Status |
| --- | --- |
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN`, `INSUFFICIENT_SCOPE` | 403 |
| `VALIDATION_FAILED` | 400 |
| `NOT_FOUND`, `GAME_NOT_FOUND`, `GAME_VERSION_NOT_FOUND`, `NODE_NOT_FOUND` | 404 |
| `CONFLICT`, `NODE_UNAVAILABLE`, `CAPACITY_EXHAUSTED`, `NO_PORTS_AVAILABLE`, `RUNTIME_NOT_ATTACHED`, `SERVER_STATE_INVALID` | 409 |
| `RATE_LIMITED` | 429 |
| `GAME_VERSION_UNSUPPORTED`, `NODE_INCOMPATIBLE`, `RUNTIME_REJECTED` | 422 |
| `RUNTIME_UNREACHABLE`, `VERSION_PROVIDER_FAILED` | 502 |
| `SERVER_INSTALLATION_FAILED`, `INTERNAL` | 500 |

Rate limit: 120 requests a minute per principal, 30 for lifecycle actions.

## Games

### `GET /api/v1/games`

Needs `game.read`.

```json
{ "games": [
  { "id": "terraria", "name": "Terraria", "family": "Terraria",
    "official": true, "install": "image",
    "requirements": { "memoryGbMin": 1, "cpuPctMin": 50, "diskGbMin": 5,
                      "os": ["linux"], "arch": ["x64"],
                      "capabilities": ["docker"] },
    "defaults": { "memoryGb": 2, "cpuLimit": 150, "diskGb": 10, "playersMax": 16 },
    "limits": { "memoryGb": [1, 8], "cpuLimit": [50, 400], "diskGb": [5, 60] },
    "ports": [{ "id": "game", "label": "Game", "protocol": "tcp",
                "primary": true, "public": true }],
    "settings": [{ "key": "maxPlayers", "label": "Max players", "type": "number",
                   "default": 16, "min": 1, "max": 255, "group": "Players",
                   "restartRequired": true, "advanced": false, "options": null }],
    "templates": [{ "id": "classic", "name": "Classic", "summary": "…" }],
    "versionCount": 3 } ] }
```

`settings` is the game's whole configuration surface, which is enough to render
a settings form without knowing anything about the game.

### `GET /api/v1/games/:id`

One game, same shape.

### `GET /api/v1/games/:id/versions`

```json
{ "gameId": "terraria",
  "latest": { "game": "1.4.4.9", "server": "1.4.4.9", "supported": "1.4.4.9" },
  "recommended": "vanilla-1-4-4-9",
  "versions": [
    { "id": "vanilla-1-4-4-9", "label": "Terraria 1.4.4.9", "upstream": "1.4.4.9",
      "channel": "stable", "supported": true, "recommended": true,
      "released": "2023-02-14", "note": "…", "origin": "static",
      "branch": null, "buildId": null } ],
  "providerErrors": [] }
```

The three `latest` fields are different questions — see
[versions.md](versions.md). `branch` and `buildId` are set for a game
distributed through Steam, where a build id moving is the only update signal
there is; a build id is never comparable to a version string.

These rows are read from the catalog tables, not fetched live, so this endpoint
never waits on Steam. `providerErrors` is non-empty only on a game that has
never been synced and had to fall back to its definition.

## Nodes

### `GET /api/v1/nodes`

Needs `node.read`.

```json
{ "nodes": [
  { "name": "fra-node-02", "region": "eu-central", "city": "Frankfurt",
    "state": "HEALTHY", "runtime": "DOCKER", "os": "linux", "arch": "x64",
    "capabilities": ["docker", "steamcmd", "java", "ipv6", "ssd", "backups"],
    "agentVersion": "2.4.1", "attached": true,
    "lastSeenAt": "2026-09-10T18:02:11.000Z", "pingMs": 14,
    "resources": { "cpuCores": 16, "ramTotalGb": 128, "diskTotalGb": 3500,
                   "cpuPct": 48, "ramPct": 61, "diskPct": 39 },
    "servers": 3 } ] }
```

`attached` says whether an agent is configured. The URL and token are never
returned.

### `GET /api/v1/nodes/:name`

Adds `committed` — what has been promised to servers, alongside the totals.
Committed is what decides whether another server fits; live load does not.

## Servers

### `GET /api/v1/servers`

Needs `server.read`. Optional `?game=`, `?node=`, `?state=`.

A caller whose read is scoped to their own servers gets **their** servers, not a
403.

```json
{ "servers": [
  { "id": "clx…", "slug": "aurora", "name": "Aurora SMP", "state": "RUNNING",
    "game": { "id": "minecraft-java", "family": "Minecraft" },
    "version": { "id": "clv…", "label": "Paper 1.21.4" },
    "node": { "name": "fra-node-02", "region": "eu-central" },
    "runtime": "DOCKER",
    "address": { "host": "aurora.ashfold.gg", "port": 25565 },
    "ports": [{ "id": "game", "label": "Game", "port": 25565, "protocol": "both" }],
    "players": { "online": 8, "max": 40 },
    "resources": { "memoryGb": 8, "cpuLimit": 300, "diskGb": 60,
                   "cpuPct": 24, "ramPct": 52 },
    "startedAt": "…", "createdAt": "…", "lastError": null, "owner": "clu…" } ] }
```

Administrative ports (RCON) are filtered out of `ports` — an admin port is not
an address to hand out.

### `GET /api/v1/servers/:id`

By id or slug. Adds the server's `settings` in domain keys, and
`versionOutlook`:

```json
{ "versionOutlook": {
    "installed": "1.4.3.6", "installedLabel": "Terraria 1.4.3.6",
    "gameLatest": "1.4.4.9", "serverLatest": "1.4.4.9",
    "supportedLatest": "1.4.4.9", "recommended": "1.4.4.9",
    "recommendedVersionId": "vanilla-1-4-4-9",
    "updateAvailable": true, "aheadOfSupport": false,
    "branch": null, "installedBuildId": null, "currentBuildId": null,
    "branchUpdatedAt": null, "buildDrift": false } }
```

### `POST /api/v1/servers/:id/start` · `/stop` · `/restart`

Needs `server.start` / `server.stop` / `server.restart` on that server.
`202` with a message; a refusal is `SERVER_STATE_INVALID` with the reason.

These call the same operations as the panel's own buttons, which is the only way
the two can be relied on to behave the same way — including the audit log entry.

### `GET /api/v1/servers/:id/logs?tail=200`

Needs `server.console.read`. Up to 2000 lines, each `{ line, stderr }`.

Live output is the console endpoint (`/api/servers/:slug/console`, SSE), which
belongs to the browser. `RUNTIME_NOT_ATTACHED` when the node has no agent.

## Node routes for agents

Two routes are called by machines rather than people, and are not
user-authenticated.

### `POST /api/v1/nodes/register`

The registration token in the body is the whole credential. Body: `token`,
`name`, `advertiseUrl`, `agentToken`, plus `agentVersion`, `os`, `arch`,
`capabilities` and `resources`. Answers `201` with
`{ node, state, approved }`.

The node lands as `PENDING` and takes no servers until an admin approves it.
Everything in the request is untrusted input from something holding a token; see
[security.md](security.md).

### `POST /api/v1/nodes/heartbeat`

Body: `name`, `token`, and optionally `agentVersion`, `capabilities` and `load`.
Authenticated with the shared agent secret, compared in constant time. Updates
`lastSeenAt` and clears a degraded or unreachable state; it never overrules
draining or maintenance.

## Not yet

`POST /api/v1/servers` (creation), `PATCH` (settings), `DELETE`, `/console`,
`/files`, `/backups`, `/schedules`, `/audit`. Creation and settings arrive with
the game-aware settings work in Phase 4; the rest follow their features.
