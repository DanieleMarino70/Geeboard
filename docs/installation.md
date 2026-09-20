---
title: A checkout to try it
parent: Install
nav_order: 1
---

# Installation

Three pieces: the panel, the poller, and one agent per machine.

**Installing it for real is [production.md](production.md)** — Docker or
systemd, TLS, and the first owner with a temporary password. This page is the
development checkout, which uses the seed, and the agent, which is the same
either way.

## Requirements

- Node.js 20+
- PostgreSQL 16 (the compose file provides one)
- Docker on each node — not on the panel host, unless it is also a node

## The panel

```bash
docker compose up -d          # Postgres on 5432

cd web
npm install
npm run setup:env             # writes .env with two generated secrets
npm run db:migrate            # schema
npm run db:seed:empty         # one owner + the game catalog, nothing else
npm run dev                   # http://localhost:3000
```

Sign in as `mara@ashfold.gg` / `geeboard` — the seed's account, whose password
is in this repository, which is why `db:seed` and `db:seed:empty` refuse to run
with `NODE_ENV=production`. A real installation's first owner comes from
[`npm run setup`](production.md#the-first-owner) instead, with a temporary
password shown once.

`setup:env` generates `SESSION_SECRET` and `SECRETS_KEY` and does not print
them; run again on a file that exists, it changes nothing and says what is
wrong with it, if anything. The panel refuses a secret that is missing, short,
or the example file's own — which used to be a thirty-six-character sentence
that passed every length check. `SECRETS_KEY` encrypts node tokens and the
off-site bucket's keys; **changing it makes every one of them undecryptable**.

Two starting points, and they are different kinds of thing:

| | |
| --- | --- |
| `npm run db:seed:empty` | An owner and the catalog. No nodes, no servers. What a real installation starts from, and the one to use when attaching a real machine — every figure on the panel is then true |
| `npm run db:seed` | The sample workspace the screens were designed against: three nodes with no agent, four servers whose start and stop are simulated, invented history. Marked as simulated wherever it shows |

Both wipe the database first.

`PANEL_URL` in `.env` is optional: the address node agents should use to reach
the panel, offered in the Add a node command. Without it, the address your
browser used is offered, and the field stays editable.

The catalog sync is the only thing that asks Steam, GitHub and Mojang about
versions. Nothing rendering a page does, so an upstream outage makes the
catalog stale rather than breaking the panel. **The poller runs it**: on each
pass it looks at the oldest synced game and, when that is more than six hours
old, starts a sync without waiting for it. `CATALOG_SYNC_INTERVAL_MS` changes
the interval, and `0` turns it off. It reads the age from the rows rather than
from a timer, so restarting the poller does not resync and a sync run by hand
counts. A provider that failed is a warning in the poller's output, and the
rows it could not refresh keep what they had.

By hand, on an existing database and without reseeding:

```bash
npm run games:sync
```

Use it after editing a definition, or when you do not want to wait for the
poller. It exits non-zero when a provider failed. `--refresh` ignores the
30-minute cache, and `--offline` skips the network entirely. `npm run
poll:once` does not sync: a single pass would exit before the sync finished.

## The poller

Its own process, deliberately — a timer inside Next would run once per replica,
restart on every rebuild, and quietly stop mattering in production.

```bash
cd web
npm run poll                  # every 15s; POLL_INTERVAL_MS to change
npm run poll:once             # one pass, for a cron
```

It reconciles server state against every reachable node, records drift as
activity events, asks each game whether it is answering, restarts what crashed
within its policy, reads players from the console, writes metric samples and
prunes those older than 30 days, runs the scheduled tasks that are due, and
keeps the game catalog fresh. Without it the panel still opens, and nothing on
it moves: no schedule fires, no crash is noticed.

## A node

In the panel: **Nodes → Add a node**. Name the node, tick what the machine
should run, and **Create the command**. The dialog shows a command for Linux
and one for Windows; each joins the panel and installs the agent as something
that starts at boot. The dialog shows the node when it registers and offers
**Approve**. Nothing from the command has to be kept: the token in it is spent
by its first run, and the agent's own token is made on the machine and never
shown to anybody. See [nodes.md](nodes.md#registering-a-node) for what `join`
does; `--advertise` is for a machine the panel reaches through a forwarded port
or a proxy.

### Linux: a container under systemd

The machine needs Docker and a checkout of this repository (for the build —
no image is published yet). From the checkout, as root:

```bash
sudo deploy/linux/install.sh 'http://panel.lan:3000' 'gbn_…' [--advertise http://10.0.0.5:8080] [--capabilities steamcmd]
```

The script builds `geeboard-agent:local` from `daemon/`, makes `/etc/geeboard`
(settings, root only) and `/var/lib/geeboard` (servers), runs `join` once in a
throw-away container — which registers the machine and writes
`/etc/geeboard/agent.json`, and does not start the agent — and installs and
starts `geeboard-agent.service`. The unit runs the container with the host's
network, the Docker socket, `/var/lib/geeboard` mounted **at the same path** it
has on the host (the agent writes a server's files there and asks the engine to
bind that path into the game's container, so both must mean one directory) and
`/etc/geeboard`. `/etc/geeboard/agent.env` holds the image tag and any
`GEEBOARD_*` override.

```bash
journalctl -u geeboard-agent -f         # watch it
sudo deploy/linux/install.sh            # upgrade: pull the repo, rebuild, restart
sudo deploy/linux/uninstall.sh [--purge] # remove the service; --purge removes settings and servers
```

An upgrade is a `git pull` followed by `install.sh` with no arguments: it
rebuilds the image and restarts the unit, and the saved settings carry over.
Uninstalling stops nothing the agent created — delete servers from the panel
first, then remove the node there.

Two agents on one Docker engine — a second node on a development machine — need
different `GEEBOARD_CONTAINER_PREFIX` values, or a server moving between them
finds its container name taken. Run the container with `-p <port>:<port>`
rather than the host network in that case, and `--advertise` the published
port; the agent listens on the port in the address it advertises.

### Windows: a scheduled task

Docker Desktop runs in the signed-in user's session, so the agent does too: the
checkout itself, run by a scheduled task in that account, started at every
sign-in and restarted if it stops. The machine needs Docker Desktop, Node.js
and a checkout. In PowerShell, in the checkout:

```powershell
cd daemon
npm.cmd install
npm.cmd run join -- 'http://panel.lan:3000' 'gbn_…' --no-start
..\deploy\windows\install-agent.ps1
```

`join --no-start` registers and saves `%LOCALAPPDATA%\Geeboard\agent.json`
without starting the agent; the script registers the task **Geeboard Agent**
(logon trigger, restart on failure, `npm.cmd start` in the checkout's `daemon\`
directory through a small wrapper beside the settings file) and starts it.

```powershell
Get-ScheduledTask 'Geeboard Agent' | Get-ScheduledTaskInfo   # last run and result
git pull; cd daemon; npm.cmd install; ..\deploy\windows\install-agent.ps1   # upgrade
.\deploy\windows\uninstall-agent.ps1                          # remove the task
```

The task is interactive, in the account that installed it: it runs while that
user is signed in, which is also when Docker Desktop runs. A machine that must
host servers with nobody signed in is a Linux machine. Verified on this PC:
the task starts the agent, the panel sees the node, and `uninstall-agent.ps1`
stops it.

### Bare, by hand

Still supported: a checkout, Node.js, `npm install`, `npm run join -- …`
(which starts the agent when it is done), and `npm start` after that. Nothing
starts it at boot.

Do not expose the agent to the internet. It should be reachable from the panel
and nothing else — a private network, a VPN, or a firewall rule. Its token is
the only thing standing between an open port and every container on the machine.

### Configuring it by hand

Every setting is also an environment variable, and a variable wins over what
`join` saved. With both `GEEBOARD_DAEMON_TOKEN` (at least 32 characters) and
`GEEBOARD_NODE_NAME` set, the saved file is not read at all:

```bash
cd daemon
npm install
GEEBOARD_DAEMON_TOKEN=$(openssl rand -hex 32) \
GEEBOARD_NODE_NAME=fra-node-02 \
npm start
```

| Variable | Default | |
| --- | --- | --- |
| `GEEBOARD_DAEMON_TOKEN` | from the saved file | Shared secret the panel presents |
| `GEEBOARD_NODE_NAME` | from the saved file | Matches the node's name in the panel |
| `GEEBOARD_AGENT_FILE` | the account's profile | Where `join` saves settings and `start` reads them |
| `GEEBOARD_DAEMON_PORT` | `8080` | |
| `GEEBOARD_DAEMON_HOST` | `0.0.0.0` | |
| `GEEBOARD_SAMPLE_MS` | `15000` | |
| `GEEBOARD_MANAGED_LABEL` | `gg.geeboard.server` | Only containers carrying this are visible |
| `GEEBOARD_CONTAINER_PREFIX` | `geeboard-` | Container name before the slug; a second agent on one Docker engine needs its own |
| `GEEBOARD_DATA_ROOT` | `/var/lib/geeboard/servers`; `%ProgramData%\Geeboard\servers` on Windows | One directory per server |
| `GEEBOARD_PULL_TIMEOUT_MS` | `120000` | |
| `GEEBOARD_PANEL_URL` | *none* | Where the panel is. Without it the agent never phones home, which is a supported way to run |
| `GEEBOARD_ADVERTISE_URL` | *none* | Where the panel can reach this node. Required to register this way |
| `GEEBOARD_REGISTRATION_TOKEN` | *none* | Registers on start. Needed once |
| `GEEBOARD_CAPABILITIES` | *none* | What this node is willing to run, beyond what can be measured — see below |

**Docker Desktop on Windows** works as a node: it reports `linux · x64`, because
its containers are Linux containers. Allow Docker Desktop to share the drive the
data root is on (the default settings share `C:`).

**Capabilities are measured or declared, never guessed.** Cores, memory, disk,
architecture and IPv6 are measured. SteamCMD and Java are not: games run in
containers, so whether the *node* has them installed says nothing. What matters
is whether you want those workloads here, and that is a policy — hence the
environment variable, where somebody signed their name to it.

Set the node's `region` and `city` afterwards if you want placement to honour a
region preference; the agent knows its address and its size, not where in the
world it is.

### Attaching one by hand

Still supported, and what a node without a panel URL does. The token must be
stored **encrypted**, so it goes through the panel's own helper:

```bash
cd web
DAEMON_TOKEN='<the token>' npx tsx --conditions=react-server -e '
  process.loadEnvFile(".env");
  const { encryptSecret } = await import("./src/lib/secrets.ts");
  console.log(encryptSecret(process.env.DAEMON_TOKEN));
'
```

Then set `daemonUrl` and `daemonToken` on the node row (`npm run db:studio`, or
SQL). A plaintext token in that column will fail to decrypt and the node will
read as unreachable.

Also set the node's `os`, `arch` and `capabilities` — placement uses them, and
an unreported capability makes every game that needs it *partial* rather than
compatible. For a typical Linux node:

```sql
UPDATE nodes SET os = 'linux', arch = 'x64',
  capabilities = ARRAY['docker','steamcmd','java','ssd','backups']
WHERE name = 'fra-node-02';
```

## Production

[production.md](production.md) is the whole of it: `deploy/panel/` for Docker
or `deploy/panel/systemd/` without it, the environment the panel refuses to
start without, a reverse proxy with TLS (sessions are `Secure` cookies, so a
panel on plain HTTP cannot sign anybody in), the first owner and the way back
into that account. [upgrading.md](upgrading.md) is the release after.
