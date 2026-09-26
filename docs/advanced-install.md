# Advanced and manual installation

[Install Geeboard](production.md) is one command that does all of this. This
page is the same installation as a list of commands, for an administrator who
wants to run each one, put the pieces somewhere else, or use a reverse proxy
that is not Caddy.

Nothing here is deprecated. `deploy/linux/install-panel.sh` runs these commands
in this order with the answers filled in, and every file it writes is a file
you can write yourself.

## A machine with Docker on it

Docker with the compose plugin, git, and nothing else. From Docker's own
repository, which carries the current release for every Ubuntu that is still
supported — tested here on 26.04, whose own `docker.io` and `docker-compose-v2`
packages work too if you would rather have them:

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
is also a node needs whatever its game servers need, on top. Installed this
way, **`docker` is root's**: a fresh account is not in the `docker` group, so
every command below says `sudo`. Adding yourself to that group instead —
`sudo usermod -aG docker $USER`, then log in again — works and is a decision,
not a convenience: the socket is root-equivalent, and so is anybody who can
reach it.

## The environment file

```bash
git clone https://github.com/DanieleMarino70/Geeboard.git && cd Geeboard
deploy/panel/init.sh https://panel.example.com   # writes deploy/panel/.env, once
```

`init.sh` generates three secrets on the machine — the database's password, the
key that signs sessions, the key that encrypts node tokens — into
`deploy/panel/.env`, readable by your account only, and prints none of them.

**It never overwrites.** `SECRETS_KEY` is what every stored node token is
encrypted under, and Postgres reads its password only when its volume is first
made, so regenerating either on a running installation locks the panel out of
its own data. **Back that file up with the database**; a dump without
`SECRETS_KEY` is a panel that cannot reach its nodes.

| | |
| --- | --- |
| `POSTGRES_PASSWORD` | The database's. Generated; read when its volume is made |
| `SESSION_SECRET` | Signs session cookies. Changing it signs everybody out, and nothing worse |
| `SECRETS_KEY` | Encrypts every node token and the off-site bucket's keys. **Changing it makes all of them undecryptable** |
| `PANEL_URL` | The https address browsers and agents use. What the Add a node command hands to machines |
| `PANEL_BIND` | Where the panel listens on this host, for the proxy. `127.0.0.1:3000` |
| `GEEBOARD_PANEL_IMAGE` | The published image for this release. Empty builds from this checkout |
| `STEAM_API_KEY` | Optional. Only for searching the Steam Workshop from the Mods tab. An owner can set one on that tab instead; this one wins while it is set |

`deploy/lib/panel-env.sh` is where both `init.sh` and the installer get this;
if you are scripting an installation of your own, source it rather than writing
a fourth copy of the same rules.

## The containers

```bash
# Take the published image for this release — add the same line to
# deploy/panel/.env so every later command uses it — or leave it out and
# build from the checkout with `docker compose ... build` instead.
echo 'GEEBOARD_PANEL_IMAGE=ghcr.io/danielemarino70/geeboard-panel:0.3.2' >> deploy/panel/.env
sudo docker compose -f deploy/panel/docker-compose.yml pull panel poller

sudo docker compose -f deploy/panel/docker-compose.yml run --rm panel \
  setup --email you@example.com --name "Your Name"
sudo docker compose -f deploy/panel/docker-compose.yml up -d
```

The compose file is not the one at the repository's root, which is a developer's
Postgres on a published port with a password anyone can read in it. This one
publishes the database nowhere, has no default for any secret, and publishes
the panel on `127.0.0.1:3000` only — for the reverse proxy below.

The image has five verbs besides `panel` and `poller`: `migrate` applies the
schema and nothing else, `setup` makes the first owner, `recover` gets an owner
back in, and `sync` refreshes the game catalog.

