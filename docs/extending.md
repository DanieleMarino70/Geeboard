# Extending Geeboard

What it takes to add a game, a node, a DNS provider, an off-site storage, a notification
channel, an API scope, a settings field, a health check or a version source — what to
write, what stops you if you forget, and what nothing stops you from forgetting. It is
written from the code as it is: where a step is easy it says so, and where it is not it
says how many places there are.

Every file named here is a real path, and a test reads this page against the code: a path
or a name that is gone from it, and a list below that no longer matches the list in the
code, fail the build. A name is written `path#Name`.

## The 1.0 sentence

> **Adding a game that runs from an image, is configured through environment variables,
> files in the formats Geeboard writes or command-line flags, and is judged by its log, a
> port, a query or a process, is a definition file and a registry line. Adding a node
> needs no change to the panel. Adding a DNS provider is one table entry and one client;
> any other is a webhook and needs none. Adding an S3-compatible storage is one preset.
> None of them changes the architecture.**

What that sentence does not say is as much of the promise as what it does:

- **A store that is not S3-compatible** (SFTP, rsync, restic, Azure with its own headers) is
  not inside it. The agent moves archives with two presigned URLs and nothing else, so a store
  that can mint those fits; one that needs a client protocol needs the agent to change.
- **A game whose console is RCON and nothing else** (Rust, Palworld) is not inside it. The
  health probe `rcon` is declared and never run, and the panel does not keep the credential
  it would need. It is the first change that would raise the agent contract.
- **A setting format the panel cannot write** — JSON, YAML, TOML, XML — needs a merge function
  in `web/src/domain/games/config.ts`. JSON is declared and refused at the audit until there is one.
- **An install that is not an image**, and **mods for a second game**, are shared code.
  `steamcmd` is a capability a node declares and nothing installs from; mods are written
  for Project Zomboid.
- **A runtime other than Docker** is not claimed.
- **An architecture other than x64** is declared (`arm64` is in the type) and not proven, and the
  published images are for x64.

## The promise

For the API, the DNS webhook and the notification webhook, from 1.0 on:

- **A minor release adds; it does not change.** New fields, new routes, new events and new
  values of an enumeration (a setting's `type`, a node's `capabilities`, a backup's `trigger`,
  an `install`, a `store`) may appear in any minor release. A client reads what it knows and
  ignores the rest. A client that switches over an enumeration needs a branch for the value
  it has not met.
