# Install Geeboard

Three commands on a machine with Docker, and a panel you can sign in to over
https:

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git
cd Geeboard
sudo bash deploy/linux/install-panel.sh
```

The installer asks two questions — whether you have a domain name, and who the
first owner is — and does the rest itself: the secrets, the configuration file,
the certificate, the reverse proxy, the containers, the database and the first
account. You do not open `.env`, `docker-compose.yml` or the `Caddyfile`, and
nothing below asks you to run `chmod`.

If you would rather do each step by hand, every one of them is still there:
[Advanced and manual installation](advanced-install.md).

## What the panel is

The **panel** is Geeboard itself: the web interface, its database, and a poller
that watches everything and runs what is scheduled. It is what you sign in to.
It runs game servers on other machines and hosts none itself — although the
machine it is installed on can also be one of those machines.

One panel per installation. It wants about 2 GB of memory and a few gigabytes
of disk, which is the smallest VPS most hosts sell.

## What a node is

A **node** is a machine that actually runs game servers: a VPS you already
have, a PC in the corner, or the panel's own machine. Each one runs a small
**agent** that takes orders from the panel and drives Docker on that machine.

```
your machine  →  runs the agent  →  registered as a node  →  hosts game servers
```

Geeboard never buys, creates or resizes a machine. You bring the machines; the
panel keeps track of them. A node needs Docker, and whatever memory and disk
its game servers need on top.

## Choose your setup

The one decision to make before you start, because it decides how the panel
gets its certificate. **https is not optional**: the panel's session cookies
are `Secure`, so a panel reached over plain `http://` cannot sign anybody in at
all.

| | **A domain name** | **An address only** |
| --- | --- | --- |
| The panel is at | `https://panel.example.com` | `https://203.0.113.10` |
| The certificate comes from | Let's Encrypt, free, renewed automatically | Caddy on your own machine |
| Browsers | trust it, with no warning | warn once, and you accept it |
| Node agents | trust it | are given the authority, which the installer arranges |
| You need | a DNS A record pointing at the machine, and ports 80 and 443 open | ports 80 and 443 open |

A domain is the better answer whenever you have one: one fewer thing to explain
to every node, and a certificate everybody already trusts. A subdomain of a
domain you already own is enough — `panel.example.com`, pointed at the
machine's address.

Without one, the installer uses Caddy's **internal certificate authority**. The
connection is encrypted and checked exactly as any other; what is different is
that no other machine knows the authority that signed it yet. Your browser asks
you once. A node agent is given the authority itself, and on the panel's own
machine the node installer finds it without being told.

## Install the panel

On a machine with Docker — Ubuntu and Debian are what this is tested on:

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git
cd Geeboard
sudo bash deploy/linux/install-panel.sh
```

No Docker on it yet? One command, from Docker's own installer:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

The installer prints what it is doing, a stage at a time:

```text
[1/8] Checking the system
[✓] Ubuntu 26.04 LTS
[✓] Docker is running
[✓] Docker Compose is available

[2/8] Detecting the network
[✓] Public IP: 203.0.113.10

[3/8] Configuring HTTPS
Do you have a domain name pointing at this machine? [y/N]:
[✓] IP-based HTTPS selected: https://203.0.113.10

[4/8] Preparing Geeboard
[✓] Permissions fixed on 4 scripts
[✓] Secrets generated, in /root/Geeboard/deploy/panel/.env
[✓] PANEL_URL: https://203.0.113.10

[5/8] Starting the services
[✓] Database healthy
[✓] Panel healthy

[6/8] Configuring Caddy
[✓] HTTPS active: /etc/caddy/Caddyfile
[✓] Certificate authority ready for nodes: /etc/geeboard/panel-ca.crt

[7/8] The first owner
[✓] Owner created: Your Name <you@example.com>

[8/8] Checking it works
[✓] HTTPS answering on https://203.0.113.10

Geeboard is ready.

Panel:
  https://203.0.113.10
```

When something is wrong it says so in sentences, and stops before it can make
it worse:

```text
[!] Docker is not running.

Geeboard cannot start anything until Docker is running.

Start it, then run this again:

  sudo systemctl start docker
```

### What it does, and what it will never do

It generates the database password and the two keys the panel needs, writes
them to `deploy/panel/.env` readable by root alone, and **prints none of them**.
It writes `/etc/caddy/Caddyfile`, starts the containers, applies the database
schema, and checks that the finished address answers from outside.

Run it again to upgrade or to repair. A second run:

- **never regenerates a secret that is already there.** `SECRETS_KEY` is what
  every stored node token is encrypted under, and `POSTGRES_PASSWORD` is read
  by the database only when its storage is first made. Refreshing either on a
  running installation would lock the panel out of its own data.
- **never removes a volume, a game server or a backup.** Nothing it does is
  destructive; the worst it does is replace a file it wrote itself, keeping a
  copy of what was there.
- keeps a `Caddyfile` you have edited. Take the `# geeboard-managed` line off
  the top and the installer leaves the file alone and prints what it would
  have written.

