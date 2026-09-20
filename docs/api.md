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

Every scope on the API keys page has routes behind it:

| Scope | Grants | Routes |
| --- | --- | --- |
| `servers:read` | `server.read`, `node.read`, `game.read`, `server.backup.read` | every `GET` under `/servers`, `/backups`, `/nodes`, `/games` |
| `servers:write` | start, stop, restart, update, settings, schedule | `/start` `/stop` `/restart` `/update` `/rollback`, `PATCH …/settings`, `…/settings/game`, tasks |
| `servers:manage` | `server.create`, `server.delete`, `server.update` | `POST /servers`, `DELETE /servers/:id`, `/move` |
| `console:write` | `server.console.read`, `server.console.write` | `/logs`, `POST …/console` |
| `files:read` | `server.files.read` | `GET …/files`, `GET …/files/content` |
| `files:write` | `server.files.read`, `server.files.write` | `PUT …/files/content`, `POST …/files/directories`, `DELETE …/files` |
| `backups:write` | `server.backup.read`, `server.backup.write` | `POST …/backups`, `/restore`, `/lock`, `DELETE /backups/:id` |
| `metrics:read` | `server.read` | the server shapes' `resources` and `players` |
| `nodes:manage` | `node.read`, `node.manage` | `/drain` `/approve` `/reject`, `DELETE /nodes/:name` |
| `audit:read` | `audit.read` | `GET /audit` |

A scope is a bundle of permissions and the role still decides: a moderator's
key with `servers:manage` cannot create a server, because a moderator cannot,
and gets `FORBIDDEN` where a key missing the scope gets `INSUFFICIENT_SCOPE`.
Scopes with no route behind them are marked on the API keys page and refused at
creation; there are none at the moment, and the mark stays so a future scope
cannot be issued before its routes exist.

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

Rate limit: 120 requests a minute per principal for reads, 60 for small writes
(console, files, tasks, locks, node state), 30 for lifecycle actions and
settings, 10 for the expensive ones (create, delete, update, rollback, move,
backup, restore, run a task now). Each budget is its own window: a hundred
reads do not use up the ten creations. Over the budget is `RATE_LIMITED` with
`details.retryAfterSeconds`.

A refusal by the operation itself — the same one the panel's button would
show — comes back as the code the route names below with the operation's
title and text in `message`. `INTERNAL` is reserved for things that went
wrong, never for "no".

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

### `POST /api/v1/nodes/:name/drain` · `/approve` · `/reject`

Need `node.manage`. Drain takes `{ "drain": true | false }`: draining keeps the
servers running and refuses new ones; false brings the node back. Approve and
reject act on a node that registered and is waiting. All three call the Nodes
page's own operations, so the audit entry is the same.

`NODE_NOT_FOUND` for an unknown name; `CONFLICT` when the node is not in a
state the action applies to — already draining, not pending.

### `DELETE /api/v1/nodes/:name`

Needs `node.manage`. Body `{ "confirm": "<the node's name>" }`, the same typed
name the retirement dialog asks for. The checklist is the dialog's: a node with
servers on it is refused with `CONFLICT` and the reason; the panel does not
touch the machine. `NODE_NOT_FOUND` for an unknown name.

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

### `POST /api/v1/servers`

Needs `server.create`. The creation wizard's operation, with the wizard's
fields:

```json
{ "name": "Aurora SMP", "host": "aurora.ashfold.gg",
  "gameId": "minecraft-java", "versionId": "paper-1-21-4",
  "templateId": "survival", "nodeName": "fra-node-02",
  "memoryGb": 4, "cpuLimit": 200, "diskGb": 20,
  "settings": { "maxPlayers": 12 } }
```

`settings` is optional and uses the game's own keys — anything the wizard's
settings step would have asked. `201` with the server shape and a `message`.
Ten a minute per principal: an install pulls an image and writes a world.

The wizard's refusals come back as `VALIDATION_FAILED` with the message and
the input echoed (without `settings`): a node that cannot run the game, no room
on it, a port that cannot be found, a name already taken. A node without an
agent gets a simulated server, marked as such, exactly as the wizard does on a
fixture node.

### `DELETE /api/v1/servers/:id`

Needs `server.delete` on that server. Body `{ "confirm": "<the server's
name>" }`. A wrong name is `VALIDATION_FAILED`; a server the operation will not
delete right now (mid-move, mid-update) is `SERVER_STATE_INVALID`. The
container, the world and the local backups go with it; off-site archives stay
in the bucket, as the panel says when it deletes.

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

