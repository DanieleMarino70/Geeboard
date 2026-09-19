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

Keys can be issued for `servers:read`, `servers:write` and `metrics:read` —
the scopes these routes read. `console:write`, `files:read`, `files:write` and
`backups:write` are listed on the API keys page and marked **no endpoint**, and
creating a key with one is refused: consoles, files and backups are driven by
the panel itself and have no route here yet. A key that granted them would grant
nothing while looking like it granted something.

## Errors

```json
{ "code": "NODE_INCOMPATIBLE",
  "message": "mil-node-01 cannot run Project Zomboid.",
  "details": { "missing": ["steamcmd"] } }
```

`code` is stable and is what to switch on. `message` is written for a person.
`details` is optional structure.

A session belonging to an owner or admin who has not yet set up two-factor
sign-in is refused with `FORBIDDEN` on every route, the same as the pages send
them to their account page. An API key is a credential of its own and is not
affected: its scopes and its owner's role decide, as before.

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
      "channel": "stable", "line": "vanilla", "supported": true, "recommended": true,
      "released": "2023-02-14", "note": "…", "origin": "static",
      "branch": null, "buildId": null } ],
  "providerErrors": [] }
```

The three `latest` fields are different questions — see
[versions.md](versions.md). `line` says which versions are updates of each other;
`null` is the game's one line. `branch` and `buildId` are set for a game
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
    "updateTo": { "id": "vanilla-1-4-4-9", "label": "Terraria 1.4.4.9", "upstream": "1.4.4.9" },
    "newerLine": null,
    "updateAvailable": true, "aheadOfSupport": false,
    "branch": null, "installedBuildId": null, "currentBuildId": null,
    "branchUpdatedAt": null, "buildDrift": false } }
```

`updateTo` is what `POST …/update` would accept as an update. `newerLine` is a
newer version in another line — a Zomboid build 41 server gets
`{ "id": "b42", … }` here and `updateTo: null`.

### `POST /api/v1/servers/:id/start` · `/stop` · `/restart`

Needs `server.start` / `server.stop` / `server.restart` on that server.
`202` with a message; a refusal is `SERVER_STATE_INVALID` with the reason.

These call the same operations as the panel's own buttons, which is the only way
the two can be relied on to behave the same way — including the audit log entry.

### `POST /api/v1/servers/:id/update`

Needs `server.update` on that server. Body: `{ "versionId": "paper-1-21-4" }`.

Synchronous, and it can take minutes — a backup of the whole world, an image
pull and a restart. Rate-limited to 10 a minute per principal, the tightest
budget of any route, because it is the most expensive thing a caller can ask
for. A client that cannot wait should poll the server rather than retry: a
second update arriving mid-way through the first is the one thing this must not
be asked to handle.

`202` with a message. A refusal is `SERVER_STATE_INVALID` with the reason —
already on that version, a version Geeboard will not install, a version in a
different line, an older version, or a backup that failed. In every case nothing
was changed; the first four are refused before the backup is taken.

### `GET /api/v1/servers/:id/logs?tail=200`

Needs `server.console.read`. Up to 2000 lines, each `{ line, stderr }`.

Live output is the console endpoint (`/api/servers/:slug/console`, SSE), which
belongs to the browser. `RUNTIME_NOT_ATTACHED` when the node has no agent.

## Node routes for agents

Two routes are called by machines rather than people, and are not
user-authenticated.

### `POST /api/v1/nodes/register`

The registration token in the body is the whole credential. Body: `token`,
`advertiseUrl`, `agentToken`, plus optionally `name`, `agentVersion`, `os`,
`arch`, `capabilities` and `resources`. Answers `201` with
`{ node, state, approved }`.

`os` and `arch` are the container engine's platform. A token only registers the
name it was minted for; any other name is `401` and the token is not spent.
Leaving `name` out registers that name, and `node` in the answer says which it
was — this is how `npm run join` learns its name.
An `os` or `arch` that is not a short lowercase word is stored as unknown.

The node lands as `PENDING` and takes no servers until an admin approves it.
Everything in the request is untrusted input from something holding a token; see
[security.md](security.md).

### `POST /api/v1/nodes/heartbeat`

Body: `name`, `token`, and optionally `agentVersion`, `os`, `arch`,
`capabilities`, `resources` (`cpuCores`, `ramTotalGb`, `diskTotalGb`) and `load`.
Authenticated with the shared agent secret, compared in constant time. Updates
`lastSeenAt`, the node's platform and size, and clears a degraded or unreachable
state; it never overrules draining or maintenance. A platform or size the agent
leaves out keeps its stored value.

## Not yet

`POST /api/v1/servers` (creation), `PATCH` (settings), `DELETE`, `/console`,
`/files`, `/backups`, `/rollback`, `/schedules`, `/audit`, and draining,
approving or removing a node. Game settings, rollback and node retirement can be
done from the panel but not yet over HTTP; the rest follow their features.
