# geeboard-daemon

The node agent. One instance runs on every machine that hosts game servers, and
the panel is the only thing that talks to it.

The panel never touches Docker directly — it has no reason to be on the same
machine as the containers, and in production it will not be.

## What it does today

- Creates and destroys containers, with their ports, limits and data directory
- Lists, inspects, starts, stops and restarts managed containers
- Reads recent log output, and streams it live over a WebSocket
- Sends a command to a running server's stdin
- Samples real CPU, memory and network figures
- Lists, reads, writes, moves and deletes files inside a server's own directory

## Talking to the panel

Optional, and off unless configured. With `GEEBOARD_PANEL_URL` set the agent
also:

- Registers itself once, using a single-use token from the panel, sending its
  name, its advertised address, its own agent token, and what it measured about
  the machine. The node lands awaiting approval.
- Posts a heartbeat every 15 seconds with its load and capabilities.

Neither is fatal if it fails. An agent that fell over because it could not phone
home would turn a monitoring outage into a hosting one — the containers on this
machine do not need the panel to keep running. Registration retries with a
backoff; a refused token is reported once and not retried, because it will be
refused again.

## What it does not do yet

- Upload or download binary files; the file API is text only
- Pull from a private registry; there is nowhere to put credentials yet
- Install a server itself. Every game currently runs an image that fetches its
  own files, which is why the SteamCMD install strategy has nothing to do here.

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
| `GEEBOARD_DATA_ROOT` | `/var/lib/geeboard/servers` | Each server owns a directory under here. |
| `GEEBOARD_PULL_TIMEOUT_MS` | `120000` | How long an image pull may take before a create gives up. |
| `GEEBOARD_PANEL_URL` | *none* | Where the panel is. Unset means the agent never contacts it. |
| `GEEBOARD_ADVERTISE_URL` | *none* | Where the panel can reach this node. Required to register. |
| `GEEBOARD_REGISTRATION_TOKEN` | *none* | Single-use token from the panel. Needed once. |
| `GEEBOARD_CAPABILITIES` | *none* | Comma-separated: what this node is willing to run. |
| `GEEBOARD_VERSION` | `0.1.0` | Reported to the panel so an operator can see what is deployed. |

The managed label matters: the daemon will not list, touch or report on any
container that is not carrying it, so it can share a Docker host safely. Its
value on a container is the panel's server id, so anything found on the node can
be traced back to the server it belongs to.

## API

Every route except `/health` requires `Authorization: Bearer <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness. Unauthenticated, and says nothing about what is running. |
| `GET` | `/version` | Node name, agent version, Docker engine, platform, capabilities, size and load. |
| `GET` | `/servers` | Managed containers and their state. |
| `POST` | `/servers` | Create one. Body: the spec below. |
| `GET` | `/servers/:id` | One container's state. |
| `DELETE` | `/servers/:id?data=true` | Remove the container, and its directory when asked. |
| `POST` | `/servers/:id/start` | Start it. |
| `POST` | `/servers/:id/stop` | Stop it. Body: `{ "graceSeconds": 30 }`. |
| `POST` | `/servers/:id/restart` | Restart it. |
| `GET` | `/servers/:id/stats` | One CPU, memory and network reading. |
| `GET` | `/servers/:id/logs?tail=200` | Recent output. |
| `POST` | `/servers/:id/command` | Write one line to stdin. Body: `{ "command": "say hi" }`. |
| `WS` | `/servers/:id/console` | Live output, one JSON message per line. |
| `GET` | `/servers/:id/files?path=` | List a directory. |
| `GET` | `/servers/:id/files/content?path=` | Read a file, up to 2 MB. |
| `PUT` | `/servers/:id/files/content?path=` | Write a file. Body: `{ "content": "..." }`. |
| `POST` | `/servers/:id/files/directory?path=` | Create a directory. |
| `POST` | `/servers/:id/files/move` | Body: `{ "from": "...", "to": "..." }`. |
| `DELETE` | `/servers/:id/files?path=` | Delete a file or directory. |

### Creating a server

```jsonc
POST /servers
{
  "serverId": "clx…",              // the panel's id; becomes the label and the directory
  "name": "nightwatch",            // becomes the container name, prefixed geeboard-
  "image": "itzg/minecraft-server:java21",
  "ports": [
    { "label": "Game",  "host": 25568, "protocol": "both" },
    { "label": "RCON",  "host": 25570, "container": 25575, "protocol": "tcp" }
  ],
  "memoryMb": 8192,
  "cpuLimit": 300,                 // percent of one core
  "env": { "EULA": "TRUE" },
  "start": true
}
```

Everything in that body is checked before Docker sees any of it: the server id
against the same rule the file API uses, the name and image against what they
are allowed to contain, ports against the range the daemon can actually bind,
and the limits against what a container can be given. A refused request is a
400 and creates nothing.

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

**Files never leave their server's directory.** Every requested path is
resolved inside `<dataRoot>/<serverId>` and refused if it escapes. The check
runs twice on purpose: a lexical one catches `../`, and a `realpath` one catches
a symlink pointing out of the tree, which no amount of string handling would
see. The server root itself cannot be deleted, and a file over 2 MB is reported
rather than streamed into a browser textarea.

**Commands go to stdin,** not to a new process. A game server reads its console
from stdin; running `exec` would start a second process that the server never
sees. Multi-line input is rejected so a second command cannot be smuggled in.

The attach itself is made by hand rather than through dockerode's `attach`,
because that sends the attach options as a JSON request body and Docker hijacks
the connection before it consumes the body — so those bytes arrive as console
input. It is intermittent, which is what makes it worth a comment: it depends on
which side wins the race, and the symptom is an options object typed into the
server's console. A zero-length body is the way out.

**Nothing is created half-made.** If a container starts and fails, the daemon
removes it before answering, so a create either produces a running server or
leaves the node as it found it. Destroying takes a container id or a server id —
a rolled-back create can leave a directory with no container, and both have to
be reachable or one of them leaks.

**A crash stays crashed.** Containers are created with no restart policy on
purpose. Docker restarting one behind the panel's back is exactly the drift the
poller exists to catch, and restart-after-crash is a policy the panel applies,
where it can be audited.

## Tests

```bash
npm run verify
```

`test/docker.test.ts` covers the parsing and arithmetic with no Docker needed,
and `test/provision.test.ts` does the same for every way a create request can be
refused. `test/integration.test.ts` starts the daemon against real containers and
exercises auth, listing, logs, stdin commands, WebSocket streaming, stats, the
stop/start cycle, and creating and destroying a container from nothing. It needs
a running Docker and cleans up after itself.
