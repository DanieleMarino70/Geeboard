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
- **It reports only two things on its own**: registering once, and a heartbeat
  every fifteen seconds with its load, size, platform and capabilities.
  Everything else, the panel asks and the agent answers.

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
- **One mount, where the game keeps its files.** The server's own directory is
  the only thing mounted, at `/data` unless the create request names another
  `dataPath` — Valheim's image keeps worlds in `/config`, and mounting at `/data`
  left them in the container layer, invisible to Files and absent from every
  backup. The path is refused unless it is absolute, at most two segments, and
  not a system directory.
- **Commands go to stdin,** not to a new process — and the attach is made by
  hand because dockerode's would deliver its own options object to the game's
  console.
- **Nothing is created half-made.** A container that starts and fails is removed
  before the agent answers.
- **A crash stays crashed.** `RestartPolicy: no`, on purpose: restart-after-crash
  is a policy the panel applies, where it can be audited.
- **The platform is the engine's.** `os` and `arch` come from Docker's `/info`,
  because the platform a game server runs on is the one its container runs on —
  Linux, on a Windows machine running Docker Desktop.
- **A private port is bound to loopback.** A port the create request marks
  `loopback` is published on `127.0.0.1` only. RCON and TShock's REST API used
  to be published on every interface.
- **Archives are tar, written by hand, with PAX headers for long paths.** A
  USTAR name holds 100 bytes; a Minecraft server's `libraries/` directory has
  paths of 148, and every Minecraft backup failed on them. A longer path now
  goes in a PAX extended header, which GNU tar, bsdtar and Python read. A
  restore reads PAX paths, GNU long names and the USTAR prefix field, and every
  path, however it arrived, is still confined to the server's directory.

## Tests

```bash
cd daemon && npm run verify
```

`join.test.ts` covers the join command's arguments, the address it advertises,
where its settings file lives and that `start` reads it, with a set variable
winning. `backups.test.ts` round-trips archives, long paths included, checks that another
tar can list what the agent wrote, and restores archives in the formats other
tools write. `docker.test.ts`, `provision.test.ts` and `capabilities.test.ts` need nothing —
the last covers the platform mapping, falling back to the host, and what
registration and the heartbeat send. `files.test.ts` covers
traversal, symlink escape and null bytes. `integration.test.ts` starts the agent
against real containers and exercises auth, listing, logs, stdin, WebSocket
streaming, stats, the stop/start cycle, and creating and destroying a container
from nothing. It needs Docker and cleans up after itself.

## Phase 1 changed nothing here

The agent was the strongest part of the project and was left exactly as it was.
What changed is the panel's side of the conversation: it now goes through a
runtime interface rather than calling the client directly from six places.
