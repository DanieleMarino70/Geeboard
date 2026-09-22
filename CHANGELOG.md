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

### Installing

- **One command installs the panel.** `sudo bash deploy/linux/install-panel.sh`
  checks the machine, generates the secrets, writes `deploy/panel/.env`,
  detects this machine's public address, writes `/etc/caddy/Caddyfile`, starts
  the containers, waits for the database and the panel to be healthy, makes the
  first owner, and checks that the finished https address answers. It asks two
  questions: whether you have a domain name, and who the owner is. **Nobody has
  to open `.env`, `docker-compose.yml` or the `Caddyfile` any more**, and the
  beginner documentation no longer tells anybody to run `chmod`.
- **Running it again is the upgrade and the repair.** It never regenerates a
  secret that is already there — `SECRETS_KEY` is what every stored node token
  is encrypted under — never removes a volume, a game server or a backup, and
  keeps a `Caddyfile` you have edited.
- **The panel decides about its own certificate authority, not you.** A panel
  reached at an address rather than a name signs its certificates with an
  authority only it has, and a node agent has to be given that authority. The
  Add a node dialog now reads its own `PANEL_URL`, sees an IPv4 or IPv6
  address, and writes `--panel-ca auto` into the Linux command itself. A panel
  with a domain name gets no such option, and neither does a panel on plain
  `http://` — there is no certificate to distrust. Nothing asks, and there is
  no setting for it: `needsPanelAuthority` in `web/src/lib/agent-command.ts` is
  the one place that decides.
- **`--panel-ca auto` now means "that authority, from this machine"**, and says
  what to do when it is not there. It used to be one fixed path, so a command
  carrying it on a node away from the panel failed on a file the reader had
  never typed. It looks where the panel's installer leaves the authority and
  where Caddy keeps it, and on a node somewhere else it names the one thing to
  do — copy `/etc/geeboard/panel-ca.crt` over and pass its path — rather than
  stopping on a path that was never going to exist there.
- **HTTPS without a domain name is arranged for you.** The installer detects
  the public address, offers it, writes `tls internal`, waits for Caddy to
  create its certificate authority, and copies it to
  `/etc/geeboard/panel-ca.crt` — where the node installer finds it **without
  being told**. `--panel-ca` is now only for a node that is not the panel's own
  machine. What a private authority is, and how it differs from a public
  certificate, is said on screen while it happens.
- **The installers repair permissions themselves.** A checkout copied from
  Windows, unpacked from a zip or restored from a backup arrives with no
  execute bit and sometimes with Windows line endings, which reads as "bad
  interpreter: no such file or directory". Both are fixed, to `0755` — never
  `777` — and a file that cannot be fixed is named with the one command for it.
  Every documented command now runs an installer through `bash`, which needs no
  execute bit at all.
- **A Windows node is one command too.**
  `deploy\windows\install-node.ps1` checks Node.js, npm and Docker Desktop,
  unblocks the scripts Windows marked as downloaded, installs the dependencies,
  joins the panel, registers the **Geeboard Agent** task and waits for the agent
  to answer. The panel's Add a node dialog writes that one line — with
  `-ExecutionPolicy Bypass`, because a fresh Windows install refuses every
  `.ps1` — instead of the four it used to hand over.
- **The Linux node installer says what it is doing**, repairs the same
  permissions, tells "the panel is not there" apart from "the panel is there and
  this machine does not trust its certificate" *before* it registers, and checks
  that the agent answers on this machine as well as whether the panel could
  reach it.
- `deploy/lib/` is new, and is where the installers keep what they share: the
  staged output, the checks, the permission repair and the reading and writing
  of the environment file. `deploy/panel/init.sh` uses it too, so there is one
  implementation of "never overwrite a secret" rather than two.
- **The documentation follows the installer.**
  [Install Geeboard](docs/production.md) is now what the panel is, what a node
  is, choosing a setup, the three commands, a Linux node, a Windows node, the
  first server, and troubleshooting. Everything as separate commands moved to
  [Advanced installation](docs/advanced-install.md), which is not deprecated —
  it is what the installer runs.

### Files

- **Upload from the panel.** The Files page has an upload button and takes a
  drop onto the listing: one file at a time, up to 256 MB each, with a
  progress bar while it goes. A name already in the folder asks before it is
  written over. The node still writes beside the target and renames, so an
  upload that drops halfway leaves the file that was there, and every upload
  is in the audit log with its size — none of that is new, only the button is.
- **Download from the panel.** Every file's row has an arrow. The bytes stream
  from the node through the panel; nothing is held in either.
- A folder cannot be uploaded. Make it in the panel and drop the files into
  it, which is what the game wants anyway.
- **The file list is readable on a phone again.** Four columns of metadata had
  squeezed the name column to nothing below 1024px, so a listing showed sizes,
  dates and modes of files whose names were not on the screen.