**Back up `deploy/panel/.env` with the database.** A database dump without
`SECRETS_KEY` is a panel that cannot reach any of its nodes.

### The first owner

Whoever installs the panel is its administrator, and the installer makes that
one account. It prints a **temporary password**, once:

```
  Your Name <you@example.com> is the owner of this installation.

  Temporary password:   kTq7m-Xw3pR-9hZcN-bL4vE

  It is shown this once and is not stored anywhere it can be read back.
  It works until 2026-09-23 18:40 UTC — a day.
```

It is random, stored only as a hash, never written to a file or a log, and good
for 24 hours. Sign in with it and the panel shows you one page until, in this
order, you have **replaced it with a password of your own** and **set up
two-factor sign-in**. Owners and admins must have the second; it is not offered
before the first, because a second factor set up behind a password somebody
else may have seen is not yours.

Everybody else is added from **Members**, by you, where it is audited under your
name. Running the owner setup a second time refuses: it makes the first owner
and is not a way to make a second.

There is no first-run page in the browser that does any of this. On a VPS the
first visitor to a new port is as often a scanner as the installer, and a form
that makes an owner for whoever arrives first hands them the panel.

## Add a Linux node

A node is any machine with Docker on it — including the panel's own.

**In the panel:** **Nodes → Add a node**. Give it a name (`fra-node-01`), tick
what the machine should be willing to run, and press **Create the command**.
The panel writes the command, with a single-use token in it.

**On the machine**, in a checkout of Geeboard:

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git
cd Geeboard
sudo bash deploy/linux/install.sh 'https://panel.example.com' 'gbn_…'
```

That is the command the panel gives you, with the address and token filled in.
It checks Docker, repairs the scripts' permissions, gets the agent image for
this release, registers the machine, installs `geeboard-agent.service` so the
agent starts at boot, and then checks two different things: that the agent is
answering here, and that **the panel could call this machine back**.

A panel with an internal certificate authority needs nothing extra on its own
machine — the installer sees that the panel is local, finds the authority and
says so. For a node somewhere else, copy the file over and name it:

```bash
sudo cat /etc/geeboard/panel-ca.crt        # on the panel's machine
# on the node, saved as /root/panel-ca.crt, then:
sudo bash deploy/linux/install.sh 'https://203.0.113.10' 'gbn_…' --panel-ca /root/panel-ca.crt
```

**Approve it.** A node that has registered is `PENDING` and takes nothing until
an admin approves it, which the dialog offers as soon as the machine appears.
That is the security of the flow: a registration token that leaks must not
become a machine in your fleet by waiting.

Afterwards:

```bash
journalctl -u geeboard-agent -f          # watch it
sudo bash deploy/linux/install.sh        # upgrade, after a git pull
sudo bash deploy/linux/uninstall.sh      # remove it, leaving servers and settings
```

### The firewall

The agent listens on **8080**, on every address the machine has, and its token
is the only thing between that port and every container on the machine. On a
VPS with no firewall it is on the internet the moment it starts. Close it to
everybody but the panel:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp                                       # the panel, through Caddy
sudo ufw allow from 172.16.0.0/12 to any port 8080 proto tcp    # a node on the panel's own machine
sudo ufw enable
```

The `172.16.0.0/12` rule is for the case where the node **is** the panel's
machine: the panel calls out from inside a container, from one of Docker's
bridge networks, and that range covers them. For a node somewhere else, allow
the panel's address instead:

```bash
sudo ufw allow from <the panel's address> to any port 8080 proto tcp
```

Two things this does not do, and both matter:

- **It does not close a game server's port.** Docker publishes those through
  rules of its own, below ufw, so a world on 7777 is reachable whatever ufw
  says. That is what you want for players; it is also why ufw is not the thing
  keeping a game server private.
- **It works on 8080 only because the agent runs with the host's network.** The
  panel's own port is on `127.0.0.1` and never exposed either way; Caddy in
  front of it is what the internet sees.

## Add a Windows node

