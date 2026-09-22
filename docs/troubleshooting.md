# When it will not start

Everything here has actually happened on a machine, most of them on the Windows
PC this is developed on. Each entry is what you see, then why, then what to do.

[Install Geeboard](production.md#troubleshooting) has the ones the installer
itself reports, and says what it does about them. This page is the rest.

## Installing

### `bash: ./deploy/linux/install-panel.sh: Permission denied`

The checkout has no execute bit on its scripts — a copy over `scp`, an
unpacked zip, a restore from a backup, or a file system that does not carry the
bit at all. That is why every command in the documentation runs the installers
through `bash`:

```bash
sudo bash deploy/linux/install-panel.sh
```

which needs no execute bit at all. The installer repairs the rest of the
scripts itself, to `0755`. Nothing in Geeboard needs `chmod 777`, and a file
system that refuses `0755` refuses that too.

### `bad interpreter: No such file or directory`, on a file that is right there

Windows line endings. A checkout made on Windows with `core.autocrlf` on turns
every text file's line endings into CRLF, and a shell script whose first line
ends in a carriage return fails naming an interpreter that does exist —
`/usr/bin/env bash^M`. `.gitattributes` keeps `*.sh` at LF for a checkout, and
the installers repair any that arrive with it anyway. For one file by hand:

```bash
sed -i 's/\r$//' deploy/linux/install-panel.sh
```

### The installer could not install Caddy

It uses the distribution's own packages, and only Debian-like and RHEL-like
ones. On anything else, install Caddy yourself and run the installer again, or
run it with `--no-caddy` and put your own reverse proxy in front of the panel —
[Advanced installation](advanced-install.md#nginx) has an nginx server block
that does everything the panel needs.

### It says port 3000 is taken, and uses another

Something else on the machine is already listening there. The installer moves
the panel to the next free port and writes it to `PANEL_BIND`, and the
Caddyfile it writes points at whichever port it chose. Nothing to do — the
panel's port is on the loopback address and is never what a browser uses.

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

### `prisma` cannot load its config file

```
Failed to load config file "…/web" as a TypeScript/JavaScript module.
Error: PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL.
```

Every Prisma command reads `prisma.config.ts`, which reads `DATABASE_URL` —
including `prisma generate`, which does not otherwise touch the database. On a
fresh clone there is no `.env` yet, so run `npm run setup:env` first, which is
why it comes before `npm run db:migrate` in the commands on the
[home page](index.md). For one command, naming it inline is enough:

```bash
DATABASE_URL=postgresql://geeboard:geeboard@localhost:5432/geeboard npx prisma generate
```

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
address it tried, and why it did not get there.

### Registering fails on the certificate

```
Registering with the panel failed: the certificate https://203.0.113.10 presented
is signed by a certificate authority this machine does not trust
(UNABLE_TO_VERIFY_LEAF_SIGNATURE) …
```

The panel is behind Caddy's `tls internal`, whose certificate authority is
private to that machine, and the agent trusts the public ones. The command the
panel writes already carries `--panel-ca auto` — it adds that whenever its own
address is an address rather than a name — so this error means the authority
was not found on the machine the command ran on. On the panel's own machine
that means Caddy has not written it yet: it does so the first time it serves
https, so open the panel once. On another machine, copy
`/etc/geeboard/panel-ca.crt` over and pass `--panel-ca <that file>`; the
installer says exactly that before it gets this far. It is added to the
authorities the agent already trusts, and nothing is turned off.
[installation.md](installation.md#a-panel-behind-a-private-certificate-authority)
has the whole of it; `NODE_TLS_REJECT_UNAUTHORIZED=0` is not the answer.

Other reasons the same request can fail now say which they are:
`nothing is listening at …` (`ECONNREFUSED`), `… does not resolve from this
machine` (`ENOTFOUND`), `the certificate … has expired`, `… did not answer
within 10 seconds`.

### The node appears, then goes unreachable

Now it is the other direction: the panel has to reach the agent, on the address
the node advertised (port 8080 by default). The agent works out its own address
at registration from its route to the panel, and that is wrong wherever the
panel reaches the machine at some other address — behind NAT, or on a machine
with several interfaces, a VPN, or Docker Desktop's virtual adapters. Rejoin
with `--advertise http://<address the panel can use>:8080`.

A firewall is the other half of it: the panel's machine has to be allowed in on
that port. If the node **is** the panel's machine and `ufw` is on, the panel's
containers need a rule —
`sudo ufw allow from 172.16.0.0/12 to any port 8080 proto tcp`. Never open it
to the internet.

The agent prints this fault itself, because the panel tells it on a heartbeat:

```
the panel cannot reach this node  advertised=http://203.0.113.10:8080  detail=…
```

[installation.md](installation.md#when-the-panel-cannot-reach-the-node) is the
order to check things in.

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
