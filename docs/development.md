---
title: Develop
nav_order: 7
has_children: true
---

# Development

## Layout

```
web/                    the panel
  src/domain/           what things are — no database, no network
    access/             permissions, account rules, two-factor codes
    games/              definitions, registry, versions, config
    nodes/              compatibility, health decay, placement, retirement
    runtime/            IGameRuntime and the Docker implementation
    servers/            server state, reconciliation, game health, crash
                        recovery, players, saving and stopping
    storage/            signing requests to an S3-compatible bucket
  src/lib/              what happens — operations, queries, db, auth, api
  src/app/              routes, pages, server actions
  src/components/       the design system
  prisma/               schema, migrations, seed
  scripts/              poller, catalog sync, verification scripts
  test/                 unit tests, no database or Docker needed
daemon/                 the node agent
  src/                  config, auth, docker, files, provision, http
                        capabilities (what the machine is), panel (registration
                        and heartbeat — the only outbound calls it makes)
  test/                 unit and integration tests
docs/
design-canvas/          the design system as a multi-artboard canvas
```

## The rule that decides where code goes

> Does this belong to the panel, the node, the game definition, or the runtime?

- Game-specific knowledge goes in a definition. A `if (game === …)` anywhere else
  is a definition missing a field.
- Machine operations go in the agent. The agent has no database access and no
  business logic; it must not become a second backend.
- Anything phrased in Docker terms stops at `DockerRuntime`.

## Scripts

```bash
# panel
npm run dev            npm run build          npm run lint
npm run typecheck      npm run setup:env      # .env with generated secrets
npm run setup          npm run admin:recover  # a production installation's
                                              # first owner, and the way back
npm run db:migrate     npm run db:seed        npm run db:studio
npm run db:seed:empty  npm run db:reset       npm run poll
npm run poll:once
npm run games:sync                  # ask upstream, using the cache — by hand;
                                    # the poller does it when the catalog is
                                    # more than six hours old
npm run games:sync -- --refresh     # ignore the cache
npm run games:sync -- --offline     # definitions only, no network

npm run test:unit      # 280 tests, no database, no Docker
npm run verify         # unit tests + the DB-backed operation checks
npm run verify:all     # + everything that needs a real agent and real Docker

# agent
cd daemon
npm run verify         # unit tests, plus integration against real containers
npm run typecheck
```

## Tests

Three kinds, and they need different things:

| | Needs | |
| --- | --- | --- |
| `web/test/*.test.ts` | nothing | Domain logic: versions and build ids, config rendering and merging, the install sequence, compatibility, permissions, state reconciliation, errors |
| `web/scripts/verify-*.mts` | Postgres | Operations against the seeded fixture. Each reseeds first, so they run in any order, repeatedly — and **wipe whatever database `DATABASE_URL` names** |
| `verify:setup` | Postgres | The production installation, from an empty database: a database of its own, `npm run setup` run as a child process for its printed password, and a panel started on its own port to see the gate redirect and the API refuse |
| `verify:agent`, `:registration`, `:console`, `:poller`, `:files`, `:create`, `:backups` | Postgres **and** Docker | The whole stack: each spawns a real agent against real containers, and cleans up after itself |
| `daemon/test/*.test.ts` | Docker for the integration file | Parsing and arithmetic with no Docker; the integration file drives real containers and cleans up |

**Give the verify scripts a database of their own.** Every one of them reseeds,
and the seed deletes everything first: run against the database the panel is
using, `npm run verify` replaces its nodes, servers, accounts, storage settings
and audit log with the sample workspace. That has happened here once. Make a
second database beside the first, migrate it, and name it on the command —
`process.loadEnvFile` does not override a variable that is already set, so the
one on the command line wins over `.env`:

```bash
docker exec geeboard-postgres createdb -U geeboard geeboard_verify
cd web
export VERIFY_DB="postgresql://geeboard:geeboard@localhost:5432/geeboard_verify?schema=public"
DATABASE_URL="$VERIFY_DB" npx prisma migrate deploy   # again after every schema change
DATABASE_URL="$VERIFY_DB" npm run verify
```

Check the directory before pressing enter, too: `npm run verify` is the agent's
own tests in `daemon/`, and a reseed in `web/`.

Unit tests first for anything in `src/domain` — that is what the layer is for.
Something that needs a database belongs in a verify script, and something whose
failure mode is "it looked fine until a real node was involved" belongs in one
of the Docker-backed ones.

`verify:setup` is the one that installs the panel the way a person does. It
makes `<your database>_setup` beside whatever `DATABASE_URL` names and drops it
afterwards, never touching the one you are working with; it runs `npm run
setup` as a child process and reads the temporary password out of its output,
because that is the only way anybody ever gets it; and it starts a second panel
on its own port and its own build directory (`GEEBOARD_DIST_DIR=.next-verify`,
which is what lets it run beside a `npm run dev` of your own). The gate it
proves — every page redirecting, the API answering 403 — is a thing only a
running server does.

`verify:registration` is the one that attaches a node the way a person does.
Every other Docker-backed script writes `daemonUrl` and `daemonToken` into a node
row, which is exactly the step nobody using the panel can take — and why Add a
node could be broken end to end while they all passed. It starts from an empty
workspace, builds the command the dialog shows, runs its `npm run join` for real
against the panel's real register and heartbeat route handlers, stops the agent
and starts it again from the saved settings alone, and approves, creates, stops,
starts and deletes through the operations the buttons call.