## [0.2.0] — 2026-09-22

### Mods

- **Project Zomboid servers take Steam Workshop mods**, from a new **Mods** tab
  on a server. Search the Workshop in the panel — with pictures, sizes and
  subscriber counts — or paste an item's link, arrange the load order, switch
  one off without losing its download, and **Apply to server** writes the list
  into the game's own settings. The game downloads them itself, on the node:
  the panel never holds or forwards a mod's files.
- **Browsing needs a Steam Web API key.** Set `STEAM_API_KEY` on the panel to
  search; without it the tab still adds any mod by its Workshop link or id,
  which needs no key at all.
- **Upgrade the nodes.** The agent answers a new question — what a server
  downloaded, and which mod ids are inside each download, read from the files
  themselves — and accepts a mount one directory deeper, which is where
  Zomboid's Workshop downloads live. A panel on this release with an agent from
  `0.1.x` refuses to place servers on it, as the release-line rule says it
  should: upgrade the agent on each node the way it was installed.
- A game that does not declare how it takes mods shows the tab greyed out
  rather than an empty catalogue. Minecraft plugins are still not implemented.

### The panel

- **A server can be created past a node's capacity, on purpose.** Memory and
  CPU limits are ceilings on what a server may take rather than reservations
  of what it does take, so the create wizard now offers a checkbox where the
  node is short — naming the totals it would be committed to and what happens
  past them — and the API takes `"overcommit": true`. Each one is written to
  the audit log as `server.overcommitted` against the name of whoever asked.
  **Storage is not included**: a full disk stops every world on the node
  mid-write, so that refusal stands. Moving a server onto a full node still
  refuses outright.
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

### The documentation site

- **The site at <https://danielemarino70.github.io/Geeboard/> is built by this
  repository now**, by `docs-src/build.mjs`, instead of by Jekyll and a theme
  fetched from somebody else's repository. **Every address still answers** —
  `reference.html` and its twenty siblings keep their names — and every page
  still reads on GitHub as Markdown.
- **Installing on a server is the first page of the documentation.** The home
  page's main link goes there rather than to an index, and the navigation says
  which of the three kinds of reading a page belongs to: set it up, run it day
  to day, know how it is built. No page was rewritten and no section moved to
  another page.
- **The site needs nothing from the network to be read.** The stylesheet and
  both fonts are served from the site itself.
- **Nothing in `docs/` changed for a reader on GitHub.** Links between pages
  are still relative and still end in `.md`.

### The mark

- **Geeboard has its logo on it.** The panel's sidebar and its sign-in page
  carried a lightning bolt from an icon set; the browser tab carried the
  Next.js starter's favicon. Both are the mark now, and so are the
  documentation site, its link previews and the README.
- **The tab icon changes.** `web/src/app/favicon.ico` is gone and
  `web/src/app/icon.svg` takes its place. A browser that cached the old one
  shows it until it refetches; nothing else changes for an installation.
- **`web/public/` lost five unused files** from the Next.js starter —
  `next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`. Nothing
  referenced them.
- **The name and the mark are not covered by the AGPL grant.** The software
  stays AGPL-3.0-only and that does not change; what is new is
  [brand/LICENSE.txt](brand/LICENSE.txt), which says a fork may use the code
  and may not ship as Geeboard. Taking the mark off a fork is one directory
  and the list in [brand/README.md](brand/README.md).
- **Upload the social preview by hand.** GitHub has no file for it:
  *Settings → General → Social preview*, with `brand/og.png`.

### Node 24, and the dependencies with it

- **The images run Node 24.** Both `Dockerfile`s and the checks moved from 22,
  which leaves active support this October, to the line supported until April
  2028. Nothing about how you install or upgrade changes: the panel and the
  agent are containers, and the container carries its own Node.
- **A checkout needs Node 22 or newer**, and 24 is what everything here is
  built and tested with. Node 20 went end of life in April 2026 and the
  requirement in [docs/installation.md](docs/installation.md) said 20.
- **Next 16.3.5, React 19.3.0, lucide-react 1.47, tsx 4.23.15** and the
  matching type packages. Patch and minor releases only; nothing changes for
  an installation.

### If you run your own copy of the site

- **Set Pages to "GitHub Actions".** In *Settings → Pages*, the source has to
  change from *Deploy from a branch* to *GitHub Actions*, or
  `.github/workflows/docs.yml` will build and check the site and publish
  nothing. `docs/_config.yml` and the front matter at the top of each page are
  gone with this release, so a repository still set to *Deploy from a branch*
  serves the Markdown through Jekyll with no theme and no navigation.
- **Previewing the documentation is `cd docs-src && npm ci && node build.mjs`,
  then `node serve.mjs`** on <http://localhost:4000>, and no longer the
  `github-pages` gem in a Ruby container. See
  [docs/development.md](docs/development.md).

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
