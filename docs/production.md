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
[1/9] Checking the system
[✓] Ubuntu 26.04 LTS
[✓] Docker is running
[✓] Docker Compose is available
[✓] Docker 29.8.2, Compose 2.40.3
[·] Memory: 3401 MB available, 0 MB of swap
[·] Disk: 38 GB free under /var/lib/docker
[·] Architecture: x86_64
[·] Port 80, 443: nothing is listening on them
[·] no firewall on this machine that this could see

[2/9] Detecting the network
[✓] Public IP: 203.0.113.10

[3/9] Configuring HTTPS
Do you have a domain name pointing at this machine? [y/N]:
[✓] IP-based HTTPS selected: https://203.0.113.10

[4/9] Preparing Geeboard
[✓] Permissions fixed on 4 scripts
[✓] Secrets generated, in /root/Geeboard/deploy/panel/.env
[✓] PANEL_URL: https://203.0.113.10

[5/9] Starting the services
[✓] Database healthy
[✓] Panel healthy

[6/9] Configuring Caddy
[✓] HTTPS active: /etc/caddy/Caddyfile
[✓] Certificate authority ready for nodes: /etc/geeboard/panel-ca.crt

[7/9] The first owner
[✓] Owner created: Your Name <you@example.com>

[8/9] Checking it works
[✓] HTTPS answers, asked from this machine, at https://203.0.113.10
[·] That was asked from this machine. It says nothing about the firewall between here and the rest of the world.
    From another machine, open https://203.0.113.10. If it does not answer, that is the first place to look.

[9/9] This machine as a node
Run game servers on this machine too? [y/N]: y
Node name, as the panel will show it [vps-01]:
[✓] Token minted; it works once, for this name
[·] Handing over to deploy/linux/install.sh, which prints its own stages:
…
[✓] This machine is registered as vps-01 and waits for your approval

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
schema, and checks that the finished address answers. **From this machine**: where
a provider binds the public address on the network card (OVH, Hetzner, DigitalOcean)
the request does not leave the machine, so the check passes whatever a firewall does
to everyone else. The last words of stage 8 say so, name the firewall it found (ufw,
firewalld, an iptables policy that drops) with the command that opens 80 and 443,
say when the machine is behind NAT, and ask you to open the address from another
machine. A cloud provider's own firewall (a security group, "network rules") is
outside the machine and is the first place to look when it does not open.

What it prints is also written, without its colours, to
`/var/log/geeboard-install.log` (root only, appended to). A session that drops
mid-install — the build alone is minutes — leaves that to read; run long installs in
`tmux`. Its temporary files live in a directory of its own that is removed however the
run ends.

`--check` does the first stage and stops: Docker and Compose and their flavour,
whether Docker starts at boot, memory and swap, disk, architecture, the clock,
SELinux, ports 80 and 443 and who holds them, and the firewall. It changes nothing and
exits 1 when something is worth a word. `deploy/linux/install.sh --check` is the
same for a node (port 8080 instead).

What it refuses, before it has changed anything: **Docker from a snap** (it resolves
the data folder of every game server in a namespace of its own), **Compose v1** (the
file uses a feature v1 does not have), and a port 80 or 443 that something else holds
(it names the program). A Docker that is Podman's, SELinux enforcing, a clock that is not
synchronised and less than 1.5 GB of free memory are warnings.

Run it again to upgrade or to repair. A second run:

- **never regenerates a secret that is already there.** `SECRETS_KEY` is what
  every stored node token is encrypted under, and `POSTGRES_PASSWORD` is read
  by the database only when its storage is first made. Refreshing either on a
  running installation would lock the panel out of its own data. To change
  `SECRETS_KEY` on purpose, use `rekey` ([security.md](security.md#changing-secrets_key)):
  it seals everything again under a new key in one transaction and the nodes need
  nothing.
- **never removes a volume, a game server or a backup.** Nothing it does is
  destructive; the worst it does is replace a file it wrote itself, keeping a
  copy of what was there.
- **upgrades with a way back.** On a panel that is already running it looks at
  what is in flight, stops the panel and the poller, dumps the database into
  `/var/backups/geeboard/` (readable by root only) and reads the dump back,
  applies the migrations, starts the panel again, and prints the commands that
  undo it. A migration that fails leaves the panel stopped and says so. What
  each step does, and what to do when it goes wrong, is
  [Upgrading](upgrading.md); `--no-backup`, `--backup-dir` and `--force`
  are in `--help`.
- **keeps a `Caddyfile` that is somebody's.** It writes over a Caddyfile only when it is
  empty, has the `# geeboard-managed` line at the top, or is the placeholder the Debian
  and Fedora packages install, untouched. A site that serves files, runs PHP, redirects,
  proxies or imports other files is left alone, and the installer prints the site block
  to add (before 0.9.0 anything without a `reverse_proxy` line was replaced, and a static
  site on the same Caddy lost its configuration at the reload; a copy was kept, and the
  site was down until somebody noticed). A Caddy that is not running after the
  configuration is written is an error with its own last log lines, not "HTTPS active".
- **keeps the way the panel is served.** A panel on a domain stays on its domain, with
  its Let's Encrypt block, and one on an address stays on its address; the mode and the
  email are recorded in `deploy/panel/.env` as `PANEL_TLS_MODE` and `ACME_EMAIL`
  (a panel installed before 0.9.0 is recognised from its Caddyfile). Before, a bare re-run
  or `--yes` took the default answer to "do you have a domain?", which is no, and wrote
  `tls internal` over a Let's Encrypt site: every remote node then failed to verify the
  certificate and the installer's own check, which only asks whether the address answers,
  passed. `--domain`, `--ip` and `--panel-url` still say otherwise.
- **upgrades the agent on this machine,** when there is one (`/etc/geeboard/agent.json`),
  and says the version it was and the version it is, and the contract it speaks.
  `--no-node` leaves it alone.
- **checks the name's records, both families.** For a domain it reads the A and the AAAA
  record. Let's Encrypt tries IPv6 first when there is an AAAA, so one that points at
  some other server fails the validation while the A record is right; it says so, with
  the address this machine does hold, and it does not say "resolves to this machine"
  when it has no public address to compare. **An IPv6 address works for `--ip`:** it is
  bracketed once, and `PANEL_URL` is `https://[2001:db8::1]`.
- **stops when `deploy/panel/.env` is gone and the database is not.** A new `.env`
  would hold a database password that database does not have and a `SECRETS_KEY` no
  stored node token can be read with. It says so and changes nothing; restore the file
  from your backup, or remove the old database with `down -v` to start over.
- **asks before it registers this machine under a name that is already a node** (the same
  machine rebuilt, or another one by mistake: registering replaces the node's agent and
  keeps its approval). Under `--yes` it refuses.
- **ends with words that fit what it did:** *installed* gets the three first steps,
  *upgraded* says from which version to which and that accounts, nodes and servers are
  as they were, and a re-run of the same release says so. It warns when the checkout is
  not at a release tag, because the installer and the docs may then be newer than the
  image it pulls.

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

## The panel's own machine as a node

The common case at home is one machine: the panel and the game servers on it.
The installer's last question is that one — **Run game servers on this machine
too?** — and a yes does the whole of the next section for this machine, with
nothing to paste: it offers the hostname as the node's name (made to fit the
panel's rule; type another if you like), mints the registration token through
the panel's own `node-token` verb, and runs `deploy/linux/install.sh` with it,
so the agent is installed beside the panel and registers with it at once. The
node lands as `PENDING`, like every node: **Nodes** shows it waiting, and
approving it is the one click left.

On the command line the question is `--node` or `--no-node`, and `--node-name`
gives the name; with `--yes` and no answer it is *no*, because a scripted
installation must not gain an agent nobody asked for. Running the installer
again on a machine that is already a node does not register it again — it
finds `/etc/geeboard/agent.json`, and upgrades the agent instead, as
`install.sh` with no arguments does. The agent is told to advertise this
machine's LAN address rather than loopback, because the panel calls it from
inside a container, where loopback is the container's own; the firewall line
for that is under [The firewall](#the-firewall). `--terminal` on the same
command allows the panel a shell on this node — see
[nodes.md](nodes.md#node-terminal). Proved on a clean Ubuntu 26.04 VPS with
two cores: a first run with `--node` registered the machine and the panel
reached it; a second run found it already a node and upgraded the agent; a
Terraria server was created on it from the panel; `--no-node` and a bare
`--yes` left the machine a panel only.

## Add a Linux node

A node is any machine with Docker on it — including the panel's own, which the
installer offers to make one, above.

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

**If your panel is reached at an IP address, the command already has what it
needs, on Linux and on Windows.** The panel knows its own address, so when that
address is not a domain name it adds its certificate authority to the command it
writes: the authority's SHA-256 fingerprint, which the node checks what it is
given against. There is nothing to work out, nothing to configure, and nothing
to copy:

```bash
sudo bash deploy/linux/install.sh 'https://203.0.113.10' 'gbn_…' --panel-ca 'sha256:50bafcba…7782'
```

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-node.ps1 -Panel 'https://203.0.113.10' -Token 'gbn_…' -PanelCa 'sha256:50bafcba…7782'
```

What the node does with it: it asks the panel for its authority
(`/api/v1/panel-ca`, a public page, since the node has no token yet) over a
connection it does not trust, **keeps the file only if its fingerprint is the one
in the command**, and then checks once more that the certificate the panel presents
is signed by it. The command came from the panel's own signed-in page, so the
fingerprint is the part nobody between the node and the panel can change; an
authority that does not match is thrown away, with both fingerprints in the
sentence, and nothing is joined. This is how an SSH host key is pinned. It is added
to the authorities the agent already trusts (`NODE_EXTRA_CA_CERTS`), never instead
of them.

The panel learns its authority when `install-panel.sh` runs after Caddy has made
it, and starts once more to know it; a second run changes nothing. **A panel
installed before 0.9 has to be run through `install-panel.sh` once more** to hand
it out: until then its command carries `--panel-ca auto` (Linux) or nothing
(Windows), and the dialog says so.

`auto` means *that authority, from this machine*: on the panel's own machine it is
already there. For a node of a panel that cannot hand out its authority, copy the
file and pass its path instead (the Windows form is `-PanelCa 'C:\path\panel-ca.crt'`):

```bash
sudo cat /etc/geeboard/panel-ca.crt        # on the panel's machine
# on the node, saved as /root/panel-ca.crt, then:
sudo bash deploy/linux/install.sh 'https://203.0.113.10' 'gbn_…' --panel-ca /root/panel-ca.crt
```

A panel with a domain name gets no such option, because a public authority
signed its certificate and every machine already trusts it.

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
VPS with no firewall it would be on the internet the moment it starts, so **the
node installer closes it** to everybody but the panel (loopback, the panel's
address, and Docker's networks when the panel is on this machine), with ufw if
that is active, firewalld if it is running, and otherwise iptables, kept across a
reboot by a unit. Then it asks the panel whether it can still reach the node. The
lines it prints are the whole of it, and this is how to look and how to undo:

```bash
sudo bash deploy/linux/agent-port.sh status
sudo bash deploy/linux/agent-port.sh remove                    # open again
sudo bash deploy/linux/agent-port.sh apply --allow <address>   # a new panel address
sudo bash deploy/linux/install.sh --no-firewall ...            # do not touch the firewall at all
```

The rule holds the addresses the panel's name resolved to **when the node was
installed or upgraded**. A panel that moves, or whose name points somewhere else
later, is shut out, and the node shows as unreachable; run the node installer again,
or `apply --allow` with the new address. For a node on the panel's own machine nothing
needs to be done after a move: the panel calls from a Docker network, which is always let
in.

For your own ufw, the same by hand:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp                                       # the panel, through Caddy
sudo ufw allow from 172.16.0.0/12 to any port 8080 proto tcp    # a node on the panel's own machine
sudo ufw allow from <the panel's address> to any port 8080 proto tcp   # a node somewhere else
sudo ufw enable
```

**This does not encrypt the wire.** The panel calls the agent over plain http with one
token, and across the internet that crosses in clear: see
[Security](security.md#the-panel-agent-channel) for what to do (a private network on both
ends) and why a rule about who may connect does not protect the path. The installer and the
*Add a node* dialog say so when the address is out on the internet.

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
powershell -ExecutionPolicy Bypass -File .\deploy\windows\uninstall-agent.ps1   # remove it
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

The node has not been given the panel's authority. The panel puts its
fingerprint in the command whenever it is reached at an address
(`--panel-ca 'sha256:…'`, `-PanelCa 'sha256:…'` on Windows), so this means the command
was made by a panel that does not know its own authority yet (run
`sudo bash deploy/linux/install-panel.sh` once more on the panel's machine, and make
the command again), or was written by hand without it. Copying
`/etc/geeboard/panel-ca.crt` over and passing `--panel-ca <that file>` still works. It is
**added** to the authorities the agent already trusts, and nothing is turned off —
`NODE_TLS_REJECT_UNAUTHORIZED=0` is the other way to make the error go away and it is
the wrong one.

If the message says the authority **is not the one the command names**, do not go on:
either this is not the panel the command was written for, or the panel's authority
changed after the command was made (make a new command), or somebody between this
machine and the panel is answering instead of it.

### The node stays pending

That is the flow, not a fault: somebody approves it in **Nodes**. Until then it
runs nothing.

### The panel cannot reach the node

The node registered, it heartbeats, and the panel still will not place a server
on it. Registering proves the node can reach the panel; this is the other
direction, and neither implies the other. The agent says so itself, in its log:

```
{"at":"2026-10-07T09:12:03.482Z","level":"warn","component":"agent","node":"fra-node-02","msg":"the panel cannot reach this node","advertised":"http://203.0.113.10:8080","detail":"… timed out","fix":"open that address to the panel, or join again with --advertise <address the panel can use>"}
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

## Taking it down, starting over, moving it

```bash
sudo bash deploy/linux/uninstall-panel.sh            # stop and remove the containers; keep the data
sudo bash deploy/linux/uninstall-panel.sh --volumes  # also the database, after a dump and a typed word
sudo bash deploy/linux/uninstall.sh                  # a node: the agent's service and its port's rules
sudo bash deploy/linux/uninstall.sh --purge          # also its settings and every server's files, after asking
```

`uninstall-panel.sh` with no option leaves everything that is data: the database's volume, the
secrets in `deploy/panel/.env`, Caddy's configuration and the images. Nothing is lost, and
`install-panel.sh` brings the panel back on it exactly as it was. `--volumes` is the one that cannot
be undone: it takes a dump first (into `/var/backups/geeboard`, root only, with the secrets beside
it; `--no-backup` skips that), and asks for the words *delete the database*. `--env` removes the
secrets and only with `--volumes`, since a database without the key it is read with is one nobody can
open. `--caddyfile` takes away the Caddyfile the installer wrote (never one that is somebody's), puts back
the one that was there before if a copy was kept, and reloads Caddy; `--images` removes the panel's images.
It never touches a node, an agent or a game server: remove the nodes from the panel first when the panel is
going for good, or they keep calling an address nobody answers.

`uninstall.sh` (a node) refuses to guess: an option it does not know is an error, `--help` is help, and
`--purge` lists what it would delete (settings, the data root with its size, the agent's images, the
container firewall) and **refuses while a game server's container exists** unless `--even-with-servers`,
then asks for the word *delete* (`--yes` skips the word, never the refusal).

**Moving the panel to another machine, or changing its address.** The data is the database and `deploy/panel/.env`:

1. On the old machine, take a dump and copy it with the secrets file, off the machine:
   `sudo bash deploy/linux/install-panel.sh --yes` makes one (and says where) as part of an upgrade, or
   `docker compose -f deploy/panel/docker-compose.yml exec -T db pg_dump -U geeboard -Fc geeboard > panel.dump`.
2. On the new machine, clone the repository, put `deploy/panel/.env` in place (the secrets *must* be the old ones:
   `SECRETS_KEY` is what every stored node token is read with), start the database
   (`docker compose -f deploy/panel/docker-compose.yml up -d db`) and restore the dump into it
   (`pg_restore -U geeboard -d geeboard`, as in [Upgrading](upgrading.md#undoing-an-upgrade)), then run
   `install-panel.sh --panel-url https://new.example.com` (or `--domain`/`--ip`) so that `PANEL_URL` and Caddy follow.
3. **Every node has to learn the new address**: its agent calls the panel at the address it joined with. Rejoin it from
   *Nodes → Add a node → Create the command* (a node of the same name keeps its approval, and the installer asks before it
   replaces it), and the agent port's rule on a *remote* node, which names the old panel's address, follows when that
   command runs. A panel at an address, with Caddy's own authority, also has a new authority: the new command
   carries its fingerprint, which is all a node needs (and a node whose command is from the old panel refuses the
   new one, with both fingerprints in the sentence).
4. DNS: for a domain, point it at the new machine before step 2 so the certificate can be issued.

**A new address for the same machine** (a domain where there was an IP): `install-panel.sh --domain panel.example.com --email you@example.com`
changes `PANEL_URL` and writes the Caddyfile for it, and the nodes rejoin as in step 3. A node on the panel's own machine
needs nothing.

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