### `GET /api/v1/servers/:id/settings`

Needs `server.read`. Both halves of the settings page:

```json
{ "server": "aurora",
  "platform": { "name": "Aurora SMP", "host": "aurora.ashfold.gg",
                "memoryLimit": 8, "cpuLimit": 300,
                "restartPolicy": "ON_FAILURE", "maxRestarts": 3 },
  "game": { "fields": [{ "key": "maxPlayers", "label": "Max players", "type": "number",
                         "default": 20, "options": null,
                         "restartRequired": true, "fixedAfterCreation": false }],
            "stored": { "maxPlayers": 40 },
            "onServer": { "maxPlayers": 40 },
            "drift": [] } }
```

`stored` is what the panel wrote; `onServer` is what the node's files say
right now, or `null` when there is no agent to ask; `drift` lists keys where the
two disagree. `game` is `null` for a server whose game is no longer known.

### `PATCH /api/v1/servers/:id/settings`

Needs `server.settings.write`. Any subset of `name`, `host`, `memoryLimit`,
`cpuLimit`, `restartPolicy` (`NEVER`, `ON_FAILURE`, `ALWAYS`), `maxRestarts`;
fields left out keep their value. The settings page's operation, which audits
the before and after of each field. `rebuildRequired` in the answer says a
resource change waits for the next restart. Refusals are `VALIDATION_FAILED`
with `details.errors`.

### `PATCH /api/v1/servers/:id/settings/game`

Needs `server.settings.write`. Body `{ "values": { "maxPlayers": 20 },
"recreate": false }` with the game's own keys.

A value that lives in a file is written to the node and takes effect as the
game's definition says (restart or not). A value the game reads from its
environment needs the workload rebuilt: the first call is refused with
`CONFLICT` and `details.plan` saying what a rebuild would change; sending
`recreate: true` accepts that, and the server restarts with the new
environment. A key the game does not have, or one fixed after creation, is
`VALIDATION_FAILED`.

### `POST /api/v1/servers/:id/console`

Needs `server.console.write`. Body `{ "command": "say hello" }`: one line to
the game's stdin (or its RCON, where the game has no stdin). Multi-line input
is refused, so a second command cannot be smuggled in. `202`; every command is
written to the audit log with its text. `SERVER_STATE_INVALID` when the server
is not running or the node has no agent.

### `POST /api/v1/servers/:id/rollback`

Needs `server.update`. Puts back the version the last update replaced, from the
backup that update took first. Ten a minute. `202`; `SERVER_STATE_INVALID` when
there is nothing to go back to, or the server has no workload yet.

### `POST /api/v1/servers/:id/move`

Needs `server.create` — the same permission as creating, because it is a
creation on the target. Body `{ "node": "fra-node-02" }`. The move goes through
the off-site bucket, stops the server, archives, restores on the target, and
starts it there if it was running. Ten a minute. `202` with a message;
`SERVER_STATE_INVALID` when the server is busy, the target cannot run it, or no
bucket is configured.

### `GET /api/v1/servers/:id/files?path=`

Needs `server.files.read`. The directory listing under the server's data
directory, entries `{ name, path, kind, sizeBytes, modifiedAt, mode }`. Paths are relative
to the server's root; `..` and symlinks out of it are refused by the node, as
in the file manager. `RUNTIME_NOT_ATTACHED` when there is no agent; `NOT_FOUND`
for a path that is not there.

### `GET` · `PUT /api/v1/servers/:id/files/content?path=`

`GET` needs `server.files.read` and returns `{ content, truncated, sizeBytes }`
— text only, cut at the file manager's limit with `truncated: true`. `PUT`
needs `server.files.write` with body `{ "content": "…" }` and replaces the whole
file; the game reads it when it next reads it. The write is an audit entry.

### `POST /api/v1/servers/:id/files/directories` · `DELETE …/files?path=`

Need `server.files.write`. `POST` with `{ "path": "mods" }` creates a directory
(`201`); `DELETE` removes a file or a directory, and is audited. Both share the
file manager's refusals: `FORBIDDEN` for a path the node will not touch,
`NOT_FOUND`, `RUNTIME_NOT_ATTACHED`, `RUNTIME_REJECTED` for anything else the
node said no to.

### `GET` · `POST /api/v1/servers/:id/backups`

`GET` needs `server.backup.read`: the server's backups newest first, failed
ones included:

