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

**If you changed `SECRETS_KEY` and now nothing the panel stored can be read** — the
panel and the poller each say at start, in one line, `N stored secrets do not open
with SECRETS_KEY (node tokens: 2, two-factor secrets: 1)`; the poller names each node
whose token is among them (`a node's token cannot be opened, so the panel cannot reach
it`) and treats it as not reached, so it goes unreachable after two minutes and the
Nodes page says why, while the other nodes, the scheduled backups and the
notifications go on; the DNS page says its token cannot be decrypted; an action on
such a node says `SECRETS_KEY is not the key these secrets were sealed with`, and a
two-factor sign-in is an error page — the key was edited, not rotated. Put the old value back, and run
`rekey` with the new one as `SECRETS_KEY_NEW`, as
[security.md](security.md#changing-secrets_key) says; the edit comes last. If the old
value is gone, what was sealed with it cannot be opened: register the nodes again and
set the rest up again.

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

It is good for a day, once. The sign-in page says so, and shows the command, spelled for
the way your panel is installed. From a terminal on the panel's own machine:

```bash
# An installation made by deploy/linux/install-panel.sh (Docker): from the folder you
# installed from, the one that has deploy/panel/docker-compose.yml. Add sudo if Docker needs it.
docker compose -f deploy/panel/docker-compose.yml run --rm panel recover --email owner@example.com

# A development checkout, without Docker:
cd web
npm run admin:recover -- --email owner@example.com
```

It asks you to type `recover` (`--yes` goes on without asking, for a script). That makes a
new temporary password, shows it once, removes two-factor from the
account, ends its sessions, and writes `installation.owner.recovered` to the
audit log so the other owners can see a recovery nobody expected. The same
command is the way back from a lost phone with the recovery codes also gone.
`--email` is only needed when the panel has more than one owner.

Being able to run it is the proof of being the administrator: whoever can run a
command as the panel against its database already has everything the panel
protects. There is deliberately no web equivalent.

### The sign-in page says "This panel has no owner yet"

Nobody has made the first owner. The installer does it when you give it a name and an
address (`--owner-email`, `--owner-name`); without them it says so and prints the command.
It is a command on the machine, and not a page, because on a new server the first visitor to
a new port is as often a scanner as you:

```bash
docker compose -f deploy/panel/docker-compose.yml run --rm panel setup --email you@example.com --name "Your Name"
```

It prints a temporary password, once. [The next section](#the-temporary-password-has-run-out)
is what to do when that has run out.

### A two-factor code will not match

- **The time on the phone.** A code is worked out from the time, in steps of thirty seconds, and the panel
  accepts the one before and the one after. A phone that is a minute off, because its clock is set by
  hand, never matches. Turn on automatic date and time on the phone, and try the next code.
- **A code works once.** The same six digits twice within thirty seconds is refused the second time.
- **How you type it does not matter.** `123 456`, the way the app shows it, is the same as `123456`.
- **Five tries in five minutes.** After that the panel waits, and the wait is five minutes; it is a limit on
  guessing and not a fault.
- **A recovery code** is ten letters and digits, shown as `xxxxx-xxxxx`. Capitals, the hyphen and a space
  are all the same code, and each works once. The same field takes it: the keyboard on a phone is the one
  with letters.
- **Neither works.** An owner's way back is the recovery command in [the section above](#the-temporary-password-has-run-out),
  which removes two-factor from the account; for anybody else, an owner or admin resets the password from
  Members.

### "Your session ended"

The sign-in page says this when you arrive with a session that is no longer one: it ran its two weeks, you
or an admin ended it from another device, or an admin reset your password. Sign in again and you are taken
back to the page you were on; what was unsaved on it was not kept.

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
address it tried, and why it did not get there (on Windows, in `agent.log` beside
`agent.json`; on Linux, `journalctl -u geeboard-agent`).

### Registering fails on the certificate

```
Registering with the panel failed: the certificate https://203.0.113.10 presented
is signed by a certificate authority this machine does not trust
(UNABLE_TO_VERIFY_LEAF_SIGNATURE) …
```

The panel is behind Caddy's `tls internal`, whose certificate authority is
private to that machine, and the agent trusts the public ones. The command the
panel writes carries the authority's fingerprint — `--panel-ca 'sha256:…'`, `-PanelCa
'sha256:…'` on Windows — whenever its own address is an address rather than a name,
and the node fetches the authority from the panel and keeps it if it matches. So this
error means the command had no fingerprint: it was made by a panel that does not know
its own authority yet (run `sudo bash deploy/linux/install-panel.sh` once more on the
panel's machine, open Nodes → Add a node, and use the new command), or typed by hand.
On the panel's own machine it can also mean Caddy has not written the authority yet: it
does so the first time it serves https, so open the panel once. A message that says the
authority **is not the one the command names** is another thing: do not go on, make a
new command (the panel's authority changed, or this is not the panel the command was
written for). Copying `/etc/geeboard/panel-ca.crt` over and passing `--panel-ca <that
file>` still works. It is added to the authorities the agent already trusts, and
nothing is turned off.
[installation.md](installation.md#a-panel-behind-a-private-certificate-authority)
has the whole of it; `NODE_TLS_REJECT_UNAUTHORIZED=0` is not the answer.

Other reasons the same request can fail now say which they are:
`nothing is listening at …` (`ECONNREFUSED`), `… does not resolve from this
machine` (`ENOTFOUND`), `the certificate … has expired`, `… did not answer
within 10 seconds`.

### The node appears, then goes unreachable

The node's page says **why**, in the words the network gave, with the node and the address:
`fra-node-02 refused the connection at http://203.0.113.10:8080: the agent is not running there, or
that is not its port` (the agent is stopped, or the port is wrong); `fra-node-02 did not answer within
10 seconds (http://203.0.113.10:8080). A firewall, or a machine that is off, looks like this`; `The name in
fra-node-02's address does not resolve (agent.example.test) (ENOTFOUND)`; `fra-node-02 presented a certificate
this panel does not trust` (or one that has expired or is not valid yet, with this panel's clock in the
sentence, since a wrong clock is the usual cause); `fra-node-02 answered at http://…:8080, but not like a
Geeboard agent` (another program has that port). It used to say `fra-node-02 is timed out` for all of them.

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
{"at":"2026-10-07T09:12:03.482Z","level":"warn","component":"agent","node":"fra-node-02","msg":"the panel cannot reach this node","advertised":"http://203.0.113.10:8080","detail":"… timed out","fix":"open that address to the panel, or join again with --advertise <address the panel can use>"}
```

That is what `journalctl -u geeboard-agent` shows; at a terminal the agent prints the readable form of the same
line (`warn  agent the panel cannot reach this node advertised=… detail=…`).

[installation.md](installation.md#when-the-panel-cannot-reach-the-node) is the
order to check things in.

Inside Docker Desktop on Windows, `host.docker.internal` is not something the
Windows host itself resolves reliably: it works from inside a container and not
always from outside one. Where an agent in a container and an agent on the host
have to name the same machine — a shared bucket, for instance — use the LAN
address of the PC rather than that name.

### The agent will not start: "already in use"

```
0.0.0.0:8080 is already in use. Most likely an agent is already running on this machine; …
```

Something is listening on the agent's port, most often an agent that is already
running — a second `join` that started it by hand while the service has it, or
the service itself under another name. The agent exits with code 78, and the
service unit does **not** restart on that code: starting again would fail the
same way every five seconds for as long as nobody looked. Find the holder
(`sudo ss -ltnp 'sport = :8080'`), stop it, then `sudo systemctl start
geeboard-agent`; or give this one another port with `GEEBOARD_DAEMON_PORT` in
`/etc/geeboard/agent.env` (and rejoin with `--advertise` naming the new port).
A unit installed before 0.9.0 does not have the rule: `sudo bash
deploy/linux/install.sh` puts it there.

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

That is the panel's own check, made before anything is sent. A port that **looks free to the
panel and is not** — a program on the node that is not a game server of this panel — is found by Docker
when the container starts, and the agent says it as what it is: `Port 25565 is already in use on
fra-node-02 by something that is not this server. Free it, or create the server on another node.`
(`ss -ltnp 'sport = :25565'` on the node names the holder; on Windows,
`netstat -ano | findstr :25565`.) Docker's own text, with its `driver failed programming external
connectivity`, is in the agent's log.

### "fra-node-02 refused the panel's token (401)"

The token the panel holds for the node and the one saved on that machine no longer match: after a join
again from another process, a database restored from an older backup, or a `SECRETS_KEY` that no longer
opens what was stored. Every action on that node says this sentence (it used to say `unauthorized`, which
read like an outage). Rotate the token from the node's page if the node still answers, or join the node
again with a new token. The agent says the same on its side, once, with what to do — `the panel does not
accept this agent` — and then asks again only every five minutes, where it used to print a line every
fifteen seconds for ever; the panel logs the reason a heartbeat was refused (`unknown node`, `token
unreadable`, `token mismatch`), once in ten minutes for each node.

### "Something went wrong on our side (reference …)"

An error the panel did not foresee. The reference is in the panel's log, with the cause and the first lines
of its stack, and nowhere else is the cause shown: `docker compose logs panel poller | grep a1b2c3d4e5f6`
(or `journalctl` for a panel run by systemd) finds `unexpected error` with the reference, the thing that was
being done (`backup of aurora`), the kind of error and where it came from. The reference is the id of the
request where there was one, so every line of that request carries it, and the node agent's lines for the
same request carry it too (`x-request-id`). `LOG_LEVEL=debug` in `deploy/panel/.env` adds every call the panel
makes to a node, for the hour somebody works out what was asked and when. The audit log's line for a failed
operation holds the same sentence, reference and all.

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
started. An agent or a poller that seems to be running old code usually is: find the tree
and end it.

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Select-Object ProcessId, CommandLine
```

For the node agent the installer does this for you, and only for this node's agent:
`install-node.ps1` and `uninstall-agent.ps1` stop the task, its wrapper and the agent
listening on this node's port, and say what they stopped. If it says that something
**else** holds the port — a program that is not an agent — it names it and stops, and does
not kill it; it is not Geeboard's to end.

### The Windows agent's log

```powershell
Get-Content -LiteralPath "$env:LOCALAPPDATA\Geeboard\agent.log" -Wait -Tail 50
```

Beside `agent.json`, UTC, with a line from the wrapper each time the agent starts and each
time it stops, and its exit code. **An exit code 78** is the agent saying that another agent
holds its port; the wrapper stops there. Anything else it restarts, with a longer wait each
time it dies at once. [installation.md](installation.md#a-node) has the rest.

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