A Windows PC works as a node through Docker Desktop. It needs Docker Desktop,
[Node.js](https://nodejs.org) 24, and a checkout — and it has to stay signed in,
because Docker Desktop runs in the signed-in user's session and so does the
agent.

**In the panel:** **Nodes → Add a node**, the same as for Linux, then the
**PowerShell** tab of the command it writes.

**On the PC**, in PowerShell, in the checkout:

```powershell
git clone https://github.com/DanieleMarino70/Geeboard.git
cd Geeboard
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel 'https://panel.example.com' -Token 'gbn_…'
```

`-ExecutionPolicy Bypass` is in that line because a fresh Windows install
refuses to run any PowerShell script at all. It applies to that one command and
changes nothing on the machine.

The installer checks Node.js, npm and Docker Desktop, unblocks the scripts
Windows has marked as downloaded from the internet, installs the agent's
dependencies, joins the panel, registers the **Geeboard Agent** task so the
agent starts at every sign-in, and checks that it is answering. Then approve the
node in the panel, as above.

```powershell
Get-ScheduledTask 'Geeboard Agent' | Get-ScheduledTaskInfo   # last run and result
.\deploy\windows\uninstall-agent.ps1                         # remove it
```

A machine that must host servers with nobody signed in is a Linux machine.

## Create your first server

With one approved node, in the panel: **Servers → Create a server**. Pick a
game, a version, how much memory and CPU it may have, and the node to put it on
— the wizard says which nodes can run it and why, before the last step.

Geeboard pulls the game's image on the node, makes the server's directory,
writes its settings and starts it. The **Console** tab is live; **Files** is
the server's own directory; **Backups** takes and restores copies of the world.
[Game servers](servers.md) is the whole of it, and [Games](games.md) is what is
on offer.

## Troubleshooting

### Docker is not running

```text
[!] Docker is not running.
```

`sudo systemctl start docker`, then run the installer again. On a machine where
Docker has just been installed, the account you are in may not be in the
`docker` group yet — which is why every command here says `sudo`.

### The installer says a file could not be made executable

It repairs the scripts it can and names the ones it cannot, with the exact
command for each:

```text
[!] Some files could not be repaired, and have to be made executable by hand:
    chmod 0755 /root/Geeboard/deploy/linux/install.sh
```

A file system mounted `noexec`, or read-only, is the usual reason. Nothing here
ever needs `chmod 777`, and a file system that will not take `0755` will not
take that either.

### The panel's address does not answer

The installer says so at the last stage rather than reporting success. In
order:

1. `sudo systemctl status caddy` — is the proxy running?
2. `sudo journalctl -u caddy -n 50` — with a domain, a certificate that could
   not be issued says why here. Almost always: the DNS record does not point at
   this machine yet, or ports 80 and 443 are not open.
3. `sudo docker compose -f deploy/panel/docker-compose.yml logs panel` — the
   panel checks its configuration before it serves anything and exits naming
   what is wrong, rather than starting half-configured.

### The browser warns about the certificate

Expected, on an installation with no domain name: the certificate is signed by
Caddy's authority on your own machine, which your browser has never heard of.
Accept it once. A domain name is what makes the warning go away for everybody.

### Registering a node fails on the certificate

```
Registering with the panel failed: the certificate https://203.0.113.10 presented
is signed by a certificate authority this machine does not trust
(UNABLE_TO_VERIFY_LEAF_SIGNATURE) …
```

The node has not been given the panel's authority. On the panel's own machine
the installer finds it by itself; elsewhere, copy `/etc/geeboard/panel-ca.crt`
over and pass `--panel-ca <that file>`. It is **added** to the authorities the
agent already trusts, and nothing is turned off —
`NODE_TLS_REJECT_UNAUTHORIZED=0` is the other way to make the error go away and
it is the wrong one.

### The node stays pending

That is the flow, not a fault: somebody approves it in **Nodes**. Until then it
runs nothing.

### The panel cannot reach the node

The node registered, it heartbeats, and the panel still will not place a server
on it. Registering proves the node can reach the panel; this is the other
direction, and neither implies the other. The agent says so itself, in its log:

```
the panel cannot reach this node  advertised=http://203.0.113.10:8080  detail=…
```

Usually a firewall between the two, or an address the panel cannot route to —
a machine behind NAT advertises the address it sees itself at, which is not the
one the panel needs. Rejoin with `--advertise http://<an address the panel can
use>:8080`, or open 8080 to the panel.
[A node's own page](installation.md#when-the-panel-cannot-reach-the-node) has
the order to check things in.

### Locked out of the owner account

Lost the temporary password, let its day run out, forgot your own, or lost the
phone *and* the recovery codes. On the panel's machine:

```bash
sudo docker compose -f deploy/panel/docker-compose.yml run --rm panel recover --yes
```

It gives an owner a new temporary password, shown once, removes two-factor from
the account, ends every session it has, and writes `installation.owner.recovered`
to the audit log — so a recovery nobody expected is something the other owners
can see. Being able to run it is the proof of being the administrator: whoever
can run a command as the panel against its database already has everything the
panel protects. There is deliberately no web equivalent.

[More things that have actually happened](troubleshooting.md), on the panel and
on nodes.

## Advanced and manual installation

Everything the installer does, as the commands it runs, is in
[Advanced and manual installation](advanced-install.md): the environment file
and what is in it, Compose by hand, Caddy by hand, an nginx server block, the
systemd units that run the panel without Docker, and attaching a node without
the installer. Nothing there is deprecated, and the installer is not a
different installation — it is those commands, in order, with the answers filled
in.

## Afterwards

- **Add more nodes**: **Nodes → Add a node**, and [Nodes](nodes.md) for what a
  node carries and how placement uses it
- **Back up Postgres and `deploy/panel/.env` together** —
  [Upgrade](upgrading.md#backing-up-the-panel). Geeboard's own backups copy each
  game server's world; nothing in it copies the panel's database
- **One instance.** Sign-in limits, two-factor limits and the API's rate limit
  are counted in the panel's process, and there must be exactly one poller —
  [Security](security.md#one-instance-and-what-changes-with-more)
- **Upgrading** to a later release: [Upgrade](upgrading.md)
