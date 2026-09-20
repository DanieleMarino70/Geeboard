---
title: When it will not start
parent: Install
nav_order: 2
---

# When it will not start

Everything here has actually happened on a machine, most of them on the Windows
PC this is developed on. Each entry is what you see, then why, then what to do.

## The panel

### It exits at boot with a list of complaints

By design. The panel checks its configuration before it serves anything, and
refuses rather than starting half-configured — a panel that runs without
`SECRETS_KEY` would accept a node token it can never decrypt again. The
messages say what is wrong:

- `DATABASE_URL is not set.`
- `DATABASE_URL uses the development password geeboard. Give the production
  database its own.`
- `SECRETS_KEY is the same as SESSION_SECRET. They are separate so that one can
  be rotated without the other.`
- `PANEL_URL is not https. Session cookies are Secure in production and will
  not be sent over plain http.`

`npm run setup:env` writes a `.env` with two generated secrets. For a real
installation, [Install](production.md) says where each value comes from.

### Port 3000 is already taken

Another Next app, or an older `npm run dev` that was never stopped. On Windows
a background task can outlive the terminal that started it, so look for a
`node` process rather than a window:

```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Get-Process -Id <that id>
```

Under Docker, `PANEL_BIND` in `deploy/panel/.env` moves it: set it to
`127.0.0.1:3100` and the container keeps 3000 inside.

### Postgres is there but the panel cannot reach it

The development compose file publishes 5432 on the host. If a Postgres is
already installed on the machine — Windows installers register it as a service
that starts at boot — the container's port will not bind, or worse, will bind
and the panel will talk to the wrong database. Check which one answers:

```bash
docker compose ps
psql "$DATABASE_URL" -c "select current_database(), version();"
```

The production compose file keeps the database on an internal network with no
published port at all, which is one of the reasons it is a different file.

## Signing in

### The temporary password has run out

It is good for a day, once. From a terminal on the panel's own machine:

```bash
cd web
npm run admin:recover -- --email owner@example.com
```

That makes a new temporary password, shows it once, removes two-factor from the
account, ends its sessions, and writes `installation.owner.recovered` to the
audit log so the other owners can see a recovery nobody expected. The same
command is the way back from a lost phone with the recovery codes also gone.

Being able to run it is the proof of being the administrator: whoever can run a
command as the panel against its database already has everything the panel
protects. There is deliberately no web equivalent.

### The seed account does not work

`npm run db:seed` and `db:seed:empty` refuse to run with `NODE_ENV=production`,
and `mara@ashfold.gg` exists only where the seed has been run. A real
installation's first owner comes from `npm run setup`.

## Nodes

### The node registers but stays pending

That is the flow, not a fault. A machine that presents a registration token is
recorded and shown in **Nodes → Add a node**; somebody approves it there. Until
then it runs nothing.

### The node never appears at all

The agent has to reach the panel. `GEEBOARD_PANEL_URL` is the address it posts
to, and it has to be one that resolves from the machine the agent runs on —
`localhost` is the agent's own machine, not yours. The agent's log says which
address it tried.

### The node appears, then goes unreachable

Now it is the other direction: the panel has to reach the agent, on
`GEEBOARD_ADVERTISE_URL` (port 8080 by default). The agent works out its own
address at registration, and it guesses wrong on a machine with several
interfaces, a VPN, or Docker Desktop's virtual adapters. Set it explicitly and
restart the agent.

Inside Docker Desktop on Windows, `host.docker.internal` is not something the
Windows host itself resolves reliably: it works from inside a container and not
always from outside one. Where an agent in a container and an agent on the host
have to name the same machine — a shared bucket, for instance — use the LAN
address of the PC rather than that name.

### Every game is refused on a node that should fit

Docker Desktop gives its VM a fraction of the machine: 7.7 GB of a 16 GB PC, by
default. A node reports what its container engine can hand out, not what the
machine has, because that is the number that decides whether a server will
start — so a game asking for 8 GB is refused on a 16 GB PC, correctly. Raise it
in **Docker Desktop → Settings → Resources → Memory** and restart the engine;
the next heartbeat carries the new figure.

If the refusal is about the operating system or the architecture instead, the
wizard says so on the node before the last step: every game in the catalog runs
from a Linux image, and a node in Windows containers mode reports `windows` and
can run none of them.

### The node has no free port block

Each game is given a block of ports on the node, from its own base. The message
names the game and the range. Another server of that game already has the
block, or something else on the machine holds a port in it — a second Minecraft
on 25565 that Geeboard did not create, for example. Free it, or place the server
on another node.

## Windows, Docker and Git Bash

### A `docker run` with a path fails strangely on Git Bash

Git Bash rewrites anything that looks like a Unix path into a Windows one
before the command ever reaches Docker, so `-v /var/lib/geeboard:/data` becomes
`-v C:/Program Files/Git/var/lib/geeboard:/data` and the container mounts
somewhere nobody meant. Prefix the command:

```bash
MSYS_NO_PATHCONV=1 docker run -v /var/lib/geeboard:/data ...
```

PowerShell does not do this. The install command the panel hands you is written
for the shell it names.

### Stopping a task leaves node processes running

On Windows, ending a terminal or a background job does not end the processes it
started. An agent or a poller that seems to be running old code usually is:
find the tree and end it.

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Select-Object ProcessId, CommandLine
```

## Running the checks

`npm run verify` and everything under it create and drop data. Point them at a
database of their own, on every command, and check which directory you are in
before you press enter:

```bash
cd web
DATABASE_URL=postgresql://geeboard:geeboard@localhost:5432/geeboard_verify npm run verify
```

A `verify` run in the wrong place has emptied a working installation once. The
scripts do not ask.