**They allocate ports from their own database.** Running them beside a live panel
on one machine, as this repository is developed, means the allocator does not
know that a real server already holds 7777 or 25565 on the host — Docker refuses
the bind and the script fails with `port is already allocated`. That is the
machine, not the code: stop the real server on the conflicting port first, or run
them where nothing else is hosting.

Two of them used to fail now and then, and both were the scripts, not the code.
`verify:poller` crashed its stand-in by writing to the container with dockerode's
attach, which puts its own options object on stdin ahead of the line — so the
stand-in read `{"stream":true,…}crash` and never crashed. It now sends the
command through the agent's console route, the one the panel uses.
`verify:registration` read the agent's saved settings the moment the node row
appeared, while `join` was still waiting for the panel's answer before writing
them. It now waits for the file.

The Docker-backed scripts use an Alpine container wearing a game image's name.
That proves the platform and nothing about the game: every Terraria bug in
[games.md](games.md) passed all of them. A game is verified by running its own
image on a real node.

Wearing the name means taking the tag, and on a machine that also hosts real
Minecraft servers the tag belongs to a 1.2 GB image. `verify:create`,
`verify:registration` and `verify:backups` note what the tag named before they
cover it and point it back there when they finish, so the next real create
pulls nothing. The real image is untagged while a script runs — do not create a
Minecraft server from the panel in the middle of one.

`verify:backups` also starts a MinIO container of its own (`quay.io/minio/minio`,
pulled on first run) for the off-site half, on a random port above 9100, and
removes it with the rest.

What the Docker-backed scripts added for the release, each against a real agent:
`verify:backups` flips a byte in a real archive and replaces an object in MinIO
to see both found, deletes a server with a last backup and restores it into
another, checks that a workload remembers what it was made from, puts a proxy in
front of the agent that refuses one provisioning to see a settings rebuild go
back, and rolls back a server whose container it removed by hand;
`verify:registration` rotates the agent's token and checks the old one is
refused and the heartbeat carries on; `verify:files` sends every byte value
through the upload and download operations. `verify:backups` found two bugs of
its own making on the way — a spec compared as text after a JSONB column had
reordered its keys, and MinIO answering its liveness check before it would take
a bucket.

**Measuring a health query** is a script of its own, because it is done before a
definition may declare the probe and needs no panel, agent or database:

```bash
npx tsx scripts/probe-query.mts terraria-hello 17777 5   # protocol, host port, times
```

It sends the bytes `domain/servers/query.ts` builds, the way the node sends them,
to a game's real image started by hand, and prints what came back and how it was
judged. A game that does not survive it does not get the probe; then freeze the
game (`docker pause`, or `kill -STOP` inside it) and see the question go
unanswered rather than the server fall over when it is let go.

The split earns its keep. `verify:poller` and `verify:backups` have each caught
a bug the unit tests could not see, because both were about trusting a stored
row where the runtime was the thing that actually knew. `verify:catalog` caught
the pre-catalog linker attaching a Purpur server to a leftover Mojang row —
something only a database that had been synced before could show.

## Adding a game

See [games.md](games.md). Definition, one registry line, `npm run test:unit`,
`npm run games:sync`. The registry audits every definition at import, so a
mistake fails at startup with a message naming it.

## Changing the schema

```bash
# edit prisma/schema.prisma
npm run db:migrate      # writes and applies the migration
```

Two things worth care:

- **Renames must be renames.** Prisma's diff will happily write a `DROP COLUMN`
  and an `ADD COLUMN` for what is really a rename, which loses the data. The
  Phase 1 migration hand-edits `containerId` → `runtimeId` into an
  `ALTER TABLE … RENAME COLUMN` for exactly this reason.
- **Adding a `ServerState` or `NodeState` value** will break the typecheck at
  `STATE_META` in `src/lib/queries.ts`, which is deliberate — a state with no
  label would render as nothing.

Without a database to migrate against, generate the SQL offline and hand-edit:

```bash
npx prisma migrate diff --from-schema <old>.prisma --to-schema prisma/schema.prisma --script
```

## Conventions

- **Comments say why, not what.** The ones worth writing are about the trap:
  why the stop code is 137, why containment is checked twice, why the row is
  written before the workload. Look at `daemon/src/docker.ts` for the register.
- Prefer a coded `PlatformError` over a string, at every boundary.
- Operations live in `src/lib/*-ops.ts` as plain functions of `(actor, …)`.
  Server actions are thin wrappers that resolve the user and revalidate — so an
  operation can be exercised directly by a verify script.
- Anything touching the database is `server-only`. Scripts that import it need
  `tsx --conditions=react-server`.
- No new dependency without a reason that survives being said out loud. The one
  the release work added is `uqr`, for the two-factor QR code: TOTP, the S3
  signature and the tar writer were written by hand because each had something
  to be checked against, and a QR encoder has only a phone.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: lint,
typecheck, the unit tests of both packages, `npm run verify` against a Postgres
service, the production build, and a build of the panel image. The Docker-backed
verify scripts are **not** there — each starts an agent against a real engine,
pulls game images and binds host ports — so `npm run verify:all` on a machine
with Docker is what covers them, and the workflow says so where somebody would
look for them.

The image build is in CI because it has broken while the checkout was fine: it
has its own `npm ci` and its own type check, and a script that imports from
`daemon/` is outside its build context.

## Design canvas

`design-canvas/` holds the design system as `.dc.html` artboards. The panel is
built from it. No page is a placeholder any more; the ones whose feature does
not exist — Plugins, Marketplace — say so in words instead of drawing the
artboard.