- **Nothing is renamed, removed or given another meaning inside a major version.** An error's
  `code` and its status stay what the table in [api.md](api.md#errors) says; a field that page
  documents keeps its name and its type.
- **The two webhooks say which shape they are.** Every DNS and notification body carries
  `version` (`1`), which moves only for a change that would break a receiver that follows
  the rule above — [dns-webhook.md](dns-webhook.md#what-may-change-and-what-will-not) and
  [notifications.md](notifications.md#what-a-webhook-receives) say what a receiver does.
- **The agent and the panel agree on one number**, the contract (`daemon/src/contract.ts#AGENT_CONTRACT`),
  and work together only when it is equal. Beside it an agent reports `features`
  (`daemon/src/contract.ts#AGENT_FEATURES`), a list of names that is empty today: a capability
  a panel may or may not need arrives there without raising the number, and a panel that
  does not read it ignores it.
- **A release adds to the database and the one after it removes.** A migration after a
  release may add a table, a column that may be null or has a default, an index or an enum value, and
  may not drop, rename or tighten anything; a column that stops being used is dropped one
  release after the last release that reads it. The previous release's code can then still read
  and write a database the next one has migrated, which is what an image-only rollback would
  need and is all the rule is for: undoing an upgrade is still the dump, and a panel still
  refuses to start on a database ahead of it ([upgrading.md](upgrading.md#undoing-an-upgrade)).
  `web/test/migrations.test.ts` holds it: a migration that shipped is pinned by its hash and
  cannot be edited, and a newer one that drops, renames or tightens fails. The pins are written
  from the release's tag at the cut.

## What there is, today

In the recipes below a step is **forced** when the compiler stops you, **tested** when a unit
test fails, and **silent** when nothing does. The silent ones are the ones to read twice.

These are the lists a contributor adds to, and the test compares each with the code:

- **Built-in games:** `minecraft-java`, `minecraft-bedrock`, `terraria`, `project-zomboid`, `valheim`
- **Parked games** (defined, not offered): `rust`, `palworld`, `satisfactory`
- **DNS providers:** `cloudflare`, `duckdns`, `webhook`
- **Notification destinations:** `DISCORD`, `WEBHOOK`
- **Off-site storage presets:** `amazon`, `backblaze`, `r2`, `other`
- **Capabilities:** `docker`, `steamcmd`, `java`, `gpu`, `ipv6`, `high-memory`, `ssd`, `workshop`, `backups`, `snapshots`, `community-games`
- **Config targets:** `env`, `properties`, `ini`, `json`, `lua`, `lua-base`, `arg`
- **Field types:** `string`, `text`, `number`, `boolean`, `enum`
- **Health probes:** `port`, `log`, `query`, `rcon`, `process`
- **Query protocols:** `minecraft-ping`, `source-a2s`, `terraria-hello`, `terraria-rest`
- **Version sources:** `static`, `steam`, `github`, `minecraft-launcher`
- **API scopes:** `servers:read`, `servers:write`, `servers:manage`, `console:write`, `files:read`, `files:write`, `backups:write`, `metrics:read`, `nodes:manage`, `audit:read`

## Add a built-in game

Before you write anything, run the bare image by hand and measure: where the world lands
(that is `dataPath`), which variables the image reads, the ready line, whether its stdin is a
console, what SIGTERM does, and what a restart downloads. A guess is what got three games
parked.

1. `web/src/domain/games/definitions/<id>.ts`: one exported definition; copy the nearest. The
   audit (`web/src/domain/games/audit.ts#auditDefinition`) holds it to: exactly one primary
   port; defaults inside the limits; templates that name real keys; a password-like setting
   marked `secret`; versions that are pinned tags with an id that says what it is, a `line`, and
   `supported: false` instead of deletion; `requirements.capabilities` is what the *node* must
   provide, not what the image carries. A game whose image's maker tags every release can name the repository and
   the pattern of its release tags in `followTags`, and the panel finds new releases itself
   ([versions.md](versions.md#following-an-images-tags), held by `web/test/followed-tags.test.ts`); the versions you write are
   then the floor, and **when you ship a version the registry already offered** (`42.21` found as `b42-42-21`, then added by
   hand), give it `formerIds: ["b42-42-21"]`: the sync moves the row, and the servers on it, rather than leaving them on a
   version the panel can no longer name.
2. `web/src/domain/games/registry.ts#DEFINITIONS`: import it and add it — or add it to
   `web/src/domain/games/registry.ts#PARKED` with a note of what has to be measured first.
   **Tested:** `web/test/extension-guards.test.ts` fails on a definition file that is neither,
   which used to be silent.
3. `web/src/components/covers.tsx`: a cover under the same id. **Tested** (`web/test/covers.test.ts`).
4. A game whose family is new: the family in `web/src/domain/games/manifest.ts#RESERVED_FAMILIES`,
   so that a community game cannot take its name. **Tested.**
5. `npm run test:unit`, then `npm run games:sync -- --offline` to write it into a local catalog.
   A deployed panel does that for itself when it starts, when a server is created for a game or a
   version that has no row, and at every pass of the poller
   (`web/src/lib/catalog-sync.ts#syncCatalog`).
6. Run it for real: the wizard, the ready line, the world in Files, stop (does it save?),
   backup, restore. Write what it found under "Shipped" in [games.md](games.md).
7. [games.md](games.md)'s table, the CHANGELOG, and [limitations.md](limitations.md) for what
   is unverified — player-join patterns first.

**It needs shared code, not just a definition,** for: JSON, YAML, TOML or XML settings; an
RCON-only console; an install that is not an image; mods for a second game; an SRV record for
a game other than Minecraft Java; a query protocol that is not one of the four.

## Write a community game

A manifest is data, checked by `web/src/domain/games/manifest.ts#validateManifest` and
approved by an owner with a fresh authenticator code. [Community games](community-games.md)
has the format, the rules and a worked example.

1. Start from the manifest on that page: `manifest: 1`, `id: community-<name>`, a family no shipped
   game uses.
2. Name every version's image by the digest of its index: `docker buildx imagetools inspect <image>:<tag>`.
3. Settings land in `env`, `properties`, `ini`, `lua`, `lua-base` or `arg`. Mark anything that lets
   somebody in `secret: true`.
4. `npm run manifest:check -- path/to/manifest.json` exits 0 (passes), 1 (does not) or 2 (could not run).
5. An owner or admin proposes it; an owner reads the approval page and approves; the node's operator
   declares `community-games` on the machine.
6. Run it: start, console, stop (does it save?), backup, restore.

A manifest cannot say: `json` targets, mods, `srv`, a `download` install, a `steamcmd` install,
or a version source that is not static. A later release may tighten the checks: a game an owner
approved keeps the definition it was approved with, is not offered to new servers, and says so on
its servers' pages.

## Add a node

1. Linux with systemd: `sudo bash deploy/linux/install.sh <panel> <token>`. Windows:
   `deploy/windows/install-node.ps1 -Panel <panel> -Token <token>`. Anything else: `npm start`
   in `daemon/` after `join`. No change to the panel.
2. `--capabilities steamcmd,java` declares what the machine is willing to run. `--community-games`
   and `--terminal` are consents, given on the machine and never from the panel.
3. The operating system, the architecture, the size and IPv6 are measured. A platform no game
   lists (`armv7l`, `riscv64`, `freebsd`) is refused by name when a server is created there.
4. Approve it at the panel; the panel calls the node back and says if it cannot.

To add a **capability**. *Declared* — an operator says the machine will do it — is one entry in
`web/src/domain/games/types.ts#CAPABILITIES` and one in `web/src/domain/games/types.ts#CAPABILITY_LABELS`
(forced); the Add a node dialog offers a checkbox for it by itself, from the games that require it.
*Measured* — the agent can tell — is `daemon/src/capabilities.ts` **and**
`web/src/lib/agent-command.ts#MEASURED_CAPABILITIES`; **tested**, the two lists must be equal.
*A consent* is a flag in both installers (`deploy/linux/install.sh`, `deploy/windows/install-node.ps1`),
`web/src/lib/agent-command.ts#MACHINE_ONLY_CAPABILITIES`, three places on the node pages, and the docs.

To support a new **architecture**: measure a game on it, widen that game's `arch`, and publish an
image for it. To say that an agent can do something the contract does not name, add a name to
`daemon/src/contract.ts#AGENT_FEATURES`; the panel ignores it until something asks.

## Add a DNS provider

*If you can write a receiver, use the webhook and change nothing:* [dns-webhook.md](dns-webhook.md)
has the contract and `examples/dns-webhook/receiver.mjs` is a complete one.

A built-in provider, today — nine places the compiler lists and a few it does not:

1. `web/src/domain/dns/rules.ts#DnsKind` and an entry in `web/src/domain/dns/rules.ts#DNS_PROVIDERS`
   (its label, where its zone comes from, whether it holds SRV records); the table is a
   `Record` of every kind, so that is **forced**. `DNS_KINDS` is a second list of the same
   entries; **tested**.
2. `web/src/lib/dns/<id>.ts`: implement `web/src/lib/dns/provider.ts#DnsClient` (`probe`, `read`,
   `write`, `remove`). `DNS_TOKEN_REFUSED` for a refused credential, `DNS_PROVIDER_FAILED` for
   anything else; never log a credential.
3. `web/src/lib/dns-ops.ts#clientFor`: one case. **Forced.**
4. The words: `web/src/domain/dns/guide.ts#PITCH` and `web/src/domain/dns/guide.ts#STEPS`; the four hints in
   `web/src/domain/dns/address.ts` (`hostHint`, `settingsHostHint`, `resolvesElsewhere`, `unresolved`);
   the icon in `web/src/app/dns/dns-provider.tsx#ICON`. **Forced.**
5. **Silent:** `web/src/lib/dns-ops.ts#configureDnsOp` validates per provider and its form in
   `web/src/app/dns/dns-provider.tsx` falls back to a token and a zone with a DuckDNS hint;
   a provider with other credentials needs columns in `DnsProvider`
   (`web/prisma/schema.prisma#DnsProvider`) and the sealed column in
   `web/src/lib/rekey-ops.ts#SEALED_COLUMNS`.
6. `npm run verify:dns` runs a provider against a stand-in HTTP server; [servers.md](servers.md) and
   [limitations.md](limitations.md) say what it can and cannot do; a field check against the real service.

## Add an off-site storage

*S3-compatible:* one entry in `web/src/domain/storage/presets.ts#STORAGE_PRESETS` (its id, label,
endpoint with placeholders, region, path style, notes quoted from the provider's own pages), the id in
`web/src/domain/storage/presets.ts#StoragePresetId`, and its test (`web/test/storage-presets.test.ts`).
Run `npm run verify:backups` against it with `GEEBOARD_VERIFY_STORE`, record the result in
[field-checks.md](field-checks.md), and set `tried` only after.

*Not S3-compatible, but able to mint presigned URLs that take only `content-length` and `content-type`:*
the agent does not change, and the panel needs a signer, a way to read size and delete, a probe, columns,
an enum value, a form, and a `SEALED_COLUMNS` entry; 37 places in 11 files read the literal `"S3"`. There
is no interface for it yet, which is why the sentence does not claim it.

*Anything that needs a client protocol or extra headers:* the agent changes, so the contract does.

## Add a notification channel

A channel kind is not a table entry yet: nothing the compiler checks lists the places.

1. `web/src/domain/notify/destination.ts#DestinationKind`, then `judgeUrl` and `refusalForClass` (what
   the address may be) and `describeDestination`, in the same file.
2. The body: `web/src/domain/notify/format.ts#webhookPayload` is the model, and `discordBody` the
   other; `web/src/lib/notify/send.ts#sendNotification` chooses between them by kind.
3. `web/src/lib/notify/channel-ops.ts` (create, test, rotate the signing secret, its audit wording and
   its view) and `web/src/lib/notify/ops.ts#deliverPending`.
4. The form: `web/src/app/notifications/` — all told 28 places in 7 files read a kind as a literal.
5. The signing secret and the address are in sealed columns that `rekey` already covers; `kind` is a
   string, so no migration.
6. [notifications.md](notifications.md); a new kind is held to the same address rules as the others.

A new *event* — what the panel tells people about — is a row in `web/src/domain/notify/events.ts#EVENT_CHOICES`
and `web/src/domain/notify/events.ts#NOTIFIABLE_ACTIONS` and a producer that writes the audit action. **Tested:**
each action the notifier reads must be written by something.

## Add an API scope or a permission

*A permission:* add it to `web/src/domain/access/permissions.ts#PERMISSIONS` and decide it for each role in
`web/src/domain/access/permissions.ts#MATRIX` (a moderator and a member get none by default); enforce it with
`can()` in the operation and `mustAllow` in the route, not with a role comparison; put it in a scope or say
that it is in none; [api.md](api.md).

*A scope:* one entry in `web/src/domain/access/permissions.ts#SCOPE_PERMISSIONS` **and** one in
`web/src/lib/server-ops.ts#API_SCOPES`, a row in the table of [api.md](api.md#authenticating), and a call in
`web/scripts/verify-api.mts`. **Tested:** the three lists must agree. A route has to exist behind it before
`ready` is true; a scope with none is refused at creation.

A route needs: `begin(req, budget)`, `mustAllow`, the operation (never a second copy of its logic),
`refusal()` so the code is the operation's, a section in [api.md](api.md), and a call in
`web/scripts/verify-api.mts`. **Tested:** a handler api.md does not name fails, and so does one `verify:api`
does not call.

## Add a settings field type or a config target

Most needs are met without either: `secret`, `pattern`, `fromFiles`, `options`, `requiredWhen`.

*A field type* (`web/src/domain/games/types.ts#ConfigField`): `checkField` and `asValue` in
`web/src/domain/games/config.ts`, `fits` in `web/src/domain/templates/rules.ts`, a renderer in
`web/src/components/config-field.tsx`, its summary in `web/src/app/servers/new/steps.tsx`, the manifest's own
list, and a line in [api.md](api.md) that a setting's `type` gained a value. The compiler lists two; a renderer
that is missing falls back to a text box, **silently**.

*A target* (`web/src/domain/games/types.ts#ConfigTarget`): `renderConfig`, `readConfigValues`,
`configFilesOf` and `planConfigChange` in `web/src/domain/games/config.ts`, `whereOf` in
`web/src/domain/games/preview.ts`, the manifest parser, and a pure merge function that keeps comments and
unknown keys, with tests. Until there is one the audit refuses it. Of these the compiler lists one.

## Add a health check or a query protocol

*A query protocol* is the usual case — most real probes are bytes over TCP or UDP. Measure the bytes
against the real image (`npx tsx scripts/probe-query.mts <protocol> <port>`), then pause the container and
see the question go unanswered without the server falling over. Add the name to
`web/src/domain/games/types.ts#QueryProtocol`; an entry in `web/src/domain/servers/query.ts#queryPlan` (forced) and
`web/src/domain/servers/query.ts#judgeQueryReply` (**silent:** its last case answers false); the manifest's list;
the usage line of `web/scripts/probe-query.mts`; a recorded reply as a fixture. A definition then says
`{ kind: "query", protocol }`.

*A probe kind* (`web/src/domain/games/types.ts#HealthProbe`): `labelFor` and `run` in
`web/src/domain/servers/health.ts`, the evidence the poller gathers for it in `web/src/lib/poller.ts` (one branch per
kind, **silent**), the preview, and the manifest parser. If it needs something the node cannot do today, it is
a contract decision, not a probe.

## Add a version source

The variant of `web/src/domain/games/types.ts#VersionSourceRef`; `web/src/domain/games/providers/<id>.ts`
implementing the provider interface through `web/src/domain/games/providers/http.ts#getJson`, which bounds,
caches and fails loudly; its registration in `web/src/domain/games/providers/index.ts`; an entry in each of the two
maps named `ORIGINS` (`web/src/lib/catalog-sync.ts`, `web/src/lib/catalog-read.ts`) and the Prisma enum
`web/prisma/schema.prisma#VersionSource` with a migration. **None is forced**: adding a variant breaks nothing,
and a provider nobody registered is skipped by design. A stub-provider test in the style of
`web/test/providers.test.ts`, and [versions.md](versions.md).

## What holds all this together

Tests that fail when a place is forgotten, so far: every definition file is registered or parked and
passes its audit; every offered game has a cover and every family is reserved; the measured
capabilities and the reserved ports match the agent's own; an API scope is the same in the key form, the permission
table and [api.md](api.md); every handler is named in [api.md](api.md) and called by `verify:api`; every column
documented as sealed is in the `rekey` table; every audit action the notifier reads has a producer; a released
migration is never edited and the next release only adds. What is not held, and is listed above as silent, is the
work still to do before a contributor can add a notification channel, a probe or a version source with the compiler
as the guide.
