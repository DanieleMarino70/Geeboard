# HTTP API

Base path `/api/v1`. Everything speaks in games, versions, nodes and servers.
No route mentions a container or a Docker id — those are internal to the
runtime, and a client that learned to depend on them would break the day a node
ran something else. (A game says how it is installed, `"install": "image"`, and
a version names the image it is: that is the game's, not the runtime's.)

## Authenticating

Either a session cookie (the browser, already signed in) or an API key:

```
Authorization: Bearer gbk_live_…
```

A key's scopes narrow its owner's permissions and never widen them. See
[security.md](security.md).

A key **expires a year after it is made** (the API keys page shows the date; an expired key answers
`UNAUTHENTICATED`, "That key has expired."), and it is revoked when its owner's password is reset by an admin, when an
owner runs `recover`, and when its owner signs out other devices.

A request that changes something (`POST`, `PUT`, `PATCH`, `DELETE`) and carries **only a cookie** has to come from
the panel's own origin and, if it has a body, send `Content-Type: application/json`; otherwise it is `FORBIDDEN` or
`VALIDATION_FAILED`. A request with a key is not asked. A console command is one line: a carriage return or a newline
inside it is refused.

Every scope on the API keys page has routes behind it:

| Scope | Grants | Routes |
| --- | --- | --- |
| `servers:read` | `server.read`, `node.read`, `game.read`, `server.backup.read` | every `GET` under `/servers`, `/backups`, `/nodes`, `/games` |
| `servers:write` | start, stop, restart, update, settings, schedule | `/start` `/stop` `/restart` `/update` `/rollback`, `PATCH …/settings`, `…/settings/game`, tasks, every write under `…/mods` — and a join password in the `GET`s of a server's settings |
| `servers:manage` | `server.create`, `server.delete`, `server.update`, `server.assign` | `POST /servers`, `DELETE /servers/:id`, `/move`, `/assign` |
| `console:write` | `server.console.read`, `server.console.write` | `/logs`, `POST …/console` — and the text of a console command in `GET /audit` |
| `files:read` | `server.files.read` | `GET …/files`, `GET …/files/content`, `GET …/files/raw` |
| `files:write` | `server.files.read`, `server.files.write` | `PUT …/files/content`, `PUT …/files/raw`, `POST …/files/directories`, `PATCH …/files`, `DELETE …/files` |
| `backups:write` | `server.backup.read`, `server.backup.write` | `POST …/backups`, `/restore`, `/lock`, `/verify`, `DELETE /backups/:id` |
| `metrics:read` | `server.read` | the server shapes' `resources` and `players`, and `GET /servers/:id/metrics` — and with that every other route that needs `server.read`: a server, its settings, its tasks, its mods. It is `servers:read` without the node, game and backup reads, not a door to the numbers alone; a key that may see CPU may see the server |
| `nodes:manage` | `node.read`, `node.manage` | `/drain` `/approve` `/reject` `/rotate-token`, `DELETE /nodes/:name` |
| `audit:read` | `audit.read` | `GET /audit` |

