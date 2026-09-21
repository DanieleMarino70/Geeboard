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
([installation.md](installation.md#a-node)). Two ways to run the first three.

## With Docker

You need Docker with the compose plugin, and this repository.

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

## Without Docker

Node.js 22, PostgreSQL 16, and a checkout — here `/opt/geeboard`, owned by an
account called `geeboard`.

```bash
sudo useradd --system --home /opt/geeboard --shell /usr/sbin/nologin geeboard
sudo git clone https://github.com/DanieleMarino70/Geeboard.git /opt/geeboard
sudo chown -R geeboard: /opt/geeboard

sudo -u postgres psql -c "CREATE USER geeboard PASSWORD '<a password of its own>'"
sudo -u postgres createdb -O geeboard geeboard

cd /opt/geeboard/web
sudo -u geeboard npm ci
sudo -u geeboard npm run setup:env -- \
  --database-url 'postgresql://geeboard:<that password>@localhost:5432/geeboard?schema=public' \
  --panel-url https://panel.example.com
sudo -u geeboard env NODE_ENV=production npm run build
sudo -u geeboard env NODE_ENV=production npm run setup -- --email you@example.com --name "Your Name"
```

`setup:env` writes `web/.env` with a generated `SESSION_SECRET` and `SECRETS_KEY`
and does not print them. Run again on a file that exists it changes nothing and
says what, if anything, is wrong with it.

Then the two services. The units read `/etc/geeboard/panel.env`, so the same
variables live there rather than in the checkout:

```bash
sudo install -d -m 0750 -o root -g geeboard /etc/geeboard
sudo install -m 0640 -o root -g geeboard /opt/geeboard/web/.env /etc/geeboard/panel.env
sudo sed -i 's/^\([A-Z_]*\)="\(.*\)"$/\1=\2/' /etc/geeboard/panel.env   # systemd takes no quotes
sudo cp /opt/geeboard/deploy/panel/systemd/geeboard-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now geeboard-panel geeboard-poller
journalctl -u geeboard-panel -u geeboard-poller -f
```

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

## TLS, and why it is not optional

Sessions are `Secure` cookies when `NODE_ENV=production`: a browser will not send
them over plain HTTP, so **a production panel reached over `http://` cannot sign
anybody in**. Put a reverse proxy with a certificate in front of it, and set
`PANEL_URL` to the `https://` address — it is what the Add a node command hands
to machines.

The proxy has to pass the `Host` it was asked for, must not buffer (the live
console is a stream), and should allow a long-lived response.

**Caddy** — gets and renews the certificate itself:

```caddyfile
panel.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

**nginx** — with a certificate from certbot or your own:

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
