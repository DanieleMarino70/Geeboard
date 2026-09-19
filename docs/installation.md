# Installation

Three pieces: the panel, the poller, and one agent per machine.

## Requirements

- Node.js 20+
- PostgreSQL 16 (the compose file provides one)
- Docker on each node — not on the panel host, unless it is also a node

## The panel

```bash
docker compose up -d          # Postgres on 5432

cd web
npm install
cp .env.example .env
```

Fill in `.env`:

```bash
DATABASE_URL="postgresql://geeboard:geeboard@localhost:5432/geeboard?schema=public"
SESSION_SECRET="$(openssl rand -base64 32)"
SECRETS_KEY="$(openssl rand -base64 32)"
```

Both secrets need at least 32 characters. `SECRETS_KEY` encrypts node tokens at
rest; it falls back to `SESSION_SECRET` if unset, but keep them separate so
rotating one does not disturb the other. **Rotating `SECRETS_KEY` makes every
stored node token undecryptable** — re-encrypt before you do.

```bash
npm run db:migrate            # schema
npm run db:seed:empty         # one owner + the game catalog, nothing else
npm run dev                   # http://localhost:3000
```

Sign in as `mara@ashfold.gg` / `geeboard`.

Two starting points, and they are different kinds of thing:

| | |
| --- | --- |
| `npm run db:seed:empty` | An owner and the catalog. No nodes, no servers. What a real installation starts from, and the one to use when attaching a real machine — every figure on the panel is then true |
| `npm run db:seed` | The sample workspace the screens were designed against: three nodes with no agent, four servers whose start and stop are simulated, invented history. Marked as simulated wherever it shows |

Both wipe the database first.

`PANEL_URL` in `.env` is optional: the address node agents should use to reach
the panel, offered in the Add a node command. Without it, the address your
browser used is offered, and the field stays editable.

On an existing database, sync the catalog without reseeding:

```bash
npm run games:sync
```

This is the only thing that asks Steam, GitHub and Mojang about versions.
Nothing rendering a page does, so an upstream outage makes the catalog stale
rather than breaking the panel. Run it on a schedule — hourly is ample — and
watch its exit code: non-zero means a provider failed and some rows kept what
they had. `--offline` skips the network entirely.

## The poller

Its own process, deliberately — a timer inside Next would run once per replica,
restart on every rebuild, and quietly stop mattering in production.

```bash
cd web
npm run poll                  # every 15s; POLL_INTERVAL_MS to change
npm run poll:once             # one pass, for a cron
```

It reconciles server state against every reachable node, records drift as
activity events, writes metric samples, and prunes samples older than 30 days.

## A node

The machine needs Docker, Node.js, and a copy of this repository.

In the panel: **Nodes → Add a node**. Name the node, tick what the machine
should run, and **Create the command**. On the machine, in the `daemon`
directory with Docker running, paste what it shows:

```bash
npm install
npm run join -- 'http://panel.lan:3000' 'gbn_…'
```

`join` works out the address the panel should reach the agent on, generates the
agent's own token, registers, saves its settings to the account's profile, and
starts the agent. The dialog shows the node when it registers and offers
**Approve**. After that, starting the agent again is:

```bash
cd daemon && npm start
```

Nothing from the command has to be kept. See [nodes.md](nodes.md#registering-a-node)
for what `join` does and where its settings live; `--advertise` is for a machine
the panel reaches through a forwarded port or a proxy.

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

## Production notes

```bash
cd web && npm run build && npm start
```

- Put TLS in front of the panel. Sessions are `Secure` when
  `NODE_ENV=production`, which means they will not be sent over plain HTTP.
- Run the poller as its own service.
- Rate limiting is per-process; put a real limiter in front if the panel is
  public.
- Back up Postgres. Geeboard's own backups do not copy world data yet
  ([backups.md](backups.md)).
