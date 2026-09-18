# Development

## Layout

```
web/                    the panel
  src/domain/           what things are — no database, no network
    access/             permissions
    games/              definitions, registry, versions, config
    nodes/              compatibility, health decay, placement, retirement
    runtime/            IGameRuntime and the Docker implementation
    servers/            server state, reconciliation, and game health
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
npm run db:migrate     npm run db:seed        npm run db:studio
npm run db:seed:empty  npm run db:reset       npm run poll
npm run poll:once
npm run games:sync                  # ask upstream, using the cache
npm run games:sync -- --refresh     # ignore the cache
npm run games:sync -- --offline     # definitions only, no network

npm run test:unit      # 203 tests, no database, no Docker
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
| `web/scripts/verify-*.mts` | Postgres | Operations against the seeded fixture. Each reseeds first, so they run in any order, repeatedly |
| `verify:agent`, `:registration`, `:console`, `:poller`, `:files`, `:create`, `:backups` | Postgres **and** Docker | The whole stack: each spawns a real agent against real containers, and cleans up after itself |
| `daemon/test/*.test.ts` | Docker for the integration file | Parsing and arithmetic with no Docker; the integration file drives real containers and cleans up |

Unit tests first for anything in `src/domain` — that is what the layer is for.
Something that needs a database belongs in a verify script, and something whose
failure mode is "it looked fine until a real node was involved" belongs in one
of the Docker-backed ones.

`verify:registration` is the one that attaches a node the way a person does.
Every other Docker-backed script writes `daemonUrl` and `daemonToken` into a node
row, which is exactly the step nobody using the panel can take — and why Add a
node could be broken end to end while they all passed. It starts from an empty
workspace, builds the command the dialog shows, runs its `npm run join` for real
against the panel's real register and heartbeat route handlers, stops the agent
and starts it again from the saved settings alone, and approves, creates, stops,
starts and deletes through the operations the buttons call.

The Docker-backed scripts use an Alpine container wearing a game image's name.
That proves the platform and nothing about the game: every Terraria bug in
[games.md](games.md) passed all of them. A game is verified by running its own
image on a real node.

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
- No new dependency without a reason that survives being said out loud.

## Design canvas

`design-canvas/` holds the design system as `.dc.html` artboards. The panel is
built from it, and the pages still on `Placeholder` name the artboard they are
waiting on.
