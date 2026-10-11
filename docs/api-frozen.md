# What the API promises at 1.0

From 1.0, inside a major version, the HTTP API and the two webhooks only grow ([the promise](extending.md#the-promise)).
This page is the list of what that promise covers: every route, every name a route takes, every field it answers
with, every value of an enumeration a client can switch on, and the webhooks' bodies and headers. What
[api.md](api.md) explains, this page names, once each.

**Nothing on it is renamed, removed or given another meaning inside a major version.** A minor release may add a row
to any table here — a route, a field, a value — and a client reads what it knows and leaves the rest.

`npm run test:unit` holds the page to the code (`web/test/api-frozen.test.ts`):

- a handler under `/api/v1` with no row in [Routes](#routes), or a row with no handler, fails;
- a name in the *Takes* or *Answers* column that its route's files no longer contain fails;
- every shape below is built from rows the test makes up, or read from the file that builds it, and a field on this page
  that the shape does not send fails — so does a field the shape sends that is not on this page;
- an enumeration whose values here and in the code differ, in either direction, fails;
- a scope in [api.md](api.md#authenticating) whose permissions differ from the code's, and an error code in
  [api.md](api.md#errors) whose status differs, fail.

So adding is a row here in the same change, and renaming or removing is a test that says which name it was.

## How to read it

A field is written as a path: `resources.memoryGb` is `memoryGb` inside `resources`, and `ports[].id` is `id` in every
entry of the list `ports`. A field the table names and does not open (`changes`, `settings[].options`) is frozen by its
name and its type; what is inside it is the game's or the operation's, and [api.md](api.md) says what it holds.

Times are ISO 8601 strings in UTC. A field that is "or null" is always there, and null when there is nothing to say.
A unit is in the name wherever a number has one (`memoryGb`, `sizeBytes`, `durationMs`, `bucketSeconds`, `pingMs`),
with one exception kept on purpose: **`cpuLimit` is a percentage of one core** (`150` is one and a half cores), in
every place it appears — creation, a server's `resources`, its settings, a game's `defaults` and `limits` — and a
node's `committed.cpuPct` and `committed.cpuTotalPct` are in the same unit.

An enumeration that is a database state is written in capitals (`RUNNING`, `ON_FAILURE`); one that comes from a game
definition or is worked out when asked is in lower case (`stable`, `no-address`). Case is part of the value.

## Routes

One row for each handler. *Takes* is the query (`?name`) and the JSON body's fields; *Answers* is what the answer
carries besides a shape named in words.

| Route | Takes | Answers |
| --- | --- | --- |
| `GET /api/v1/games` | | `games`, each a [game](#game) |
| `GET /api/v1/games/:id` | | a [game](#game) |
| `GET /api/v1/games/:id/versions` | | [versions](#versions) |
| `GET /api/v1/nodes` | | `nodes`, each a [node](#node) |
| `GET /api/v1/nodes/:name` | | a [node](#node) and [node detail](#node-detail) |
| `DELETE /api/v1/nodes/:name` | `confirm` | `node`, `deleted`, `message` |
| `GET /api/v1/nodes/:name/metrics` | `?range` | [node metrics](#node-metrics) |
| `POST /api/v1/nodes/:name/drain` | `drain` | `node`, `draining`, `message` |
| `POST /api/v1/nodes/:name/approve` | | `node`, `approved`, `message` |
| `POST /api/v1/nodes/:name/reject` | | `node`, `rejected`, `message` |
| `POST /api/v1/nodes/:name/rotate-token` | | `node`, `rotated`, `confirmed`, `message` |
| `POST /api/v1/nodes/register` | `token`, `advertiseUrl`, `agentToken`, `name`, `agentVersion`, `agentContract`, `os`, `arch`, `capabilities`, `resources`, `terminal` | [registration](#registration) |
| `POST /api/v1/nodes/heartbeat` | `name`, `token`, `agentVersion`, `agentContract`, `os`, `arch`, `capabilities`, `resources`, `load`, `terminal` | [heartbeat](#heartbeat) |
| `GET /api/v1/panel-ca` | | the certificate, as `application/x-pem-file` |
| `GET /api/v1/servers` | `?game`, `?node`, `?state` | `servers`, each a [server](#server) |
| `POST /api/v1/servers` | `name`, `host`, `gameId`, `versionId`, `templateId`, `node`, `memoryGb`, `cpuLimit`, `diskGb`, `settings`, `overcommit` | a [server](#server) and `message` |
| `GET /api/v1/servers/:id` | | a [server](#server) and [server detail](#server-detail) |
| `DELETE /api/v1/servers/:id` | `confirm`, `finalBackup`, `forget` | `server`, `deleted`, `forgotten`, `message` |
| `POST /api/v1/servers/:id/assign` | `member` | `server`, `member`, `message` |
| `GET /api/v1/servers/:id/backups` | | `server`, `backups`, each a [backup](#backup) |
| `POST /api/v1/servers/:id/backups` | `store` | a [backup](#backup) and `message` |
| `POST /api/v1/servers/:id/console` | `command` | `server`, `sent`, `message` |
| `GET /api/v1/servers/:id/files` | `?path` | `server`, `path`, `entries`, each a [file entry](#file-entry) |
| `PATCH /api/v1/servers/:id/files` | `from`, `to` | `server`, `from`, `to`, `renamed`, `message` |
| `DELETE /api/v1/servers/:id/files` | `?path` | `server`, `path`, `deleted`, `message` |
| `GET /api/v1/servers/:id/files/content` | `?path` | `server`, `path`, `content`, `truncated`, `sizeBytes` |
| `PUT /api/v1/servers/:id/files/content` | `?path`, `content` | `server`, `path`, `message` |
| `POST /api/v1/servers/:id/files/directories` | `path` | `server`, `path`, `message` |
| `GET /api/v1/servers/:id/files/raw` | `?path` | the file's bytes |
| `PUT /api/v1/servers/:id/files/raw` | `?path`, and the body is the file | `server`, `path`, `sizeBytes`, `message` |
| `GET /api/v1/servers/:id/logs` | `?tail` | `server`, `tail`, `lines`, each a [log line](#log-line) |
| `GET /api/v1/servers/:id/metrics` | `?range` | [server metrics](#server-metrics) |
| `GET /api/v1/servers/:id/mods` | | [mods](#mods) |
| `POST /api/v1/servers/:id/mods` | `workshop` | `server`, `message` |
| `PATCH /api/v1/servers/:id/mods/:workshopId` | `enabled` | `server`, `workshopId`, `enabled`, `message` |
| `DELETE /api/v1/servers/:id/mods/:workshopId` | | `server`, `workshopId`, `message` |
| `POST /api/v1/servers/:id/mods/apply` | `backup` | `server`, `message` |
| `POST /api/v1/servers/:id/mods/ask` | | `server`, `found`, `message` |
| `POST /api/v1/servers/:id/mods/collections` | `collection` | `server`, `added`, `message` |
| `DELETE /api/v1/servers/:id/mods/collections/:collectionId` | | `server`, `removed`, `message` |
| `PUT /api/v1/servers/:id/mods/order` | `order` | `server`, `order`, `message` |
| `POST /api/v1/servers/:id/move` | `node` | `server`, `node`, `message` |
| `POST /api/v1/servers/:id/restart` | | `action`, `server`, `message` |
| `POST /api/v1/servers/:id/rollback` | | `server`, `message` |
| `GET /api/v1/servers/:id/settings` | | [settings](#settings) |
| `PATCH /api/v1/servers/:id/settings` | `name`, `host`, `memoryGb`, `cpuLimit`, `restartPolicy`, `maxRestarts` | `server`, `rebuildRequired`, `message` |
| `PATCH /api/v1/servers/:id/settings/game` | `values`, `recreate` | `server`, `plan`, `message` |
| `POST /api/v1/servers/:id/start` | | `action`, `server`, `message` |
| `POST /api/v1/servers/:id/stop` | | `action`, `server`, `message` |
| `GET /api/v1/servers/:id/tasks` | | `server`, `tasks`, each a [task](#task) |
| `POST /api/v1/servers/:id/tasks` | `name`, `kind`, `cron`, `payload` | a [task](#task) and `message` |
| `POST /api/v1/servers/:id/update` | `versionId` | `server`, `message` |
| `GET /api/v1/backups` | `?deletedServer` | `backups`, each a [backup](#backup) |
| `GET /api/v1/backups/:id` | | a [backup](#backup) |
| `DELETE /api/v1/backups/:id` | | `backup`, `deleted`, `message` |
| `POST /api/v1/backups/:id/lock` | `locked` | `backup`, `locked`, `message` |
| `POST /api/v1/backups/:id/restore` | `into`, `inPlace` | `backup`, `server`, `message` |
| `POST /api/v1/backups/:id/verify` | | `intact`, `checked`, `message`, `backup` |
| `GET /api/v1/tasks/:id` | | a [task](#task) |
| `PATCH /api/v1/tasks/:id` | `name`, `kind`, `cron`, `payload` | a [task](#task) and `message` |
| `DELETE /api/v1/tasks/:id` | | `task`, `deleted`, `message` |
| `POST /api/v1/tasks/:id/run` | | `task`, `message` |
| `POST /api/v1/tasks/:id/toggle` | | a [task](#task) and `message` |
| `GET /api/v1/audit` | `?q`, `?actor`, `?days`, `?server`, `?page` | [audit page](#audit-page) |

`:id` of a server is its id or its slug; `:name` of a node is its name; `:id` of a backup or a task is its id.
`GET /api/health`, outside `/api/v1`, is [health](#health).

Every answer carries the header `x-request-id`; a success carries `cache-control: no-store` and
`x-content-type-options: nosniff` ([api.md](api.md#what-every-answer-carries)). A failure is an [error](#error).

## Shapes

### game

Built by `gameShape` in `web/src/app/api/v1/_shape.ts`.

| Field | Type |
| --- | --- |
| `id` | string: the game's id, `terraria` |
| `name` | string |
| `family` | string: what the panel groups by, `Minecraft` |
| `blurb` | string: a line about the game, for a person |
| `art` | string: at most two lines, for a cover the panel has not drawn |
| `official` | boolean |
| `community` | boolean: written by somebody and approved by an owner |
| `retired` | boolean |
| `revision` | `{ number, hash }` for a community game, or null |
| `revision.number` | number |
| `revision.hash` | string: the SHA-256 of the approved manifest |
| `install` | [`game.install`](#values) |
| `requirements.memoryGbMin` | number |
| `requirements.cpuPctMin` | number, in percent of one core |
| `requirements.diskGbMin` | number |
| `requirements.os` | list of strings |
| `requirements.arch` | list of strings |
| `requirements.capabilities` | list of capability ids ([extending.md](extending.md#what-there-is-today)) |
| `defaults.memoryGb` | number |
| `defaults.cpuLimit` | number, in percent of one core |
| `defaults.diskGb` | number |
| `defaults.playersMax` | number |
| `limits.memoryGb` | `[min, max]` |
| `limits.cpuLimit` | `[min, max]` |
| `limits.diskGb` | `[min, max]` |
| `ports[].id` | string |
| `ports[].label` | string |
| `ports[].protocol` | `tcp`, `udp` or `both` |
| `ports[].primary` | boolean |
| `ports[].public` | boolean |
| `settings[].key` | string: the setting's key, as every settings route takes it |
| `settings[].label` | string |
| `settings[].type` | a field type ([extending.md](extending.md#what-there-is-today)); may grow |
| `settings[].default` | the setting's default value |
| `settings[].group` | string, or null |
| `settings[].advanced` | boolean |
| `settings[].restartRequired` | boolean |
| `settings[].options` | the choices of an `enum` setting, or null |
| `settings[].min` | number, or null |
| `settings[].max` | number, or null |
| `settings[].help` | string, or null |
| `settings[].secret` | boolean: a join password |
| `settings[].fixedAfterCreation` | boolean |
| `settings[].lines` | number, or null |
| `settings[].minLength` | number, or null |
| `settings[].maxLength` | number, or null |
| `settings[].pattern` | string, or null |
| `settings[].requiredWhen` | the rule that makes it required, or null |
| `settings[].mustNotContain` | the rule a value must not break, or null |
| `settings[].fromFiles` | where its value may be picked from, or null |
| `templates[].id` | string |
| `templates[].name` | string |
| `templates[].blurb` | string |
| `templates[].summary` | string |
| `versionCount` | number |

### versions

Built in `web/src/app/api/v1/games/[id]/versions/route.ts`.

| Field | Type |
| --- | --- |
| `gameId` | string |
| `latest.game` | string, or null: the newest the game has released |
| `latest.server` | string, or null: the newest server build |
| `latest.supported` | string, or null: the newest Geeboard installs |
| `recommendedVersionId` | string, or null: a version's `id` |
| `recommended` | deprecated: the same as `recommendedVersionId` ([below](#deprecated)) |
| `versions[].id` | string: what `versionId` takes everywhere, `vanilla-1-4-4-9` |
| `versions[].label` | string |
| `versions[].upstream` | string, or null |
| `versions[].channel` | [`version.channel`](#values) |
| `versions[].line` | string, or null for the game's one line |
| `versions[].supported` | boolean |
| `versions[].recommended` | boolean |
| `versions[].released` | string, or null |
| `versions[].note` | string, or null |
| `versions[].origin` | string: where the row came from (`static`, `steam`, `github`, …); may grow |
| `versions[].branch` | string, or null |
| `versions[].buildId` | string, or null |
| `providerErrors` | list of `{ provider, message }` |

### node

Built by `nodeShape` in `web/src/app/api/v1/_shape.ts`.

| Field | Type |
| --- | --- |
| `name` | string: the node's id |
| `region` | string |
| `city` | string, or null |
| `state` | [`node.state`](#values) |
| `runtime` | [`runtime`](#values) |
| `os` | string, or null |
| `arch` | string, or null |
| `capabilities` | list of capability ids; may grow |
| `agentVersion` | string |
| `agentContract` | number, or null |
| `attached` | boolean: an agent is configured |
| `lastSeenAt` | time, or null: the agent last called the panel |
| `lastReachedAt` | time, or null: the panel last reached the agent |
| `pingMs` | number, or null |
| `resources.cpuCores` | number |
| `resources.ramTotalGb` | number |
| `resources.diskTotalGb` | number |
| `resources.cpuPct` | number: live, of the whole machine |
| `resources.ramPct` | number |
| `resources.diskPct` | number |
| `servers` | number: how many servers are on it |

### node detail

Built in `web/src/app/api/v1/nodes/[name]/route.ts`.

| Field | Type |
| --- | --- |
| `committed.cpuPct` | number: promised to servers, in percent of one core |
| `committed.cpuTotalPct` | number: the node's cores times 100 |
| `committed.ramGb` | number |
| `committed.ramTotalGb` | number |
| `committed.diskGb` | number |
| `committed.diskTotalGb` | number |

### node metrics

Built in `web/src/app/api/v1/nodes/[name]/metrics/route.ts`.

| Field | Type |
| --- | --- |
| `node` | string: the node's name |
| `range` | [`range`](#values) |
| `bucketSeconds` | number |
| `from` | time |
| `to` | time |
| `points[].at` | time |
| `points[].cpuPct` | number |
| `points[].cpuPctMax` | number |
| `points[].ramPct` | number |
| `points[].ramPctMax` | number |
| `points[].diskPct` | number |
| `points[].pingMs` | number |

### server

Built by `serverShape` in `web/src/app/api/v1/_shape.ts`. `dns` and `address.srv` are in every answer but the `201`
of a creation.

| Field | Type |
| --- | --- |
| `id` | string |
| `slug` | string: the server's name in a URL, which every `:id` takes too |
| `name` | string |
| `state` | [`server.state`](#values) |
| `game.id` | string, or null |
| `game.family` | string |
| `version.id` | string, or null: a version's `id` in [versions](#versions) |
| `version.label` | string |
| `node.name` | string |
| `node.region` | string |
| `runtime` | [`runtime`](#values) |
| `address.host` | string |
| `address.port` | number |
| `address.srv` | boolean: players need the host alone |
| `ports[].id` | string |
| `ports[].label` | string |
| `ports[].port` | number |
| `ports[].protocol` | `tcp`, `udp` or `both` |
| `players.online` | number, or null |
| `players.max` | number |
| `resources.memoryGb` | number |
| `resources.cpuLimit` | number, in percent of one core |
| `resources.diskGb` | number |
| `resources.cpuPct` | number, or null: live |
| `resources.ramPct` | number, or null: live |
| `startedAt` | time, or null |
| `createdAt` | time |
| `lastError` | string, or null |
| `ownerId` | string: an account's id |
| `owner` | deprecated: the same as `ownerId` ([below](#deprecated)) |
| `dns.state` | [`dns.state`](#values) |
| `dns.address` | string, or null |
| `dns.error` | string, or null |
| `dns.byName` | boolean |
| `dns.records[].type` | [`dns.records[].type`](#values) |
| `dns.records[].kind` | deprecated: the same as `type` ([below](#deprecated)) |
| `dns.records[].name` | string |
| `dns.records[].content` | string, or null |
| `dns.records[].error` | string, or null |

### server detail

Built in `web/src/app/api/v1/servers/[id]/route.ts`. What `GET /servers/:id` adds to a [server](#server).

| Field | Type |
| --- | --- |
| `settings` | the game's settings by key |
| `hiddenSettings` | list of keys left out of `settings` |
| `versionOutlook` | a [version outlook](#version-outlook), or null |

### version outlook

Built in `web/src/domain/games/versions.ts`.

| Field | Type |
| --- | --- |
| `installed` | string, or null |
| `installedLabel` | string, or null |
| `gameLatest` | string, or null |
| `serverLatest` | string, or null |
| `supportedLatest` | string, or null |
| `recommended` | string, or null: the recommended version's upstream string |
| `recommendedVersionId` | string, or null |
| `updateTo` | `{ id, label, upstream }`, or null |
| `newerLine` | `{ id, label, upstream }`, or null |
| `updateAvailable` | boolean |
| `aheadOfSupport` | boolean |
| `branch` | string, or null |
| `installedBuildId` | string, or null |
| `currentBuildId` | string, or null |
| `branchUpdatedAt` | string, or null |
| `buildDrift` | boolean |

### server metrics

Built in `web/src/app/api/v1/servers/[id]/metrics/route.ts`.

| Field | Type |
| --- | --- |
| `server` | string: the slug |
| `range` | [`range`](#values) |
| `bucketSeconds` | number |
| `from` | time |
| `to` | time |
| `points[].at` | time |
| `points[].cpuPct` | number |
| `points[].cpuPctMax` | number |
| `points[].ramMb` | number |
| `points[].ramMbMax` | number |
| `points[].players` | number, or null |
| `points[].rxBytesPerSecond` | number, or null |
| `points[].txBytesPerSecond` | number, or null |
| `points[].diskBytes` | number, or null |

### settings

Built in `web/src/app/api/v1/servers/[id]/settings/route.ts`.

| Field | Type |
| --- | --- |
| `server` | string: the slug |
| `platform.name` | string |
| `platform.host` | string |
| `platform.memoryGb` | number |
| `platform.memoryLimit` | deprecated: the same as `memoryGb` ([below](#deprecated)) |
| `platform.cpuLimit` | number, in percent of one core |
| `platform.restartPolicy` | [`restartPolicy`](#values) |
| `platform.maxRestarts` | number |
| `game` | null for a game the panel no longer knows |
| `game.fields[].key` | string |
| `game.fields[].label` | string |
| `game.fields[].type` | a field type |
| `game.fields[].default` | the default value |
| `game.fields[].options` | the choices, or null |
| `game.fields[].restartRequired` | boolean |
| `game.fields[].fixedAfterCreation` | boolean |
| `game.fields[].secret` | boolean |
| `game.stored` | values by key |
| `game.onServer` | values by key, or null |
| `game.drift` | list of keys |
| `game.hidden` | list of keys |

The `plan` a game setting's change answers with, and refuses with in `details.plan`, is
`{ changes: [{ key, label, from, to, applies }], needsRecreate, needsRestart }`, with `applies` one of
[`plan.changes[].applies`](#values).

### backup

Built by `backupShape` in `web/src/app/api/v1/_shape.ts`.

| Field | Type |
| --- | --- |
| `id` | string |
| `server` | string, or null: the slug; null once the server is deleted |
| `deletedServer` | `{ name, gameId }` once the server is deleted, or null |
| `deletedServer.name` | string |
| `deletedServer.gameId` | string, or null |
| `name` | string |
| `state` | [`backup.state`](#values) |
| `locked` | boolean: cleanup skips it and a delete refuses it |
| `trigger` | [`backup.trigger`](#values) |
| `store` | [`backup.store`](#values) |
| `sizeBytes` | number |
| `checksum` | string, or null |
| `durationMs` | number, or null |
| `error` | string, or null |
| `verifiedAt` | time, or null |
| `verifyError` | string, or null |
| `createdAt` | time |

### task

Built by `taskShape` in `web/src/app/api/v1/_shape.ts`.

| Field | Type |
| --- | --- |
| `id` | string |
| `server` | string: the slug |
| `name` | string |
| `kind` | [`task.kind`](#values) |
| `cron` | string: five fields |
| `payload` | string, or null |
| `enabled` | boolean |
| `lastRunAt` | time, or null |
| `lastResult` | [`task.lastResult`](#values), or null |
| `nextRunAt` | time, or null |

### mods

Built in `web/src/app/api/v1/servers/[id]/mods/_mods.ts`.

| Field | Type |
| --- | --- |
| `server` | string: the slug |
| `game` | string: the game's name |
| `supported` | boolean |
| `build` | `{ label, version }`, or null |
| `attached` | boolean |
| `pending` | boolean |
| `awaitingDownload` | number |
| `refused` | number: how many of the mods' ids this build will not load |
| `collections[].id` | string |
| `collections[].title` | string |
| `collections[].count` | number |
| `mods[].workshopId` | string |
| `mods[].title` | string |
| `mods[].enabled` | boolean |
| `mods[].position` | number |
| `mods[].downloaded` | boolean |
| `mods[].modIds` | list of strings |
| `mods[].loads` | list of strings |
| `mods[].refused` | list of `{ id, reason }` |
| `mods[].pulledInBy` | list of Workshop ids |
| `mods[].collection` | `{ id, title }`, or null |
| `mods[].missing` | list of `{ id, title }`, or null |
| `mods[].sizeBytes` | number |
| `mods[].addedBy` | string, or null |
| `mods[].addedAt` | time |

### file entry

Built in `web/src/app/api/v1/servers/[id]/files/route.ts`.

| Field | Type |
| --- | --- |
| `name` | string |
| `path` | string, from the server's root |
| `kind` | [`entry.kind`](#values) |
| `sizeBytes` | number |
| `modifiedAt` | time |
| `mode` | string |

### log line

Built in `web/src/app/api/v1/servers/[id]/logs/route.ts`.

| Field | Type |
| --- | --- |
| `line` | string |
| `stderr` | boolean |

### event

Built by `eventShape` in `web/src/app/api/v1/_shape.ts`.

| Field | Type |
| --- | --- |
| `id` | string |
| `at` | time |
| `actor` | string: a name |
| `actorId` | string, or null for the panel's own work |
| `action` | string: what happened, `console.command` ([not frozen](#not-frozen)) |
| `target` | string, or null |
| `targetHidden` | boolean |
| `tone` | [`event.tone`](#values) |
| `server` | `{ slug, name, deleted }`, or null |
| `server.slug` | string, or null |
| `server.name` | string |
| `server.deleted` | boolean |
| `changes` | `{ field: { from, to } }`, or null |
| `ip` | string: the client's address on a refused sign-in, or null |

### audit page

Built in `web/src/app/api/v1/audit/route.ts`.

| Field | Type |
| --- | --- |
| `events` | list of [events](#event), newest first |
| `page` | number, from 1 |
| `pages` | number |
| `total` | number |
| `pageSize` | number |

### error

Built in `web/src/domain/errors.ts`.

| Field | Type |
| --- | --- |
| `code` | one of [the table](api.md#errors) |
| `message` | string, for a person |
| `details` | an object, or absent; it grows |

The keys of `details` that [api.md](api.md) documents keep their names: `field`, `allowed`, `errors`, `node`, `reason`,
`resource`, `requestedGb`, `freeGb`, `requestedCores`, `freeCores`, `missing`, `reasons`, `host`, `step`, `plan`,
`retryAfterSeconds`, `reference`, `permission`. Others may be there and are not promised.

### health

Built in `web/src/app/api/health/route.ts`.

| Field | Type |
| --- | --- |
| `ok` | boolean |
| `version` | string: the panel's release |
| `schema` | string, or null: the last migration applied |

### registration

Built in `web/src/lib/node-ops.ts`. What `POST /nodes/register` answers an agent; part of the agent contract `1`
as much as of this API.

| Field | Type |
| --- | --- |
| `node` | string: the name it registered |
| `state` | string |
| `approved` | boolean |

### heartbeat

Built in `web/src/lib/node-ops.ts`.

| Field | Type |
| --- | --- |
| `state` | `active` or `pending` |
| `reachable` | boolean, or null when the panel did not look |
| `reachableDetail` | string, or null |

## Values

| Field | Values |
| --- | --- |
| `server.state` | `CREATING`, `INSTALLING`, `STARTING`, `RUNNING`, `UNHEALTHY`, `STOPPING`, `STOPPED`, `RESTARTING`, `UPDATING`, `BACKING_UP`, `MIGRATING`, `DELETING`, `CRASHED`, `ERROR`, `SUSPENDED` |
| `node.state` | `PENDING`, `HEALTHY`, `DEGRADED`, `UNREACHABLE`, `DRAINING`, `MAINTENANCE` |
| `runtime` | `DOCKER` |
| `restartPolicy` | `NEVER`, `ON_FAILURE`, `ALWAYS` |
| `backup.state` | `RUNNING`, `COMPLETE`, `FAILED` |
| `backup.trigger` | `SCHEDULED`, `MANUAL`, `PRE_UPDATE`, `PRE_DELETE` |
| `backup.store` | `LOCAL`, `S3` |
| `task.kind` | `BACKUP`, `RESTART`, `BROADCAST`, `CLEANUP`, `COMMAND`, `VERIFY` |
| `task.lastResult` | `SUCCEEDED`, `FAILED`, `SKIPPED`, `NEVER_RUN` |
| `event.tone` | `accent`, `info`, `success`, `warning`, `danger`, `muted` |
| `game.install` | `image`, `steamcmd`, `download` |
| `version.channel` | `stable`, `snapshot`, `preview`, `legacy` |
| `dns.state` | `none`, `outside`, `no-address`, `set`, `failed` |
| `dns.records[].type` | `A`, `AAAA`, `SRV` |
| `entry.kind` | `file`, `directory`, `other` |
| `plan.changes[].applies` | `immediately`, `on-restart`, `on-recreate` |
| `range` | `1h`, `6h`, `24h`, `7d`, `30d` |
| `notification.event` | `server.crashed`, `server.recovery.abandoned`, `server.left.stopped`, `node.unreachable`, `node.recovered`, `backup.failed`, `backup.damaged`, `server.update.available`, `panel.update.available`, `notifications.test`, `notifications.suppressed` |
| `notification.tone` | `danger`, `warning`, `success`, `info` |
| `dns.event` | `dns.test`, `dns.set`, `dns.remove` |

Each may gain a value in a minor release; [the promise](extending.md#the-promise) says what a client does about that.
Node capabilities, setting types and a version's `origin` are lists that grow too, and are named in
[extending.md](extending.md#what-there-is-today) rather than frozen here.

## Scopes and errors

The scopes, and the permissions each one grants, are the table in [api.md](api.md#authenticating). The error codes, and
the status each one answers with, are the table in [api.md](api.md#errors). Both are frozen as they stand there, and
the test reads them from that page.

## Webhooks

### notification body

Built by `webhookPayload` in `web/src/domain/notify/format.ts`. What a notification webhook receives
([notifications.md](notifications.md#what-a-webhook-receives)).

| Field | Type |
| --- | --- |
| `version` | `1` |
| `event` | [`notification.event`](#values) |
| `at` | time: when it happened |
| `tone` | [`notification.tone`](#values) |
| `title` | string |
| `text` | string |
| `server` | `{ name, slug }`, or null |
| `server.name` | string |
| `server.slug` | string, or null |
| `node` | `{ name }`, or null |
| `node.name` | string |
| `count` | number |
| `link` | string, or null |
| `details` | labels and short values; may gain entries |

### notification headers

Built in `web/src/lib/notify/send.ts`. Header names are written in lower case here; HTTP does not tell cases apart.

| Field | Type |
| --- | --- |
| `x-geeboard-event` | the body's `event` |
| `x-geeboard-timestamp` | seconds since 1970 |
| `x-geeboard-signature` | `sha256=` and the hex HMAC |

### dns.set body

Built by `setBody` in `web/src/domain/dns/webhook.ts`. What a DNS webhook receives ([dns-webhook.md](dns-webhook.md)).

| Field | Type |
| --- | --- |
| `version` | `1` |
| `event` | `dns.set` |
| `zone` | string |
| `record.type` | [`dns.records[].type`](#values) |
| `record.name` | string |
| `record.content` | string |
| `record.ttl` | number |
| `record.comment` | string |
| `record.srv` | `{ priority, weight, port, target }`, on an SRV record |
| `record.srv.priority` | number |
| `record.srv.weight` | number |
| `record.srv.port` | number |
| `record.srv.target` | string |
| `sentAt` | time |

### dns.remove body

Built by `removeBody` in `web/src/domain/dns/webhook.ts`.

| Field | Type |
| --- | --- |
| `version` | `1` |
| `event` | `dns.remove` |
| `zone` | string |
| `record.type` | [`dns.records[].type`](#values) |
| `record.name` | string |
| `sentAt` | time |

### dns.test body

Built by `testBody` in `web/src/domain/dns/webhook.ts`.

| Field | Type |
| --- | --- |
| `version` | `1` |
| `event` | `dns.test` |
| `zone` | string |
| `sentAt` | time |

### DNS headers

Built in `web/src/lib/dns/webhook.ts`.

| Field | Type |
| --- | --- |
| `x-geeboard-event` | the body's `event` |
| `x-geeboard-timestamp` | seconds since 1970 |
| `x-geeboard-signature` | `sha256=` and the hex HMAC |
| `x-geeboard-delivery` | string: the same for the same thing asked again |

## Not frozen

- **The audit log's `action` names**, apart from `console.command` (whose text [follows its console](api.md#get-apiv1auditqactordaysserverpage))
  and the ones that are a notification's `event` above. The rest are the log's words for a person, there are about a
  hundred of them, and an action may be added in any release (one for a refused sign-in is being added in 0.11). A
  client that switches over `action` does so knowing this.
- **What a `message`, a `title` or a `text` says.** They are sentences for a person; `code` and the fields are what a
  program reads.
- **The order of fields** in an answer, and the order of a list where the route does not say it (it says it for
  servers, backups, events, mods and tasks).
- **`GET /api/v1/panel-ca`'s certificate** and `files/raw`'s bytes, which are not JSON.

## Deprecated

Names a route or a shape had before 0.11, renamed in 0.11, the last release in which a name could change. Each is
still read, or still sent beside the new one, so that a client written for 0.10 goes on working; none is offered
in the panel. They are kept through 1.x and removed at 2.0.

| Old name | Where | Now | Read in |
| --- | --- | --- | --- |
| `metrics:read` | a key's scope | `servers:monitor` | `web/src/domain/access/permissions.ts` |
| `nodeName` | `POST /servers` | `node`, as `/move` takes it | `web/src/app/api/v1/servers/route.ts` |
| `memoryLimit` | `PATCH /servers/:id/settings`, [settings](#settings) `platform` | `memoryGb`, as creation and `resources` name it | `web/src/app/api/v1/servers/[id]/settings/route.ts` |
| `owner` | [server](#server) | `ownerId`: it is an account's id | `web/src/app/api/v1/_shape.ts` |
| `kind` | [server](#server) `dns.records[]` | `type`, as the DNS webhook names it | `web/src/app/api/v1/_shape.ts` |
| `recommended` | [versions](#versions) | `recommendedVersionId`, as a server's `versionOutlook` names it | `web/src/app/api/v1/games/[id]/versions/route.ts` |
| `removed` | `DELETE /nodes/:name` | `deleted`, as every other `DELETE` answers | `web/src/app/api/v1/nodes/[name]/route.ts` |
| `deleted` | `GET /backups?deleted=true` | `?deletedServer=true`: these are backups whose server is deleted | `web/src/app/api/v1/backups/route.ts` |
| `name` | `details` of `NODE_NOT_FOUND` from `GET /nodes/:name` and its metrics | `node`, as every other node refusal names it | `web/src/app/api/v1/nodes/[name]/route.ts` |

Three changed meaning in 0.11 and have no old name to keep, because the field is the same and only its value was wrong:
a server's `version.id` was the catalog row's database id, which no route took, and is the version's `id`; a backup's
`state` was `LOCKED` for a locked backup and is `COMPLETE` with `locked: true`; an event's `tone` was sent in capitals,
which [api.md](api.md) never said, and is in lower case as it said.
