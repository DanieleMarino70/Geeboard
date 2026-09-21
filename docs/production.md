---
title: Install
nav_order: 2
has_children: true
---

# Installing Geeboard for real

From a `git clone` on a PC or a VPS to an owner signed in with a password of
their own and two-factor on. For trying the panel out on a laptop, the few
commands on the [home page](index.md) are enough; this page is the other case.

**Nothing here uses the seed.** `npm run db:seed` and `db:seed:empty` are
development tools: they wipe the database and create an owner whose password is
published in the source, and they refuse to run with `NODE_ENV=production`. A
real installation's first account comes from `setup`, below.

Three processes and a database — the panel, the poller, Postgres — and one
agent on every machine that will host game servers
([installation.md](installation.md#a-node)). **All of them run as containers**,
and this page is the one way to install them. The whole of it, in order:

1. [a machine with Docker on it](#a-fresh-ubuntu-machine)
2. [the panel and its database](#the-panel)
3. [https in front of it](#https-and-why-it-is-not-optional) — a domain, or
   an address and a certificate authority of your own
4. [the first owner](#the-first-owner)
5. [a node, and proving the panel can reach it](#a-node)

## A fresh Ubuntu machine

Docker with the compose plugin, git, and nothing else. On Ubuntu 22.04 or
24.04, from Docker's own repository — the `docker.io` package in Ubuntu's is
older than the compose plugin expects:

```bash
sudo apt update && sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world     # it answers, or nothing below will work
```

A panel needs about 2 GB of memory and a few gigabytes of disk. A machine that
is also a node needs whatever its game servers need, on top.

## The panel

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git && cd Geeboard

deploy/panel/init.sh https://panel.example.com   # writes deploy/panel/.env, once

# Take the published image for this release — add the same line to
# deploy/panel/.env so every later command uses it — or leave it out and
# build from the checkout with `docker compose ... build` instead.
echo 'GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:0.1.0' >> deploy/panel/.env
docker compose -f deploy/panel/docker-compose.yml pull panel poller

docker compose -f deploy/panel/docker-compose.yml run --rm panel \
  setup --email you@example.com --name "Your Name"
docker compose -f deploy/panel/docker-compose.yml up -d
```

`init.sh` generates three secrets on the machine — the database's password, the
key that signs sessions, the key that encrypts node tokens — into
`deploy/panel/.env`, readable by your account only, and prints none of them. It
never overwrites: `SECRETS_KEY` is what every stored node token is encrypted
under, and Postgres reads its password only when its volume is first made, so
regenerating either on a running installation locks the panel out of its own
data. **Back that file up with the database**; a dump without `SECRETS_KEY` is a
panel that cannot reach its nodes.

The compose file is not the one at the repository's root, which is a developer's
Postgres on a published port with a password anyone can read in it. This one
publishes the database nowhere, has no default for any secret, and publishes
the panel on `127.0.0.1:3000` only — for the reverse proxy below.

`setup` is described under [The first owner](#the-first-owner). The image has
the other verbs too: `panel`, `poller`, `migrate`, `recover`, `sync`.

## Not covered here: running it without Docker

`deploy/panel/systemd/` holds units that run the panel and the poller from a
checkout with Node.js and a Postgres of your own, and they still work. They are
not a second installation path and this guide does not document one: one way to
install is one way to support, to upgrade and to write down. If you are already
running that way, [upgrading.md](upgrading.md) keeps you going.

One poller per installation, never two: each would run every scheduled backup.

## What the panel refuses to start with

In production the panel checks its environment before it takes a request, and
exits saying what is wrong rather than coming up and failing at the first
sign-in:

- `DATABASE_URL` missing, or still using the development password `geeboard`
- `SESSION_SECRET` or `SECRETS_KEY` missing, shorter than 32 characters, the
  same as each other, or **looking like an example** — the file this project
  used to ship held a thirty-six-character sentence in both, long enough to pass
  a length check and printed in a public repository
- it warns, and starts, when `PANEL_URL` is unset or is not `https`

`npm run setup` makes the same checks before it touches anything.

## https, and why it is not optional

Sessions are `Secure` cookies when `NODE_ENV=production`: a browser will not send
them over plain HTTP, so **a production panel reached over `http://` cannot sign
anybody in**. Put a reverse proxy with a certificate in front of it, and set
`PANEL_URL` to the `https://` address — it is what the Add a node command hands
to machines.

The proxy has to pass the `Host` it was asked for, must not buffer (the live
console is a stream), and should allow a long-lived response.

There are two of these, and which one you are in is decided by whether the panel
has a name or only an address. [`deploy/panel/Caddyfile`](https://github.com/DanieleMarino70/Geeboard/blob/main/deploy/panel/Caddyfile)
holds both blocks; copy it to `/etc/caddy/Caddyfile` and keep the one you need.

```bash
sudo apt install -y caddy          # 24.04 has it; caddyserver.com/docs/install for the rest
sudo ufw allow 80,443/tcp          # if ufw is on
sudo cp deploy/panel/Caddyfile /etc/caddy/Caddyfile    # then edit it
sudo systemctl reload caddy
```

### A domain, and a certificate every browser already trusts

`panel.example.com` resolves to this machine, ports 80 and 443 are open, and
Caddy gets a certificate from Let's Encrypt and renews it:

```caddyfile
panel.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

`PANEL_URL=https://panel.example.com` in `deploy/panel/.env`. Nothing else is
needed anywhere: a node agent trusts that certificate the way your browser does,
because a public authority signed it.

### An address, and a certificate authority of your own

No domain name, so no public authority will issue anything for it. Caddy's `tls
internal` makes Caddy its own authority and signs a certificate for the address
with it:

```caddyfile
203.0.113.10 {
    tls internal
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

`PANEL_URL=https://203.0.113.10`. Run `sudo systemctl reload caddy`, and open
`https://203.0.113.10` once in a browser: it will warn that the authority is
unknown, and accepting that is the browser's side of this.

**A private authority is what `tls internal` means, and it is the whole of the
difference.** The certificate is real and the connection is encrypted and
checked exactly as any other; what no other machine has is the authority that
signed it, so no other machine accepts it until it is given that authority. A
browser asks you and takes your answer. A node agent is a Node.js program whose
trust store is the public authorities and nothing else, so it refuses — which
arrives as

```
Registering with the panel failed: the certificate https://203.0.113.10
presented is signed by a certificate authority this machine does not trust
(UNABLE_TO_VERIFY_LEAF_SIGNATURE) …
```

The fix is to give the agent that authority, not to take the checking away:

```bash
sudo deploy/linux/install.sh https://203.0.113.10 'gbn_…' --panel-ca auto
```

`--panel-ca auto` reads Caddy's root certificate from where the Caddy package
puts it on this machine —

```
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

— copies it to `/etc/geeboard/panel-ca.crt`, and writes
`NODE_EXTRA_CA_CERTS=/etc/geeboard/panel-ca.crt` into `/etc/geeboard/agent.env`,
which the agent's container reads. `NODE_EXTRA_CA_CERTS` **adds** an authority to
the ones Node already trusts; it turns nothing off, and every other certificate
is checked exactly as before. The line survives upgrades: `install.sh` with no
arguments keeps it.

On a node that is **not** the panel's machine there is no Caddy to read it from,
so copy the file over and name it:

```bash
# on the panel's machine
sudo cat /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
# on the node, into /root/panel-ca.crt, then
sudo deploy/linux/install.sh https://203.0.113.10 'gbn_…' --panel-ca /root/panel-ca.crt
```

That root certificate is public — it lets a machine *check* a certificate, and
can sign nothing. Caddy's private key stays on the panel's machine.

**What not to do:** `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off certificate
checking for everything the agent talks to, including the panel it takes orders
from, and leaves a man in the middle of that channel with the run of every
container on the node. It is not supported and nothing in Geeboard sets it.

A domain is still the better answer when you can have one — one fewer file to
copy to every node, and a certificate that renews itself for everybody at once.

### nginx

If you already run nginx, with a certificate from certbot or your own — the
same two cases apply, and a certificate nginx serves from a private authority
needs the same `--panel-ca` on every node:

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;
    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    client_max_body_size 300m;          # API file uploads go up to 256 MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;            # the console is server-sent events
        proxy_read_timeout 1h;
    }
}
server {
    listen 80;
    server_name panel.example.com;
    return 301 https://$host$request_uri;
}
```

Sign-in attempt limits are counted per source address, read from
`X-Forwarded-For`. Behind a proxy that does not set it, every visitor is one
address and thirty wrong passwords from anybody lock the form for everybody for
a quarter of an hour.

Node agents are reached by the panel, not the other way round, and need no
proxy — but they must not be public: see [installation.md](installation.md#a-node)
and [security.md](security.md#node-security).

## The first owner

Whoever installs the panel is its administrator. `setup` — `npm run setup`, or
the image's `setup` verb — does, in order:

1. checks the environment, and stops on a missing or example secret
2. applies the migrations with `prisma migrate deploy` — never `migrate dev`,
   which may offer to reset a database
3. writes the game catalog from the definitions, with no network; the poller
   refreshes it from upstream afterwards
4. creates **one** `OWNER`, with the email and name you give, and prints a
   **temporary password**

```
  Your Name <you@example.com> is the owner of this installation.

  Temporary password:   kTq7m-Xw3pR-9hZcN-bL4vE

  It is shown this once and is not stored anywhere it can be read back.
  It works until 2026-09-22 18:40 UTC — a day. …
```

The password is random, shown in the terminal that once, stored only as a bcrypt
hash, and never written to a file or a log. It is good for **24 hours**.

Sign in with it and the panel shows you one page. Every other page sends you
back to it and the API refuses your session, until, in this order:

1. **you have replaced the temporary password** with one of your own — typed as
   the current password, on the Account page. That signs out every other
   session. Two-factor is not offered before this: a second factor set up behind
   a password somebody else may have seen is not yours.
2. **you have set up two-factor sign-in**, which owners and admins must have:
   scan the QR code with any authenticator app, confirm with a code, and keep
   the ten recovery codes it shows once.

Run `setup` a second time and it refuses: it makes the first owner, and is not a
way to make a second. More people are added from **Members**, by you, where it
is audited under your name.

There is no first-run page in the browser that does any of this. On a VPS the
first visitor to a new port is as often a scanner as the installer, and a form
that makes an owner for whoever arrives first hands them the panel.

## A node

A node is a machine that hosts game servers. The panel's own machine can be one;
so can any other machine with Docker on it. The flow, with what each step
proves, is [installation.md](installation.md#a-node) — here is the shape of it.

**The token.** In the panel, **Nodes → Add a node**: a name, the capabilities
this machine should declare, then **Create the command**. The token is
single-use, expires in a day, and is bound to that name. It is the only secret
in the command, and it is spent by its first run.

**On the machine**, with Docker running and a checkout of this repository:

```bash
sudo deploy/linux/install.sh https://panel.example.com 'gbn_…'
# a panel behind `tls internal` instead:
sudo deploy/linux/install.sh https://203.0.113.10 'gbn_…' --panel-ca auto
```

It pulls the agent image for this release, registers the machine, writes
`/etc/geeboard/agent.json`, and starts `geeboard-agent.service`. It then waits
for the agent's first heartbeat and prints whether **the panel could call this
machine back**, which is the step that used to be missing.

**Approve it.** A node that registered is `PENDING` and takes nothing until an
admin approves it: a leaked registration token must not become a node in your
fleet by waiting. The dialog offers **Approve** as soon as the machine appears.

**Then a server can be created** on it: approved, reachable, with the capacity
the game asks for and a platform that can run it.

### What has to be true, in order

```
panel answers on https                 the browser signs in
  ↓
agent → panel works                    "registered with the panel" in the agent's log
  ↓                                    (a TLS refusal here is --panel-ca, above)
node registered, approved              Nodes, in the panel
  ↓
heartbeats arrive                      "seen" on the node's page moves
  ↓
panel → node works                     "Reached" on the node's page moves, and
  ↓                                    the node stays HEALTHY rather than
  ↓                                    degrading at 30s and reading as
  ↓                                    UNREACHABLE at two minutes
a server can be created
```

The two middle arrows are different directions and neither implies the other.
An agent that registers and heartbeats perfectly, on a machine whose port 8080
the panel cannot reach, is a node the panel reports as `UNREACHABLE` — and
refuse to place a server on, because it could not drive the container it made.
The agent says so in its own log, once, and repeats every five minutes:

```
the panel cannot reach this node  advertised=http://203.0.113.10:8080 …
```

[installation.md](installation.md#when-the-panel-cannot-reach-the-node) is what
to do about it: usually a firewall rule, or `--advertise` on a machine behind
NAT.

## Getting back in

Lost the temporary password before using it, let its day run out, forgot your
own, or lost the phone *and* the recovery codes:

```bash
npm run admin:recover                                  # from web/, on the panel's machine
docker compose -f deploy/panel/docker-compose.yml run --rm panel recover --yes
npm run admin:recover -- --email you@example.com       # when there is more than one owner
```

It gives an **owner** a new temporary password (shown once, a day), removes
two-factor from the account, ends every session it has, and writes
`installation.owner.recovered` to the audit log — so a recovery nobody expected
is something the other owners can see. Then it is the first sign-in again:
password, then two-factor.

Being able to run it is the proof of being the administrator. Whoever can run a
command as the panel against its database already has everything the panel
protects; there is no web equivalent, by design. Everybody who is not an owner
is reset from **Members**, by an owner.

## Afterwards

- **Add a node**: **Nodes → Add a node** — [installation.md](installation.md#a-node)
- **Back up Postgres and the secrets file together.** Geeboard's backups copy
  each server's world; nothing in it copies the panel's own database —
  [upgrading.md](upgrading.md#backing-up-the-panel)
- **One instance.** Sign-in attempt limits, two-factor attempt limits and the
  API's rate limit are counted in the panel's process, and the poller must be
  single — [security.md](security.md#one-instance-and-what-changes-with-more)
- **Upgrading** to a later release: [upgrading.md](upgrading.md)
