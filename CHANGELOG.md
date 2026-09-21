# Changelog

What changed between releases, written for whoever installs and runs Geeboard.
Anything that changes a command you type, a file you edit, a port you open or a
step you have to take on the way up is in here; the reasoning behind it is in
[docs/roadmap.md](docs/roadmap.md).

Versions are semantic, and Geeboard is on `0.x`: **the minor is where a
breaking change lands** until 1.0. A panel and an agent work together when
they share a release line — `0.1.x` with `0.1.y` — which the panel checks when
a node joins and shows on the node's page. See
[docs/nodes.md](docs/nodes.md#panel-and-agent-versions).

Dates are ISO, newest first.

## [Unreleased]

### The panel

- **Games have covers.** The striped rectangle with an abbreviation in it is
  now a drawing per game — wherever the panel shows one, which is the
  dashboard, the servers list, a server's page, a node's page, the Games page
  and the create wizard. They are drawn in the panel itself: nothing is
  downloaded, nothing is stored, and the panel still works with the network
  gone. A game with no drawing keeps the striped square rather than showing a
  broken image.

### Installing

- **A panel with no domain name is a documented case now.** Caddy's `tls
  internal` signs a certificate for an address with an authority private to
  that machine, and a node agent — a Node.js program that trusts the public
  authorities — refused it. `deploy/linux/install.sh … --panel-ca auto` copies
  Caddy's root certificate to `/etc/geeboard/panel-ca.crt` and gives the agent
  it as `NODE_EXTRA_CA_CERTS`: one authority **added** to the ones it already
  trusts. `--panel-ca <file>` is the same for a node that is not the panel's
  machine. Nothing turns certificate checking off, and
  `NODE_TLS_REJECT_UNAUTHORIZED=0` remains unsupported.
- `deploy/panel/Caddyfile` holds both reverse-proxy blocks — a domain with a
  public certificate, and an address with `tls internal` — and
  [docs/production.md](docs/production.md) is a Docker-only installation guide
  from a fresh Ubuntu machine to a server created on a node. The units under
  `deploy/panel/systemd/` still work and are no longer documented as a second
  way to install.
- `install.sh`, `uninstall.sh`, `init.sh` and both container entrypoints are
  executable in git (`100755`): a fresh checkout no longer needs `chmod +x`.

### Nodes

- **The panel checks that it can reach a node, and says so.** Registering
  proved one direction only — the agent reaching the panel — so a machine
  whose port nothing could open still registered, heartbeated, and failed at
  the first server placed on it. The panel now calls the node's advertised
  address while answering a heartbeat, when it has not reached it in the last
  30 seconds, and tells the agent what happened; the agent prints
  `the panel cannot reach this node` with the address and the reason, and
  `install.sh` waits for that answer and prints it too.
- Node health decays from `lastReachedAt` — the panel reaching the node — and
  no longer from `lastSeenAt`, which a heartbeat refreshed every fifteen
  seconds. **A node the panel cannot reach now reads as `UNREACHABLE` within
  two minutes instead of as healthy**, which is what it always was. A
  heartbeat on its own no longer clears a fault; a call that gets through
  does, from either the watchdog or a heartbeat's own check. The node's page
  shows both timestamps, as *Last seen* and *Reached*, and the API's node
  shape carries `lastReachedAt`.
- The agent says why a request to the panel failed. "Registering with the
  panel failed: fetch failed" now names the cause — an untrusted certificate
  authority and the code under it, an expired certificate, a refused
  connection, a name that does not resolve, a timeout — without printing any
  token.

## [0.1.0] — 2026-09-21

The first release. Everything below is new because there was nothing before it
to change.

### Installing

- `npm run setup` makes the first owner: migrations with `prisma migrate
  deploy`, the game catalog, and one `OWNER` account with a temporary password
  printed once in the terminal, stored only as a hash and good for 24 hours.
  Signed in with it the account sees nothing until it has been replaced with a
  password of your own — and only then is two-factor asked for.
- `npm run admin:recover` is the way back in from a temporary password that was
  lost or ran out, a forgotten password, or a phone and its recovery codes both
  gone. It runs on the panel's own machine and has no web equivalent.
- The sample workspace (`npm run db:seed`) refuses to run with
  `NODE_ENV=production`, and the account it creates is no longer the only way
  to have one.
- The panel refuses to start on a configuration it cannot be trusted with:
  a missing `DATABASE_URL` or one still on the development password, a secret
  that is missing, short, identical to the other, or that looks like an
  example.
- **Docker:** one image with five verbs — `panel`, `poller`, `migrate`,
  `setup`, `recover` — and `deploy/panel/docker-compose.yml`, which publishes
  the database nowhere, has no default for any secret, and puts the panel on
  loopback for a reverse proxy. `deploy/panel/init.sh` generates the three
  secrets into a file it never overwrites.
- **Without Docker:** `deploy/panel/systemd/` runs the same thing from a
  checkout.
- [docs/production.md](docs/production.md) is the whole path, from `git clone`
  to signed in, with TLS.

### Nodes

- **Add a node** names a machine and hands you one command to run on it. The
  agent works out its own address, makes its own secret, registers under that
  name and saves its settings; you approve it in the panel when it appears.
- The agent installs as something that starts at boot: a container under
  systemd on Linux, a scheduled task on Windows.
- A node reports what its container engine can hand out, not what the machine
  has — under Docker Desktop that is the VM's share — so the panel stops
  placing servers the engine could never hold.
- Creation refuses a node that cannot run the game: wrong operating system or
  architecture, or a capability the node has not declared.
- An agent's token can be rotated from the node's page with the node in
  service, and nobody is shown the token.
- Retiring a node moves or deletes its servers, drains it and removes it, and
  refuses removal while anything on the machine would be lost track of.

### Game servers

- Five games run from their own images: Minecraft Java (Paper), Minecraft
  Bedrock, Terraria (vanilla and TShock), Valheim and Project Zomboid.
- Create, start, stop, restart, delete, with an audit trail, and a create that
  fails rolls back everything it did.
- A live console over WebSocket, with commands going to the game's stdin.
- A file manager confined to each server's own directory.
- Backups that copy bytes: archived and hashed on the node, restored only after
  the hash is checked. With an S3-compatible bucket configured on the Backups
  page they go off-site on a URL the panel signs, so a node never holds the
  keys and a dead node leaves its backups behind.
- Moving a server to another node, through the bucket, with a rollback at every
  step that leaves it running where it was.
- Scheduled backups, restarts, broadcasts and cleanups, run by the poller
  rather than by a page.
- Updates that back up first, stay inside a version's line and leave a recorded
  way back.
- Health checks that ask the game rather than the container, and crash recovery
  with a ceiling and growing delays so nothing restart-loops.

### The API

- An HTTP API at `/api/v1` that does what the panel's buttons do to servers,
  settings, files, backups, scheduled tasks and nodes, and reads the audit log.
  Every scope on the API keys page has routes behind it.
  See [docs/api.md](docs/api.md).

### Known limitations

Read [docs/limitations.md](docs/limitations.md) before planning around any of
this. The short version: three games are written but have never been run and
are not offered; plugins, mods and the Steam Workshop are not implemented; the
panel sends no email, so a password reset is a link an admin hands over; and
off-site backups have been proved against MinIO, not yet against a commercial
provider.

[0.1.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.1.0
