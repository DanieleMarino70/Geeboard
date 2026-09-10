# The node agent

One instance runs on every machine that hosts game servers. The panel is the
only thing that talks to it.

The full reference — every route, every environment variable, and the reasoning
behind the parts that are easy to get wrong — is in
[daemon/README.md](../daemon/README.md). This page is about where it sits.

## What it is responsible for

Machine-level operations, and nothing else:

```
create · destroy · start · stop · restart
logs · console stdin · statistics
file list, read, write, move, delete
runtime version and liveness
```

## What it is deliberately not

- **It has no database access.** It answers questions; it does not know what a
  game is, what a version means, or who owns anything.
- **It has no business logic.** Placement, permissions, schedules, backups and
  update policy are the panel's. An agent that starts making those decisions is
  a second backend with a copy of the rules, which is how the two drift apart.
- **It does not report on its own.** The panel asks, the agent answers. A
  heartbeat is Phase 3.

## Where the panel meets it

`DockerRuntime` in [`web/src/domain/runtime/docker.ts`](../web/src/domain/runtime/docker.ts)
is the only class that knows the agent's protocol. Everything above it holds an
`IGameRuntime` and speaks in game servers.

The wire client is [`web/src/lib/daemon-client.ts`](../web/src/lib/daemon-client.ts).
It mirrors `daemon/README.md`; if that API changes, those two files change with
it.

## The parts worth knowing about

Each of these is explained properly in the agent's own README, and each exists
because the obvious implementation is wrong:

- **Log framing.** With no TTY, Docker multiplexes stdout and stderr into one
  stream with an 8-byte header per chunk. A trailing partial frame is dropped
  rather than emitted mangled.
- **CPU percentage** is a delta over the system delta scaled by core count, and
  clamps to zero when a counter resets — otherwise a restart shows a negative
  spike.
- **Memory** subtracts page cache, because `usage` alone counts cache the kernel
  will evict and makes every server look near its limit.
- **A stop is not a crash.** Exit code 137 is an ordinary shutdown; `OOMKilled`
  is a crash whatever the exit code.
- **Files never leave their server's directory,** checked lexically and through
  `realpath`.
- **Commands go to stdin,** not to a new process — and the attach is made by
  hand because dockerode's would deliver its own options object to the game's
  console.
- **Nothing is created half-made.** A container that starts and fails is removed
  before the agent answers.
- **A crash stays crashed.** `RestartPolicy: no`, on purpose: restart-after-crash
  is a policy the panel applies, where it can be audited.

## Tests

```bash
cd daemon && npm run verify
```

`docker.test.ts` and `provision.test.ts` need nothing. `files.test.ts` covers
traversal, symlink escape and null bytes. `integration.test.ts` starts the agent
against real containers and exercises auth, listing, logs, stdin, WebSocket
streaming, stats, the stop/start cycle, and creating and destroying a container
from nothing. It needs Docker and cleans up after itself.

## Phase 1 changed nothing here

The agent was the strongest part of the project and was left exactly as it was.
What changed is the panel's side of the conversation: it now goes through a
runtime interface rather than calling the client directly from six places.