A scope is a bundle of permissions and the role still decides: a moderator's
key with `servers:manage` cannot create a server, because a moderator cannot,
and gets `FORBIDDEN` where a key missing the scope gets `INSUFFICIENT_SCOPE`.
Two of them also decide what a read answers rather than whether it is allowed:
without `servers:write` a server's settings come without its join password,
and without `console:write` the audit log comes without the text of console
commands. Neither is refused; each says what it left out (0.3.2).
Scopes with no route behind them are marked on the API keys page and refused at
creation; there are none at the moment, and the mark stays so a future scope
cannot be issued before its routes exist. Two permissions are in no scope on
purpose: `node.terminal`, the [node terminal](#the-node-terminal), which a key
can never open, and `dns.manage`, the DNS provider's token, which is set in
the panel only.

## Errors

```json
{ "code": "NODE_INCOMPATIBLE",
  "message": "mil-node-01 cannot run Project Zomboid. Missing SteamCMD",
  "details": { "node": "mil-node-01", "missing": ["steamcmd"], "reasons": ["Missing SteamCMD"] } }
```

`code` is stable and is what to switch on. `message` is written for a person.
`details` is optional structure, and it grows: a key may appear in it that an
earlier release did not send, and a client reads the keys it knows and leaves the
rest. What is promised never changes: a code keeps its meaning and its status, a
field that is documented here keeps its name and its type, and what is added is
new. A new route, a new field and a new value of an enumeration (a setting's `type`,
a node's `capabilities`, a backup's `trigger`, a game's `install`, a backup's `store`)
may arrive in any minor release, so a client that switches over one of them needs a
branch for the value it has not met ([the promise](extending.md#the-promise)).

A session belonging to an owner or admin who has not yet set up two-factor
sign-in is refused with `FORBIDDEN` on every route, the same as the pages send
them to their account page. An API key is a credential of its own and is not
affected: its scopes and its owner's role decide, as before.

| Code | Status |
| --- | --- |
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN`, `INSUFFICIENT_SCOPE` | 403 |
| `VALIDATION_FAILED` | 400 |
| `NOT_FOUND`, `GAME_NOT_FOUND`, `NODE_NOT_FOUND` | 404 |
| `CONFLICT`, `NODE_UNAVAILABLE`, `CAPACITY_EXHAUSTED`, `NO_PORTS_AVAILABLE`, `RUNTIME_NOT_ATTACHED`, `SERVER_STATE_INVALID` | 409 |
| `RATE_LIMITED` | 429 |
| `NODE_INCOMPATIBLE`, `RUNTIME_REJECTED` | 422 |
| `RUNTIME_UNREACHABLE`, `RUNTIME_FAILED`, `MOD_PROVIDER_FAILED`, `MOD_KEY_REFUSED` | 502 |
| `SERVER_INSTALLATION_FAILED`, `SECRETS_UNREADABLE`, `INTERNAL` | 500 |
| `DATABASE_UNAVAILABLE` | 503, with `Retry-After: 5` |

The table is the contract, and `npm run test:unit` holds it to the routes: a code in it that nothing sends,
or one a route can send that it does not list, fails the build. Three codes an earlier version of this
page listed (`GAME_VERSION_NOT_FOUND`, `GAME_VERSION_UNSUPPORTED`, `VERSION_PROVIDER_FAILED`) were never
sent by any route, and are gone from it: a version that cannot be used is refused by the route that took it,
with that route's own code, and a provider that did not answer is a `providerErrors` entry, not a failed request.
`MOD_PROVIDER_FAILED` and `MOD_KEY_REFUSED` are Steam, on the [mods routes](#get--post-apiv1serversidmods):
the Workshop did not answer, or the Steam Web API key was turned down.

`RUNTIME_FAILED` is a node that answered and could not do what it was asked: a port held by something
that is not this server, a disk that is full, an image the registry refused, a folder the agent may not write.
`message` says which, with the node's name; it is not the node being away, and retrying at once will not help.
An error the panel did not foresee is `INTERNAL` and carries `details.reference`, the string to find in the
panel's log (`x-request-id` is the same string when the request had one).

`SECRETS_UNREADABLE` is the panel saying it cannot open something it stored (a node's token, a bucket's
key, a two-factor secret) with the `SECRETS_KEY` it has: the key was edited or a dump was restored beside
another one. Its `message` says what to do; [security.md](security.md#changing-secrets_key) has the rest.

Rate limit, per principal (a key, or a signed-in user) and **per budget**: every route has one of four,
and the routes that share a number share its counter, one minute wide, so a hundred reads do not use up
the ten creations and ten creations do not use up the thirty restarts.

| A minute | Routes |
| --- | --- |
| 120 | every read: all `GET`s except `files/raw` |
| 60 | `POST …/console`; the file routes that write, rename or delete (`PUT …/files/content`, `POST …/files/directories`, `PATCH …/files`, `DELETE …/files`) and `GET …/files/raw`; `POST …/tasks`, `PATCH` and `DELETE /tasks/:id`, `…/toggle`; `…/lock`; node `…/approve`, `…/drain`, `…/reject` |
| 30 | `…/start`, `…/stop`, `…/restart`; `PATCH …/settings` and `…/settings/game`; `…/assign`; `DELETE /nodes/:name`; `DELETE /backups/:id`; the mods writes (`POST`, `PATCH`, `DELETE`, `PUT …/order`); `PUT …/files/raw` |
| 10 | `POST /servers`, `DELETE /servers/:id`, `…/update`, `…/rollback`, `…/move`; `POST …/backups`, `…/restore`, `…/verify`; `…/rotate-token`; `…/tasks/:id/run`; `…/mods/apply`, `…/mods/ask`, `…/mods/collections` |

Over the budget is `RATE_LIMITED` with `details.retryAfterSeconds`; there is no `Retry-After` header. The
counters live in the panel's memory, so a restart empties them, and two panels in front of one database
count separately: the limit bounds a runaway script, not a determined caller
([security.md](security.md#one-instance-and-what-changes-with-more)).

A refusal by the operation itself — the same one the panel's button would
show — comes back with the operation's title and text in `message` and the
code the operation named, or, where it named none, the one the route gives
below. `INTERNAL` is reserved for things that went wrong, never for "no".

### What every answer carries

A success is a JSON object with the thing under its own name — `{ "servers": […] }`, `{ "backups": […] }`,
`{ "events": […], "page": … }`; an action is its message, `{ "message": "…" }`, beside what it made. A failure is
the error above and nothing else. Every answer, success or failure, carries `x-request-id`: the one the
caller sent, if it looks like an id (8 to 64 letters, digits, `.`, `_` or `-`), otherwise one the panel made,
and the same string is on every log line the request wrote and on the call the panel makes to a node. An
`INTERNAL` error's `details.reference` is that string too. Successes carry `cache-control: no-store` and
`x-content-type-options: nosniff`. The exception is `…/files/raw`, in both directions, which skips the proxy
that stamps the id because it must not buffer the body, and makes its own.

## Is the panel up

### `GET /api/health`

Not under `/api/v1`, and needs no key or session: it is what a load balancer or an uptime monitor
asks. `200 {"ok":true,"version":"0.9.0","schema":"20261007100000_poller_state"}` when the database
answered a query (`schema` is the last migration it applied), `503 {"ok":false}` when it did not
within five seconds. Nothing in it says who is on the panel or what is on it.

## Games

### `GET /api/v1/games`

Needs `game.read`.

```json
{ "games": [
  { "id": "terraria", "name": "Terraria", "family": "Terraria",
    "official": true, "community": false, "retired": false, "revision": null,
    "install": "image",
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
a settings form without knowing anything about the game. `install` is `image` for
every game there is; `steamcmd` and `download` are in the type for installs that do not
exist yet, and no game uses either — a client treats a value it does not know as "not
something I can show", and the list of values is one of those that may grow
([the promise](extending.md#the-promise)).

`community` is true for a game somebody wrote and an owner approved
([community-games.md](community-games.md)); its `revision` is
`{ "number": 2, "hash": "<sha256>" }`, the revision that is approved and the hash of the
manifest the approval was bound to, and `official` is false. The list holds only
approved games. `GET /api/v1/games/:id` also answers for one that was retired, with
`"retired": true` and `"revision": null`, because servers of it still exist and
refer to it. **There is no route to propose, approve, turn down or retire a game, and no
scope that could carry one:** approving is an owner at the panel, with a fresh code
from their authenticator.

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
    "agentVersion": "2.4.1", "agentContract": 1, "attached": true,
    "lastSeenAt": "2026-09-10T18:02:11.000Z",
    "lastReachedAt": "2026-09-10T18:02:09.000Z", "pingMs": 14,
    "resources": { "cpuCores": 16, "ramTotalGb": 128, "diskTotalGb": 3500,
                   "cpuPct": 48, "ramPct": 61, "diskPct": 39 },
    "servers": 3 } ] }
```

`attached` says whether an agent is configured. The URL and token are never
returned. `agentContract` is what the agent last reported it speaks, or `null`
for an agent from 0.4.0 or before, which is judged by its release line instead.

### `GET /api/v1/nodes/:name`

Adds `committed` — what has been promised to servers, alongside the totals.
Committed is what decides whether another server fits; live load does not.

### `GET /api/v1/nodes/:name/metrics`

`?range=` as for a server. Needs `node.read`. What the node reported about itself, as the poller recorded
it each time it reached the node:

```json
{ "node": "fra-node-02", "range": "24h", "bucketSeconds": 720, "from": "…", "to": "…",
  "points": [ { "at": "…", "cpuPct": 12.1, "cpuPctMax": 40, "ramPct": 38.5, "ramPctMax": 41,
                "diskPct": 52.3, "pingMs": 9 } ] }
```

Percentages, and milliseconds for the round trip from the panel to the agent. A node the panel could not
reach has no points for the time it was silent.

### `POST /api/v1/nodes/:name/drain` · `/approve` · `/reject`

Need `node.manage`. Drain takes `{ "drain": true | false }`: draining keeps the
servers running and refuses new ones; false brings the node back. Approve and
reject act on a node that registered and is waiting. All three call the Nodes
page's own operations, so the audit entry is the same.

`NODE_NOT_FOUND` for an unknown name; `CONFLICT` when the node is not in a
state the action applies to — already draining, not pending.

### `POST /api/v1/nodes/:name/rotate-token`

Needs `node.manage`. A new agent token for a node in service: the panel makes
it, hands it to the agent over the channel the old one authenticates, stores it
encrypted, and has the agent forget the old one. `{ node, rotated, confirmed,
message }` — **the token is not in the answer, and no route returns one**.
`confirmed: false` means the panel is using the new token and the agent has not
yet confirmed forgetting the old; rotate again once the node answers. `CONFLICT`
for a node with no agent, one whose agent predates rotation, or one whose token
is set by `GEEBOARD_DAEMON_TOKEN` on the machine — nothing was changed in any of
those. Ten a minute.

### `DELETE /api/v1/nodes/:name`

Needs `node.manage`. Body `{ "confirm": "<the node's name>" }`, the same typed
name the retirement dialog asks for. The checklist is the dialog's, and each
item refuses with `CONFLICT` and its own sentence: a node that was never
approved (reject it instead), a node that is still in rotation (drain it
first), a node with servers on it (move or delete them). A wrong name is
`VALIDATION_FAILED`. The panel does not touch the machine. `NODE_NOT_FOUND`
for an unknown name.

## Servers

### `GET /api/v1/servers`

Needs `server.read`. Optional `?game=` (a game id), `?node=` (a node's name) and `?state=` — one of
`CREATING`, `INSTALLING`, `STARTING`, `RUNNING`, `UNHEALTHY`, `STOPPING`, `STOPPED`, `RESTARTING`,
`UPDATING`, `BACKING_UP`, `MIGRATING`, `DELETING`, `CRASHED`, `ERROR`, `SUSPENDED` (the `state` a server
carries; case does not matter). A `?state=` that is none of those is `VALIDATION_FAILED` with
`details.allowed`, not an empty list; `?game=` and `?node=` that match nothing are an empty list.

A caller whose read is scoped to their own servers gets **their** servers, not a
403 — a member, the servers given to them, which may be none. Asking for one
of the others by id is `NOT_FOUND`, as it is in the panel.

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

Each server also carries `dns` (0.4.0): how the records behind its address
stand, `{ "state": "set", "address": "203.0.113.9", "error": null, "byName": true,
"records": [{ "kind": "A", "name": "…", "content": "203.0.113.9", "error": null }, …] }`. `state`
is `none` with no DNS provider configured, `outside` for an address the
provider's zone does not cover, `no-address` while the node has no public
address, `set` once written, `failed` with `error` saying why — the first record that failed.
`address` is the IPv4 address its host points at, or the IPv6 one when there is no other. `records`
(0.7.0) lists what the panel keeps, `A`, `AAAA` and `SRV`, each with the name it is at and what it
says (`0 5 25568 host` for an SRV: priority, weight, port, target), and `byName` is true when the SRV
record is written, so that players need only the host. The server's `address` says the same:
`{ "host": "…", "port": 25568, "srv": true }`. See
[servers.md](servers.md#dns). The provider itself is configured in the panel only.

### `GET /api/v1/servers/:id/metrics`

`?range=1h|6h|24h|7d|30d`, default `24h`. Needs `server.read`, which `metrics:read` carries. The
history the server's page draws (0.7.0), as numbers:

```json
{ "server": "aurora", "range": "24h", "bucketSeconds": 720,
  "from": "…", "to": "…",
  "points": [
    { "at": "2026-10-03T15:12:00.000Z",
      "cpuPct": 31.4, "cpuPctMax": 78, "ramMb": 4210, "ramMbMax": 4390, "players": 4,
      "rxBytesPerSecond": 8120, "txBytesPerSecond": 91400, "diskBytes": 3500000000 } ] }
```

At most 120 points, each a bucket of `bucketSeconds` and the average of the samples in it — with the
highest CPU and memory beside the average, so that a spike is not lost, and the most players. **Units are in
the names.** Network is bytes a second, **averaged over the whole bucket**, so a bucket in which the
server was stopped for half of it says half of what it carried while running. `null` is "not measured": the
first sample of a run has no reading to subtract, the world's size is measured every five minutes, and
nothing recorded before 0.7.0 has network or disk. A bucket with no samples is not listed: a gap in
`points` is a gap in time. Samples are kept for thirty days. A `range` that is not one of the five is `400`.

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

`"overcommit": true` places the server on a node that has not got the memory or
CPU left for it, deliberately — the wizard's checkbox, in one field. It is
recorded as `server.overcommitted` with the node's totals, and it does not
cover storage: a full disk stops every world on the node, so that refusal
stands whatever is asked ([nodes.md](nodes.md#committed-not-used)).

The wizard's refusals come back under the code that says which, with the
wizard's own sentence in `message` and, where there is one, what a client can
act on in `details`:

| Code | When | `details` |
| --- | --- | --- |
| `VALIDATION_FAILED` | the form: a missing or unusable field, a game or version that cannot be used, a size outside the game's limits | `field` where one field is at fault |
| `NODE_NOT_FOUND` | no node of that name | |
| `NODE_UNAVAILABLE` | the node is not approved, draining, under maintenance or unreachable | `node`, `reason` (`not approved`, `draining`, `maintenance`, `unreachable`) |
| `CAPACITY_EXHAUSTED` | no room left on the node, counted from what is promised and not from what is used | `node`, `resource` (`memory`, `cpu`, `storage`), what was asked and what is free, in the resource's own unit (`requestedGb`/`freeGb`, `requestedCores`/`freeCores`) |
| `NODE_INCOMPATIBLE` | the node cannot run the game: platform, or a capability it has not said it has | `node`, `missing` (capability ids), `reasons` (sentences) |
| `CONFLICT` | the address, or the name, is already another server's | `host` for an address |
| `NO_PORTS_AVAILABLE` | no port could be claimed on the node | `node` |
| `SERVER_INSTALLATION_FAILED` (500) | the node was reached and the install failed; the server is removed and a `server.create.failed` audit line keeps the step and the reason, and `message` says what became of what was started | `node`, `step` |

`"overcommit": true` removes the memory and CPU refusal only, as above. A node without an agent gets a
simulated server, marked as such, exactly as the wizard does on a fixture node. The `201` answer is the
server as it was written: it has no `dns` and no `address.srv` yet, because nothing has been asked of the
DNS provider when it is made; `GET /servers/:id` has both a moment later.

### `DELETE /api/v1/servers/:id`

Needs `server.delete` on that server. Body `{ "confirm": "<the server's
name>" }`. A wrong name is `VALIDATION_FAILED`; a server the operation will not
delete right now (a backup, an update, a rebuild, a restore or a move holds it, or it is already
being deleted) is `SERVER_STATE_INVALID` with the reason in `message` ("Busy: an update has been
running for 4 min."). Start, stop and restart are refused the same way, and so is any operation
that needs the server while another holds it: of two requests that begin together, one gets it. The
container, the world and the backups on the node go with it. Off-site backups
do not: their rows stay, no longer attached to a server, and the message says
how many ([backups.md](backups.md#what-this-does-not-do)).

`"finalBackup": true` in the body takes one more backup, off-site, before
anything is removed — the Danger zone's checkbox, off by default here because a
script says what it wants. If it cannot be taken (no bucket, no agent, the
archive failed) the answer is `SERVER_STATE_INVALID` with "Not deleted" and
nothing was removed.

`"forget": true` is for a node that is gone. The delete above is refused while the node cannot be
reached (`RUNTIME_UNREACHABLE`, "… untouched — deleting it here would strand it"), because a panel that
dropped the record while the container ran would leave something it could no longer see; the message
ends by naming this. `forget` removes the panel's record of the server (its rows, its local backups'
rows, its DNS record where the panel keeps one) and sends **nothing** to the machine; what is on the
machine stays on it. It is refused (`SERVER_STATE_INVALID`, "Delete it instead") unless the panel has not reached the node for two
minutes **and** the node, asked at that moment, answers nothing at all: an agent that answers with any status, a 503 because Docker is stopped
under it included, is there, and it cannot be combined with `finalBackup`
(`VALIDATION_FAILED`). Off-site backups stay, as for a delete. The audit line is `server.forgotten`, not
`server.deleted`, and says the machine was not asked. The answer carries `"forgotten": true`.

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

A join password is in `settings` only for a caller who could change it —
`server.settings.write` on that server, by role and by key. Anybody else gets
`settings` without it, and its key in `hiddenSettings` (new in 0.3.2; `[]` when
nothing was left out). Until 0.3.2 it went to every caller with `server.read`.

### `GET /api/v1/servers/:id/settings`

Needs `server.read`. Both halves of the settings page:

```json
{ "server": "aurora",
  "platform": { "name": "Aurora SMP", "host": "aurora.ashfold.gg",
                "memoryLimit": 8, "cpuLimit": 300,
                "restartPolicy": "ON_FAILURE", "maxRestarts": 3 },
  "game": { "fields": [{ "key": "maxPlayers", "label": "Max players", "type": "number",
                         "default": 20, "options": null,
                         "restartRequired": true, "fixedAfterCreation": false,
                         "secret": false }],
            "stored": { "maxPlayers": 40 },
            "onServer": { "maxPlayers": 40 },
            "drift": [],
            "hidden": [] } }
```

`stored` is what the panel wrote; `onServer` is what the node's files say
right now, or `null` when there is no agent to ask; `drift` lists keys where the
two disagree. `game` is `null` for a server whose game is no longer known.

A field with `"secret": true` is a join password. Its value — stored, on the
server, and in `drift` — is given only to a caller who could change it:
`server.settings.write` on that server, by role and by key. Anybody else gets
the other values, and the keys left out in `hidden`, so that a missing value
reads as hidden rather than as not set. `secret` and `hidden` are new in 0.3.2;
before it, every caller with `server.read` was given the password.

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
the game's stdin, and nowhere else — nothing in Geeboard speaks RCON, so a game
that reads no input, as Valheim's server does not, takes no commands. Multi-line input
is refused, so a second command cannot be smuggled in. `202`; every command is
written to the audit log with its text. `SERVER_STATE_INVALID` when the server
is not running or the node has no agent.

### `POST /api/v1/servers/:id/rollback`

Needs `server.update`. Puts back the version the last update replaced, from the
backup that update took first. Ten a minute. `202`; `SERVER_STATE_INVALID` when
there is nothing to go back to (the server was never updated through Geeboard, the
archive is gone, or the version is no longer in the catalog). A server whose update
left it with no workload can go back: rollback needs the archive, the directory and a
node, and makes the workload itself.

### `POST /api/v1/servers/:id/move`

Needs `server.create` — the same permission as creating, because it is a
creation on the target. Body `{ "node": "fra-node-02" }`. The move goes through
the off-site bucket, stops the server, archives, restores on the target, and
starts it there if it was running. Ten a minute. `202` with a message;
`SERVER_STATE_INVALID` when the server is busy, the target cannot run it, or no
bucket is configured.

### `POST /api/v1/servers/:id/assign`

Needs `server.assign` — owners' and admins', under `servers:manage`. Body
`{ "member": "sam@example.com" }`, an email or an account id. Gives the server
to that account: a member sees only the servers given to them, so this is how
one reaches them; a moderator gains the settings, files, backups and schedule
of a server given to them. Nothing on the node changes. Thirty a minute.
`200` with a message; `NOT_FOUND` for an unknown account; `CONFLICT` when the
server is already theirs, or the account is a system account.

### `GET /api/v1/servers/:id/files?path=`

Needs `server.files.read`. The directory listing under the server's data
directory, entries `{ name, path, kind, sizeBytes, modifiedAt, mode }`. Paths are relative
to the server's root; `..` and symlinks out of it are refused by the node, as
in the file manager. `RUNTIME_NOT_ATTACHED` when there is no agent; `NOT_FOUND`
for a path that is not there.

### `GET` · `PUT /api/v1/servers/:id/files/content?path=`

`GET` needs `server.files.read` and returns `{ content, truncated, sizeBytes }`
— text only, UTF-8. A file over 2 MB is **not cut: it is not sent.** `content` is
`""`, `truncated` is `true` and `sizeBytes` says how big it is; read it from
`files/raw`. `PUT` needs `server.files.write` with body `{ "content": "…" }`, at most 2 MB, and
replaces the whole file; the game reads it when it next reads it. The write is an
audit entry. A path outside the server's directory is `FORBIDDEN`, a node that did
not answer is `RUNTIME_UNREACHABLE`, a file that is not there is `NOT_FOUND`.

### `GET` · `PUT /api/v1/servers/:id/files/raw?path=`

Bytes, where `files/content` is text: a plugin jar, a world icon, a zip of a
map. `GET` needs `server.files.read` and answers `application/octet-stream` with
a `Content-Length` and a `Content-Disposition`. `PUT` needs `server.files.write`;
**the request body is the file** — no JSON, no multipart:

```bash
curl -X PUT --data-binary @essentials.jar \
  -H "Authorization: Bearer gbk_live_…" \
  "https://panel.example.com/api/v1/servers/aurora/files/raw?path=plugins/essentials.jar"
```

`201` with `{ server, path, sizeBytes, message }`. It replaces a file of the same
name and makes missing directories; it is written beside the target and renamed
over it, so an upload that drops half-way leaves the file that was there. Both
directions are streamed through the panel without being held by it, and the
node stops at 256 MB either way — a world is still what backups are for. An
upload is the audit entry `file.uploaded`, with its size. The refusals are the
file manager's: `FORBIDDEN` for a path outside the server's directory,
`NOT_FOUND`, `RUNTIME_NOT_ATTACHED`, `RUNTIME_REJECTED`.

**The request's `Content-Length` is what has to arrive.** The node counts the
bytes it writes, and a body that ends short of it — a connection cut, a proxy
that gave up — is `RUNTIME_REJECTED`, *the upload ended at 1000 of 11932207
bytes, so nothing was written*, with the old file left in place. Before 0.3.1
every body past 10 MB was cut there by the panel itself and answered `201`. A
request with no `Content-Length`, sent chunked, is written as it comes, as it
always was. A node whose agent is older than 0.3.1 cannot refuse before it
renames: the panel finds the short file after, removes it and says so — and the
file of that name that was there before is gone with it.

### `POST /api/v1/servers/:id/files/directories` · `PATCH` · `DELETE …/files`

Need `server.files.write`. `POST` with `{ "path": "mods" }` creates a directory
(`201`); `PATCH` with `{ "from": "plugins/old.jar", "to": "plugins/disabled/old.jar" }` gives a
file or a directory another name, in the same folder or another one inside the
server, and is audited as `file.renamed`; `DELETE …/files?path=` removes a file
or a directory, and is audited. A `PATCH` whose `to` already exists is a
`CONFLICT` (`409`) and changes nothing: the node's rename would replace it
without a word, so the panel looks first, and a folder cannot be moved into
itself (`VALIDATION_FAILED`). All of them share the file manager's refusals: `FORBIDDEN` for a path the node will not touch,
`NOT_FOUND`, `RUNTIME_NOT_ATTACHED`, `RUNTIME_REJECTED` for anything else the
node said no to.

### `GET` · `POST /api/v1/servers/:id/backups`

`GET` needs `server.backup.read`: the server's backups newest first, failed
ones included:

```json
{ "backups": [{ "id": "clb…", "server": "aurora", "name": "manual-09-20",
                "state": "COMPLETE", "trigger": "MANUAL", "store": "S3",
                "sizeBytes": 812345678, "checksum": "sha256:…",
                "durationMs": 41200, "error": null,
                "verifiedAt": "2026-09-20T05:00:03.000Z", "verifyError": null,
                "deletedServer": null, "createdAt": "…" }] }
```

`name` is the prefix (`manual`, or `auto` for the others), the month and the day, and `-2`, `-3` for a
second and third on the same day. `trigger` is `MANUAL`, `SCHEDULED`, `PRE_UPDATE` or `PRE_DELETE`. `verifiedAt`
and `verifyError` are the last time the archive was read back and what that
found wrong: both `null` means nobody has looked since it was written, not that
it is sound. `deletedServer` is set, and `server` null, on an off-site backup
that has outlived its server: `{ "name": "Aurora SMP", "gameId": "minecraft-java" }`.

`POST` needs `server.backup.write`, optional body `{ "store": "LOCAL" | "S3" }`;
absent, the archive goes where the server's backups go by default. Synchronous,
ten a minute — the world is quiesced, archived and hashed. `201` with the
backup shape. `VALIDATION_FAILED` for `S3` with no bucket configured;
`SERVER_STATE_INVALID` when the node has no agent or the server is busy.

Off-site keys and the node's archive path are not in the shape: neither is an
address a client should hold.

### `GET` · `POST /api/v1/servers/:id/mods`

The Mods tab's list and its operations, the same ones: whatever the tab can do
to a server's mods, these can, and nothing it cannot. `GET` needs
`server.read`; everything that changes the list needs `server.settings.write`.

```json
{ "server": "zomboid-mods", "game": "Project Zomboid", "supported": true,
  "build": { "label": "Build 42", "version": "42.20.4" }, "attached": true,
  "pending": false, "awaitingDownload": 0, "refused": 4,
  "collections": [{ "id": "3806120559", "title": "Rawt Building Craft", "count": 5 }],
  "mods": [{ "workshopId": "3459887404", "title": "Building Craft", "enabled": true,
             "position": 1, "downloaded": true, "modIds": ["BuildingCraft"],
             "loads": ["BuildingCraft"], "refused": [], "pulledInBy": [],
             "collection": { "id": "3806120559", "title": "Rawt Building Craft" },
             "missing": [], "sizeBytes": 4176052, "addedBy": "Devi Vasquez", "addedAt": "…" }] }
```

In load order. `loads` is what this server's build loads of what the node found
in the download; `refused` says, per mod id, why it will not. `supported` is
false for a game whose mods the panel does not install, with an empty list.
`pending` is true when the list differs from what the game was last told.
`collection` is the collection that added the mod — null for one added on its
own. `missing` is what its Workshop page lists as required that the list does
not have, and is `null` when that is not known: it is asked of Steam with a
Steam Web API key, and without one it is not.

`POST` with `{ "workshop": "<id or link>" }` adds one item at the end, chosen
and not installed (`201`). A collection is refused here with the tab's own
sentence and added through the next route.

### `POST /api/v1/servers/:id/mods/collections` · `DELETE …/collections/:collectionId`

`POST` with `{ "collection": "<id or link>" }` adds every item in it the game
can load and the server does not have, after everything already there, in the
collection's order, following the collections it links; `201` with `added`.
Items already on the server that no collection claims are counted as this
one's without moving. `DELETE` removes every mod that collection added, and only
those, with `removed`.

### `PATCH` · `DELETE /api/v1/servers/:id/mods/:workshopId`, `PUT …/mods/order`

`PATCH` with `{ "enabled": false }` switches a mod off — it stays downloaded
and leaves the load list when the list is next applied — or back on. `DELETE`
takes it off the list. `PUT …/mods/order` with `{ "order": [ …every Workshop id
on the list, once… ] }` sets the load order; a list that is not exactly the
server's is refused rather than guessed at.

### `POST /api/v1/servers/:id/mods/apply` · `…/mods/ask`

`apply` writes the list into the game's settings, the one mod operation that
touches the node, after a backup of a running server unless the body says `{
"backup": false }`. The game downloads and loads the list on its next start;
nothing here restarts it. It is refused while the game is still starting,
because the game rewrites its settings once its mods are in. `ask` is **Ask the
node**: which downloads are on disk and which mods are inside each, read from
the files — and, with a Steam key, what each item's page lists as required.

Refusals keep the tab's sentence under a code: `NOT_FOUND` for a mod or a
collection that is not on the list, `CONFLICT` for one already there,
`MOD_PROVIDER_FAILED` and `MOD_KEY_REFUSED` for Steam, `RUNTIME_NOT_ATTACHED`
and `NODE_INCOMPATIBLE` for the node, `VALIDATION_FAILED` otherwise.

### `GET` · `DELETE /api/v1/backups/:id`

`GET` needs `server.backup.read` on the backup's server. `DELETE` needs
`server.backup.write`: a locked backup is `CONFLICT`; an off-site archive is
removed from the bucket by the panel, a local one by the node, and a node that
is gone is `SERVER_STATE_INVALID`.

### `GET /api/v1/backups?deleted=true`

Needs `server.backup.read`, and filters rather than refuses. With
`deleted=true`, the off-site backups that have outlived their server, which no
`/servers/:id/backups` can list any more; without it, every backup the caller
may read (500 at most, newest first). What the caller may read is asked of the
database before the five hundred are counted, so a member whose workspace has more
than five hundred newer backups of other people's servers still gets their own.

### `POST /api/v1/backups/:id/restore` · `/lock` · `/verify`

Need `server.backup.write`. Restore stops the server, puts the archive back
(from the bucket for off-site, hashed on the way down) and starts it again if
it was running: `202`, ten a minute, `SERVER_STATE_INVALID` when the backup is
not complete or the server is busy. An optional body `{ "into": "<server>" }`
restores into another server — required for a backup whose own server was
deleted, allowed only for an off-site archive and only into a server of the
game it was taken from; otherwise `VALIDATION_FAILED` with `details.field: "into"`. A body whose `into` or
`inPlace` is present and is not a string or a boolean is `VALIDATION_FAILED` too, not read as absent, so a
typo cannot restore over the server it meant to leave alone. A target that already has a local backup whose
archive has the archive's name is `CONFLICT`; a server that is busy, an archive that is not complete, or a
node without room is `SERVER_STATE_INVALID`. `{ "inPlace": true }`
is for a node without room for two copies of the world: the archive is normally
unpacked beside the world and the two exchanged only when it is whole, so a
failed restore leaves the world as it was; in place removes the world first, and
a failure then leaves it incomplete (the refusal for lack of room says when it
would fit). Lock takes
`{ "locked": true | false }`; a locked backup is skipped by cleanup and cannot
be deleted.

Verify reads the archive back where it lies — re-hashed on its node, or pulled
down from the bucket to be — and compares it with the checksum taken when it was
written. Synchronous, ten a minute, `200` with
`{ intact, checked, message, backup }`. A damaged archive is an answer, not an
error: `intact: false` and the backup carrying `verifyError`. `checked: false`
is the third case — the node or the bucket could not be reached, or the record
has no archive behind it — and then nothing about the backup was changed.

### `GET` · `POST /api/v1/servers/:id/tasks`

`GET` needs `server.read`: the server's scheduled tasks. `POST` needs
`server.schedule.write`:

```json
{ "name": "Nightly backup", "kind": "BACKUP", "cron": "0 4 * * *",
  "payload": "" }
```

`kind` is `BACKUP`, `RESTART`, `BROADCAST`, `COMMAND`, `CLEANUP` or `VERIFY`;
`payload` is the message, the command, `keep N` (or just `N`) for cleanup — stored as `keep N` either
way — and for a verification either nothing (re-hash the node's archives, check off-site ones
are present) or `download` (also pull off-site archives down to re-hash them). A kind that uses none —
`BACKUP`, `RESTART`, a verification with nothing — is stored and answered as `null`, whatever was sent; the
request may leave `payload` out or send `""`. The scheduler's rules
apply: every minute is refused, a broadcast on a game that cannot broadcast is
refused, both `VALIDATION_FAILED` with `details.errors`. `201` with the task:

```json
{ "id": "clt…", "server": "aurora", "name": "Nightly backup", "kind": "BACKUP",
  "cron": "0 4 * * *", "payload": null, "enabled": true,
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
               "action": "console.command", "target": "say restarting in 5",
               "targetHidden": false,
               "tone": "info",
               "server": { "slug": "aurora", "name": "Aurora SMP", "deleted": false },
               "changes": null }],
  "page": 1, "pages": 24, "total": 583, "pageSize": 25 }
```

A deleted server's events are still there, with `"deleted": true` and the name
and slug it had; `server` finds them by that slug. A server deleted before
September 2026 has only its `server.deleted` line left, with a `slug` of `null`.

**A console command's text follows its console.** The `target` of a
`console.command` line is the command, and it is given only to a caller who
may watch that server's console — `server.console.read`, by role and by key, so
a key without `console:write` reads no command. Anybody else gets the line with
`"target": null` and `"targetHidden": true`, and `q` does not search a text they
may not read. A deleted server's commands are read only by those who may watch
every console, because its owner is not kept. `targetHidden` is new in 0.3.2;
before it every caller with `audit.read` — every account — read every command.

A changed join password is recorded as changed, never as what it was or
became: its line in `changes` reads `"from": "not recorded", "to": "changed"`.
Lines written before 0.3.2 keep what they recorded.

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

Three routes are called by machines rather than people, and are not
user-authenticated.

### `GET /api/v1/panel-ca`

Public, with no key or session, and it has to be: the node asking has no token yet and does not
trust the connection it asks over. It answers this panel's own certificate authority, `200` with
`application/x-pem-file` — a root certificate is not a secret — or `404 NOT_FOUND` when the panel has none
(it is behind a name and a public authority, or it was installed before it learned its own). What makes it safe is
on the node's side: it compares what it received with the SHA-256 in the command it was given, which came from
a signed-in page, and throws away a certificate that does not match
([advanced-install.md](advanced-install.md#caddy)).

### `POST /api/v1/nodes/register`

The registration token in the body is the whole credential. Body: `token`,
`advertiseUrl`, `agentToken`, plus optionally `name`, `agentVersion`,
`agentContract` (from 0.4.1: a whole number of one or more — what the agent speaks to
the panel, see [nodes.md](nodes.md#panel-and-agent-versions); anything else is read as
none), `os`, `arch`, `capabilities`, `resources` and, from 0.3.5, `terminal` — what the
machine says about a [node terminal](#the-node-terminal):
`{ state: "on" | "off" | "unavailable", reason?, os, user, shell, scope: "machine" | "container" }`.
Answers `201` with `{ node, state, approved }`.

`os` and `arch` are the container engine's platform. A token only registers the
name it was minted for; any other name is `401` and the token is not spent.
Leaving `name` out registers that name, and `node` in the answer says which it
was — this is how `npm run join` learns its name.
An `os` or `arch` that is not a short lowercase word is stored as unknown.

The node lands as `PENDING` and takes no servers until an admin approves it.
Everything in the request is untrusted input from something holding a token; see
[security.md](security.md).

### `POST /api/v1/nodes/heartbeat`

Body: `name`, `token`, and optionally `agentVersion` (with `agentContract`, which
is replaced with it: an agent that sends a version and no contract has none),
`os`, `arch`,
`capabilities`, `resources` (`cpuCores`, `ramTotalGb`, `diskTotalGb`), `load`
and `terminal` (as at registration). Authenticated with the shared agent
secret, compared in constant time. Updates `lastSeenAt`, the node's platform,
size and terminal. A platform, size or terminal the agent leaves out keeps its
stored value; an agent that has never sent `terminal` leaves it null, which
the panel reads as an agent from before 0.3.5.

The answer is `state` — `active` or `pending` — and `reachable`: when the panel
has not reached this node in the last 30 seconds it calls the node's advertised
address while answering, records `lastReachedAt` and clears a degraded or
unreachable state if it gets through, and otherwise answers `reachable: false`
with `reachableDetail` saying why. It never overrules draining or maintenance.
A heartbeat alone clears nothing: it proves the agent can reach the panel, not
the direction every placement uses.

## The node terminal

Not part of this API, and written here so nobody looks for it: the
[node terminal](nodes.md#node-terminal) is the browser's, through routes under
`/api/nodes/:name/terminal` and `/api/terminal/:id/…` that take the session
cookie and nothing else, refuse a request whose `Origin` is not the panel's,
and answer `403` to every role but owner. No API key opens one, because
`node.terminal` is in no scope; no route anywhere returns a node's token, and
the terminal's own stream carries none — the panel holds the socket to the
agent, and the browser sees Server-Sent Events. What the routes do:
`POST /api/nodes/:name/terminal { code, cols, rows }` opens a session with a
fresh authenticator code and answers `201 { id, node, shell }` or a
`{ title, body, code }` saying why not; `GET /api/terminal/:id/stream` is the
output (`open`, `out`, `exit`, `ended`); `POST …/input { seq, d }`,
`…/resize { cols, rows }` and `…/close` drive it. See
[security.md](security.md#node-terminal).

## Not yet

- Live console output is the browser's (a Server-Sent Events route under
  `/api/servers/:slug/console`), not this API: a program gets `/logs`. Metrics history is here
  since 0.7.0 — `GET /servers/:id/metrics` and `GET /nodes/:name/metrics` — as buckets, not as a stream
- Members, API keys, accounts and the off-site storage configuration are
  managed from the panel only. Issuing a key with a key would be a way to
  outlive revocation
- Some of what the panel does to a server or a node has no route yet, and is the
  panel's alone: **rebuilding a server's workload**, making a node's **registration
  token** (a script that adds nodes mints the token in the panel and runs the
  installer), editing a node's **details** (region, city, address), **templates**
  (saving a server as one, creating from one, cloning), **retrying a server's DNS
  records**, and configuring the DNS provider and the **notification channels**.
  None is hidden: each is on a page, and each is an operation a route could call
  the way the others do. Only the DNS provider is out on purpose — its token is
  `dns.manage`, in no scope. The rest are left out for want of a reason to open
  them to a key, not for a rule against it, and a registration token or a
  notification channel, which hold a credential, would be asked about first
- Community games are proposed, approved and retired by an owner at the panel, with
  a fresh authenticator code, and no scope can carry that
- No webhooks or long-poll: a client that started something with a `202`
  polls the server or the backup for its state. Decided against for the first
  release — delivery, retries, signing and a page for managing endpoints are a
  feature of their own, and polling says nothing false in the meantime

## Checking it

`npm run verify:api` in `web/` mints keys — everything, read-only, and a
moderator's with `servers:manage` — and calls every route above through its
handler: creation on a fixture node, both halves of settings, a game setting
that needs a rebuild, the node-reaching routes against a node with no agent
(each refused with a code, never a 500), tasks end to end, the audit log, the
mods routes' permissions and refusals, node state, and deletion with the typed
name. Its last section lists the handlers under `src/app/api/v1` and fails on any
it did not call, so a route added without a call is a failing check; what a call
proves is the one answer this page promises for it, and not every path through
the operation behind it. What the operations behind the mods routes do to a real
Zomboid server is `verify:mods`'s; what a real agent does with `register` and
`heartbeat` is `verify:registration`'s. It reseeds when done and is part of
`npm run verify`. A second check needs no database: `npm run test:unit` reads the
handlers and this page and fails when a handler is not named here, when a code in
the table above is one nothing sends, or when a route can send one the table does
not list.
