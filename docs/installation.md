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
npm run db:seed               # sample workspace + game catalog
npm run dev                   # http://localhost:3000
```

Sign in as `mara@ashfold.gg` / `geeboard`.

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

On the machine that will host game servers:

```bash
cd daemon
npm install
GEEBOARD_DAEMON_TOKEN=$(openssl rand -hex 32) \
GEEBOARD_NODE_NAME=fra-node-02 \
npm start
```

The agent refuses to start without a token of at least 32 characters or without
a node name, and has no default for either.

| Variable | Default | |
| --- | --- | --- |
| `GEEBOARD_DAEMON_TOKEN` | *required* | Shared secret the panel presents |
| `GEEBOARD_NODE_NAME` | *required* | Matches the node's name in the panel |
| `GEEBOARD_DAEMON_PORT` | `8080` | |
| `GEEBOARD_DAEMON_HOST` | `0.0.0.0` | |
| `GEEBOARD_SAMPLE_MS` | `15000` | |
| `GEEBOARD_MANAGED_LABEL` | `gg.geeboard.server` | Only containers carrying this are visible |
| `GEEBOARD_DATA_ROOT` | `/var/lib/geeboard/servers` | One directory per server |
| `GEEBOARD_PULL_TIMEOUT_MS` | `120000` | |

Do not expose the agent to the internet. It should be reachable from the panel
and nothing else — a private network, a VPN, or a firewall rule. Its token is
the only thing standing between an open port and every container on the machine.

### Registering it

In the panel: **Nodes → Add a node**, which mints a single-use token. Then start
the agent with it:

```bash
GEEBOARD_DAEMON_TOKEN=$(openssl rand -hex 32) GEEBOARD_NODE_NAME=mil-node-01 GEEBOARD_PANEL_URL=https://panel.example.com GEEBOARD_ADVERTISE_URL=http://10.0.0.5:8080 GEEBOARD_REGISTRATION_TOKEN=<the token from the panel> GEEBOARD_CAPABILITIES=steamcmd,java,ssd npm start
```

| Variable | |
| --- | --- |
| `GEEBOARD_PANEL_URL` | Where the panel is. Without it the agent never phones home, which is a supported way to run. |
| `GEEBOARD_ADVERTISE_URL` | Where the panel can reach **this** node. Required to register; the panel cannot guess it. |
| `GEEBOARD_REGISTRATION_TOKEN` | Needed once. Remove it after the node is approved. |
| `GEEBOARD_CAPABILITIES` | What this node is willing to run, beyond what can be measured — see below. |

The node appears on the Nodes page awaiting approval, reporting its platform,
size and capabilities. Approve it and it is in service.

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
