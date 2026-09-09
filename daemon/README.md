# geeboard-daemon

The node agent. One instance runs on every machine that hosts game servers, and
the panel is the only thing that talks to it.

The panel never touches Docker directly — it has no reason to be on the same
machine as the containers, and in production it will not be.

## What it does today

- Lists, inspects, starts, stops and restarts managed containers
- Reads recent log output, and streams it live over a WebSocket
- Sends a command to a running server's stdin
- Samples real CPU, memory and network figures

## What it does not do yet

- Read or write a server's files (the Files page still has no backend)
- Report anything to the panel on its own — the panel asks, the daemon answers
- Create or destroy containers; it only drives ones that already exist

## Running it

```bash
npm install
GEEBOARD_DAEMON_TOKEN=<at least 32 characters> \
GEEBOARD_NODE_NAME=fra-node-02 \
npm start
```

The agent refuses to start without a token or a node name. There is no default
for either, deliberately: nothing that grants access should ever be checked in.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEEBOARD_DAEMON_TOKEN` | *required* | Shared secret the panel presents. Minimum 32 characters. |
| `GEEBOARD_NODE_NAME` | *required* | Matches the node's name in the panel. |
| `GEEBOARD_DAEMON_PORT` | `8080` | Listen port. |
| `GEEBOARD_DAEMON_HOST` | `0.0.0.0` | Listen address. |
| `GEEBOARD_SAMPLE_MS` | `15000` | Metric sampling interval. |
| `GEEBOARD_MANAGED_LABEL` | `gg.geeboard.server` | Only containers carrying this label are visible. |

That last one matters: the daemon will not list, touch or report on any container
that is not labelled as one of ours, so it can share a Docker host safely.

## API

Every route except `/health` requires `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Unauthenticated, and says nothing about what is running. |
| `GET` | `/version` | Node name and Docker engine version. |
| `GET` | `/servers` | Managed containers and their state. |
| `GET` | `/servers/:id` | One container's state. |
| `POST` | `/servers/:id/start` | Start it. |
| `POST` | `/servers/:id/stop` | Stop it. Body: `{ "graceSeconds": 30 }`. |
| `POST` | `/servers/:id/restart` | Restart it. |
| `GET` | `/servers/:id/stats` | One CPU, memory and network reading. |
| `GET` | `/servers/:id/logs?tail=200` | Recent output. |
| `POST` | `/servers/:id/command` | Write one line to stdin. Body: `{ "command": "say hi" }`. |
| `WS` | `/servers/:id/console` | Live output, one JSON message per line. |

## Notes on the tricky parts

**Log framing.** With no TTY, Docker multiplexes stdout and stderr into one
stream with an 8-byte header per chunk. `demultiplex` splits it back apart and
drops a trailing partial frame rather than emitting a mangled line.

**CPU percentage.** Docker reports cumulative counters. The figure is the
container's delta over the system delta, scaled by core count, and clamps to
zero when a counter resets — otherwise a restart shows a negative spike.

**Memory.** Page cache is subtracted from usage, because `usage` alone counts
cache the kernel will happily evict and makes every server look near its limit.

**A stop is not a crash.** `docker stop` sends SIGTERM and escalates to SIGKILL
after the grace period. Most game servers run under a shell that never installs
a SIGTERM handler, so an ordinary shutdown exits 137. Treating that as a crash
would flag every normal stop, so 137 counts as stopped — while `OOMKilled` is
reported as a crash whatever the exit code, since that is the one an operator
most needs to hear about.

**Commands go to stdin,** not to a new process. A game server reads its console
from stdin; running `exec` would start a second process that the server never
sees. Multi-line input is rejected so a second command cannot be smuggled in.

## Tests

```bash
npm run verify
```

`test/docker.test.ts` covers the parsing and arithmetic with no Docker needed.
`test/integration.test.ts` starts the daemon against a real Alpine container and
exercises auth, listing, logs, stdin commands, WebSocket streaming, stats and
the stop/start cycle. It needs a running Docker and cleans up after itself.