`setup` is what [Install Geeboard](production.md#the-first-owner) describes. It
makes the first owner, prints a temporary password once, and refuses to run a
second time.

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

## https, by hand

Sessions are `Secure` cookies when `NODE_ENV=production`: a browser will not send
them over plain HTTP, so **a production panel reached over `http://` cannot sign
anybody in**. Put a reverse proxy with a certificate in front of it, and set
`PANEL_URL` to the `https://` address.

The proxy has to pass the `Host` it was asked for, must not buffer (the live
console is a stream), and should allow a long-lived response.

### Caddy

[`deploy/panel/Caddyfile`](https://github.com/DanieleMarino70/Geeboard/blob/main/deploy/panel/Caddyfile)
holds both blocks; copy it to `/etc/caddy/Caddyfile` and keep the one you need.
The installer renders the same block from
[`deploy/panel/caddy/panel.caddyfile.tmpl`](https://github.com/DanieleMarino70/Geeboard/blob/main/deploy/panel/caddy/panel.caddyfile.tmpl),
filling in the site, the `tls` line and the address from `PANEL_BIND`.

```bash
sudo apt install -y caddy          # Ubuntu ships it; caddyserver.com/docs/install for the newest
sudo cp deploy/panel/Caddyfile /etc/caddy/Caddyfile    # then edit it: keep one block
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

Ubuntu 26.04's own package is Caddy 2.6.2, and both blocks below work with it,
`tls internal` for a bare address included.

**A domain, and a certificate every browser already trusts.**
`panel.example.com` resolves to this machine, ports 80 and 443 are open, and
Caddy gets a certificate from Let's Encrypt and renews it:

```caddyfile
panel.example.com {
    tls you@example.com
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

`PANEL_URL=https://panel.example.com` in `deploy/panel/.env`. Nothing else is
needed anywhere: a node agent trusts that certificate the way your browser does,
because a public authority signed it.

**An address, and a certificate authority of your own.** No domain name, so no
public authority will issue anything for it. Caddy's `tls internal` makes Caddy
its own authority and signs a certificate for the address with it:

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

The fix is to give the agent that authority, not to take the checking away.
Caddy writes its root certificate the first time it serves with `tls internal`:

```
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

The panel installer copies it to `/etc/geeboard/panel-ca.crt`, which is where
the node installer looks. By hand:

```bash
sudo install -d -m 0700 /etc/geeboard
sudo install -m 0644 /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt /etc/geeboard/panel-ca.crt
```

The panel writes `--panel-ca auto` into the node command it hands out whenever
it is reached at an address, and `auto` is that file. On the panel's own
machine it is already there, so the generated command works unchanged — the
node installer also finds it with no option at all, when the panel's address is
one the machine holds. Elsewhere, copy it over and name it:

```bash
sudo bash deploy/linux/install.sh https://203.0.113.10 'gbn_…' --panel-ca /root/panel-ca.crt
```

Either way it ends up at `/etc/geeboard/panel-ca.crt` on the node, with
`NODE_EXTRA_CA_CERTS` pointing at it in `/etc/geeboard/agent.env`, which the
agent's container reads. `NODE_EXTRA_CA_CERTS` **adds** an authority to the ones
Node already trusts; it turns nothing off, and every other certificate is
checked exactly as before. The line survives upgrades.

That root certificate is not a secret — it lets a machine *check* a certificate,
and can sign nothing. Caddy's private key stays on the panel's machine.

**What not to do:** `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off certificate
checking for everything the agent talks to, including the panel it takes orders
from, and leaves a man in the middle of that channel with the run of every
container on the node. It is not supported and nothing in Geeboard sets it.

A domain is still the better answer when you can have one — one fewer file to
copy to every node, and a certificate that renews itself for everybody at once.

### nginx

If you already run nginx, with a certificate from certbot or your own — the
same two cases apply, and a certificate nginx serves from a private authority
needs the same `--panel-ca` on every node. Run the panel installer with
`--no-caddy`, or install by hand and use this:

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
proxy — but they must not be public: see
[Install Geeboard](production.md#the-firewall) and
[Security](security.md#node-security).

## The installer's own options

`sudo bash deploy/linux/install-panel.sh --help` lists them. The ones worth
knowing:

| | |
| --- | --- |
| `--domain <name> --email <address>` | Answer the https question on the command line |
| `--ip [<address>]` | The same, for an installation with no domain name |
| `--panel-url <url>` | An address you have arranged https for yourself. Implies `--no-caddy` |
| `--bind <host:port>` | Where the panel listens for the proxy |
| `--image <reference>` / `--build` | A panel image of your own, or one built from this checkout |
| `--owner-email`, `--owner-name` | The first owner, without being asked |
| `--no-caddy` | Leave the reverse proxy to you |
| `--yes` | Take every default and ask nothing — for a scripted installation |

With `--yes` and enough of the others, the whole installation runs unattended.
Without a terminal and without the flag it would need, it stops and says which
one.

## Running it without Docker

`deploy/panel/systemd/` holds units that run the panel and the poller from a
checkout with Node.js and a Postgres of your own, and they still work. They are
not a second installation path and this guide does not document one: one way to
install is one way to support, to upgrade and to write down. If you are already
running that way, [Upgrade](upgrading.md) keeps you going.

One poller per installation, never two: each would run every scheduled backup.

## A node, without the installer

The agent is a program you can run yourself — a checkout, Node.js,
`npm install`, `npm run join -- <panel> <token>`, `npm start`. Nothing starts it
at boot that way. [The node agent](daemon.md) is what it does, and
[A checkout to try it](installation.md#configuring-it-by-hand) has every
environment variable and the way to attach a node the panel has no token for.

## Getting back in

```bash
sudo docker compose -f deploy/panel/docker-compose.yml run --rm panel recover --yes
npm run admin:recover -- --email you@example.com       # from web/, without Docker
```

It gives an **owner** a new temporary password (shown once, a day), removes
two-factor from the account, ends every session it has, and writes
`installation.owner.recovered` to the audit log. Everybody who is not an owner
is reset from **Members**, by an owner.