```json
{ "backups": [{ "id": "clb…", "server": "aurora", "name": "2026-09-20-manual",
                "state": "COMPLETE", "trigger": "MANUAL", "store": "S3",
                "sizeBytes": 812345678, "checksum": "sha256:…",
                "durationMs": 41200, "error": null, "createdAt": "…" }] }
```

`POST` needs `server.backup.write`, optional body `{ "store": "LOCAL" | "S3" }`;
absent, the archive goes where the server's backups go by default. Synchronous,
ten a minute — the world is quiesced, archived and hashed. `201` with the
backup shape. `VALIDATION_FAILED` for `S3` with no bucket configured;
`SERVER_STATE_INVALID` when the node has no agent or the server is busy.

Off-site keys and the node's archive path are not in the shape: neither is an
address a client should hold.

### `GET` · `DELETE /api/v1/backups/:id`

`GET` needs `server.backup.read` on the backup's server. `DELETE` needs
`server.backup.write`: a locked backup is `CONFLICT`; an off-site archive is
removed from the bucket by the panel, a local one by the node, and a node that
is gone is `SERVER_STATE_INVALID`.

### `POST /api/v1/backups/:id/restore` · `/lock`

Need `server.backup.write`. Restore stops the server, puts the archive back
(from the bucket for off-site, hashed on the way down) and starts it again if
it was running: `202`, ten a minute, `SERVER_STATE_INVALID` when the backup is
not complete or the server is busy. Lock takes `{ "locked": true | false }`; a
locked backup is skipped by cleanup and cannot be deleted.

### `GET` · `POST /api/v1/servers/:id/tasks`

`GET` needs `server.read`: the server's scheduled tasks. `POST` needs
`server.schedule.write`:

```json
{ "name": "Nightly backup", "kind": "BACKUP", "cron": "0 4 * * *",
  "payload": "" }
```

`kind` is `BACKUP`, `RESTART`, `BROADCAST`, `COMMAND` or `CLEANUP`; `payload`
is the message, the command, or `keep N` for cleanup. The scheduler's rules
apply: every minute is refused, a broadcast on a game that cannot broadcast is
refused, both `VALIDATION_FAILED` with `details.errors`. `201` with the task:

```json
{ "id": "clt…", "server": "aurora", "name": "Nightly backup", "kind": "BACKUP",
  "cron": "0 4 * * *", "payload": "", "enabled": true,
  "lastRunAt": null, "lastResult": null, "nextRunAt": "…" }
```

### `GET` · `PATCH` · `DELETE /api/v1/tasks/:id`, `POST …/run` · `/toggle`

`GET` needs `server.read`; the rest `server.schedule.write` on the task's
server. `PATCH` takes any of `name`, `kind`, `cron`, `payload`, the rest kept.
`run` runs the task now through the scheduler's own runner (`202`, ten a
minute); `toggle` pauses an enabled task and enables a paused one. The poller
is what runs tasks on time; a task created here waits for it like any other.

### `GET /api/v1/audit?q=&actor=&days=&server=&page=`

Needs `audit.read`. The audit log as the Audit page reads it — the same
filters, the same page size, newest first. `server` is a slug, `days` a window
back from now, `page` from 1.

```json
{ "events": [{ "id": "cle…", "at": "…", "actor": "Mara Ashfold",
               "action": "console.command", "target": "aurora",
               "tone": "info", "server": { "slug": "aurora", "name": "Aurora SMP" },
               "changes": null }],
  "page": 1, "pages": 24, "total": 583, "pageSize": 25 }
```

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

- Live console output, metrics history and file downloads are the browser's
  (SSE and streaming routes under `/api/servers/:slug`), not this API: a
  program gets `/logs`, the current `resources`, and file contents as text
- Members, API keys, accounts and the off-site storage configuration are
  managed from the panel only. Issuing a key with a key would be a way to
  outlive revocation
- Uploading a file, or reading a binary one, has no route: content is text
- No webhooks or long-poll: a client that started something with a `202`
  polls the server or the backup for its state

## Checking it

`npm run verify:api` in `web/` mints three keys — everything, read-only, and a
moderator's with `servers:manage` — and calls every route above through its
handler: creation on a fixture node, both halves of settings, a game setting
that needs a rebuild, the node-reaching routes against a node with no agent
(each refused with a code, never a 500), tasks end to end, the audit log, node
state, and deletion with the typed name. It reseeds when done and is part of
`npm run verify`.
