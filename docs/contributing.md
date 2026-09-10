# Contributing

## Before writing anything

Ask where it belongs:

> Panel, node, game definition, or runtime?

Most mistakes in a project like this are misplacements rather than bugs. Game
knowledge in a page component and machine knowledge in the panel both spread.

## The bar

A change is finished when:

- The architecture is coherent — it went in the right layer
- Validation exists, and refuses with a message that says what to fix
- Authorization exists, through `can()` rather than a role comparison
- Errors are `PlatformError`s with codes
- Tests exist: unit for domain logic, a verify script for anything needing a
  database
- The documentation is updated, including what still does not work
- Existing functionality still works — `npm run test:unit`, `npm run build`, and
  `npm run verify` if you have Postgres
- Security was considered, and said out loud in the pull request if it was
  touched

Compiling is not the bar.

## Adding a game

The easiest useful contribution. See [games.md](games.md): a definition, one
registry line, tests. The registry audit will catch most mistakes at import.

What makes a good definition is honesty about the game. If a setting lives in a
config file, target the file — do not pretend it is an environment variable
because that is what the platform can write today. If a game has no console
language, say so with an empty `examples` rather than inventing commands.

## Comments

Write the ones that are about the trap. `daemon/src/docker.ts` is the register
to match: why 137 is not a crash, why the attach is made by hand, why the
restart policy is `no`. A comment restating the line below it is noise; one
explaining why the obvious version is wrong saves the next person an afternoon.

## Not welcome without a strong argument

Kubernetes, microservices, message brokers, event buses, a second database,
cloud provisioning, or an abstraction with one implementation and no second one
in sight. `IGameRuntime` has one implementation and earns it by keeping Docker
out of the other forty files; most abstractions do not clear that bar.

## Pull requests

Say what changed, why, and what it does not do. The last part is the one that
gets skipped and the one that matters — an honest list of limitations is how the
next person knows where to start.
