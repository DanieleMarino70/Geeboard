# Changelog

What changed between releases, written for whoever installs and runs Geeboard.
Anything that changes a command you type, a file you edit, a port you open or a
step you have to take on the way up is in here; the reasoning behind it is in
[docs/roadmap.md](docs/roadmap.md).

Versions are semantic, and Geeboard is on `0.x`: **the minor is where a
breaking change lands** until 1.0. A panel and an agent work together when they
speak the same **contract** — a number each carries, raised only when one could no
longer read the other — or, for an agent from 0.4.0 or before, which sends none,
when they share a release line (`0.1.x` with `0.1.y`). The panel checks it when a
node joins and shows it on the node's page. Every release below says, in one
line, what its agent contract is and whether an agent upgrade is needed. See
[docs/nodes.md](docs/nodes.md#panel-and-agent-versions).

Dates are ISO, newest first.

## [Unreleased] — 0.9.0

*Work in progress: this section collects what 0.9.0 changes as each part lands, and is rewritten as one story at the cut.*

**Agent contract: 1, unchanged. Every change to the agent below is additive. Upgrade your agents all the same: the first
item is a fix for something anyone who can reach a node's port could do.**

### What changes for you

- **A server's page and its REST routes now answer to one table.** The page's own buttons asked "are you an owner, an admin, or
  the person who owns this server?" and never asked what your role may do, so a **member who had been given a server could delete
  it, change its settings, run and pause its tasks and type into its console**, and a **moderator who owned one could delete it**
  — each of which the REST API already refused. They are refused on the page now, with the API's sentence ("You do not have
  permission to do that."), and the buttons are no longer drawn: a member sees Start, Stop and Restart on their own servers and
  no "Back up now"; a moderator sees no delete; a server's tabs list only the sections you may open. If you relied on a
  moderator deleting their own server, an owner or an admin does it now.
- **Pointing a server at a name under the DNS zone the panel manages is an owner's or an admin's.** A moderator who owned a server
  could retarget its address to any name the DNS provider covers, which writes (and deletes) records with the workspace's token.
  An address outside the zone is still theirs to set.
- **A server with the restart policy "Restart whenever it stops" comes back after the machine restarts, and a server that does
  not come back says why.** A reboot, or Docker restarting, stops every container on the machine; the agent reads that as an
  ordinary stop on purpose (a game that never handles the signal is killed by the grace period, and that is not a crash), so
  after every reboot every server was down, whatever its policy said, and nothing on its page said why. The panel now starts
  an `ALWAYS` server that stopped without its asking, at once, and without using up the budget a crash loop needs (two reboots
  in an afternoon are not one). A server whose policy does not start it again (`ON_FAILURE`, `NEVER`) stays stopped, and its
  page says why it is down, what the panel knows about the cause and no more, and what to do. What it knows is a signal in
  the exit code (Docker or the machine), or the node's other servers stopping in the same pass ("points at the machine or
  Docker restarting"); a lone clean exit says nothing is known, because a Minecraft server that Docker stops exits with the
  same code 0 as one that quit. A stop you ask the panel for, including `stop` typed at the console from the panel, is never
  one of these.
- **A new notification: *a server was left stopped*.** One message for a server nobody asked to stop that its policy leaves
  down, several at once as one, with the same sentence the server's page has. A channel made from now on has it ticked; a channel
  made before keeps what it had, so **tick it on the channels that should hear about it** (Settings → Notifications). The webhook
  event is `server.left.stopped`. After a hard power loss Docker reports the servers that were running as exited with 255, which
  the panel reads as a crash, so an `ON_FAILURE` server also starts again then, by the crash path it already had.
- **Signing in, and getting back in, work on a Docker install and on a phone.** Seven messages told a panel installed by
  `install-panel.sh` to run `npm run admin:recover`, a script that exists only in a development checkout, so the one sentence
  a person reads when the one-day temporary password has run out named a command they did not have. They now name the one that
  exists for the way the panel was installed (`docker compose -f deploy/panel/docker-compose.yml run --rm panel recover`, with
  `--email` when the panel knows whose it is), shown apart from the sentence so it can be copied whole on a phone, and the
  sign-in page says how an owner who is locked out gets in, or, on a panel with no owner, how to make the first. The second
  sign-in step asked a phone for a numeric keypad, which has no letters, for a field that also takes a recovery code, and
  refused `123 456`, the way the authenticator app shows the code, after spending one of five attempts on it; it now asks for
  the text keyboard and takes the code however it is grouped. A link to a page (a message that says a server crashed) now ends
  on that page after sign-in and its second step instead of on the dashboard; a session that ended says so; the button that
  sets a password says what it does, and the sign-in after it has the address filled in; a failed sign-in no longer empties it.
  The installer's closing words stop saying "the temporary password above" when no owner was made, and say how to get a new one
  when there already was.
- **Ten wrong passwords typed by somebody else no longer lock you out of your own account, and an API key lives a year.** The
  sign-in limit counted ten tries a quarter hour per address from anywhere, so anybody who knew yours could lock you out for as long
  as they kept typing; it counts ten per address from each *source* now, thirty per source across addresses, and sixty per address
  over every source as the ceiling over many. The source is the last `X-Forwarded-For` entry, the one the proxy in front of the
  panel wrote, and not the first, which the client chooses: `GEEBOARD_TRUSTED_PROXIES` in `deploy/panel/.env` is how many proxies there
  are (1, which is the Caddy the installer sets up and the nginx block in the docs; **0 if you reach the panel directly**, where
  no header is believed and everybody is one source). The nginx block in the docs now writes `$remote_addr`, which replaces what
  a client sent; the old line works too. A key made from now on stops working **a year** after it is made (the API keys page shows
  the date; keys made before this release have none, as before), and **all of an account's keys are revoked** when an admin resets
  its password, when an owner runs `recover`, and by **Sign out other devices**, which says so: a key outlives the session that
  made it, and each of those exists for a password or a session in the wrong hands. Make a new key from the API keys page.
- **The Linux installer says what it checked, and refuses what would have failed three stages later.** Its last check ran on the machine
  itself and was described as "from outside", so on a provider that binds the public address on the network card (OVH, Hetzner,
  DigitalOcean) "HTTPS answering" meant nothing about the firewall; it now says it was asked from this machine, names the firewall it found
  (ufw, firewalld, an iptables policy that drops) with the command that opens 80 and 443, says when the machine is behind NAT, and closes
  by asking you to open the address from another machine. **`--check`**, on the panel's installer and on the node's, reports what the
  machine is (Docker and Compose and their flavour, whether Docker starts at boot, memory, disk, architecture, the clock, SELinux, the ports
  and who holds them, the firewall) and changes nothing; every normal run prints the same lines. **Refused before anything is changed:**
  a Docker installed as a snap, Compose v1, a port 80 or 443 that something else holds (named, where Caddy used to fail to start while the
  installer said "HTTPS active"), and, for a node, an agent port that something else holds (Wings and AMP like 8080). A Caddy that is not
  running after its configuration was written is an error with its own log lines. **A Caddyfile that serves files, runs PHP, redirects or
  imports is left alone** (the site block is printed); it used to be replaced unless it had a `reverse_proxy` line, and a static site on the
  same Caddy lost its configuration at the reload. **An IPv6 address works for `--ip`**: bracketed once (`PANEL_URL=https://[2001:db8::1]`),
  where a bare one built a URL Node refuses; `is_ipv6` no longer accepts `:` and `1:2`. A domain's A and AAAA records are both read, and an
  AAAA that points at another server, which makes Let's Encrypt fail while the A record is right, is said before the certificate is asked for.
  Package-manager failures keep their last lines and wait for a new machine's dpkg lock; a failed pull is tried three times, a copy of the image
  already on the machine is used before a build, and a build says what it needs; a failed `compose up` ends in a sentence. A node join the panel
  refuses says why; a panel that does not answer is found before the image is downloaded. Everything either installer prints is also written,
  without colours, to `/var/log/geeboard-install.log` (root only), its temporary files live in a directory of their own removed however it ends,
  `--domain` with no value is an error and not a silent exit, and the agent's unit starts the `docker` that was found, with `--init` and a capped
  log. `shellcheck -S warning` is clean on every script in `deploy/` and CI keeps it so.

### Security

- **Server operations on a page check the permission table.** See "What changes for you": a member given a server could do on
  the page what only an owner or an admin may do over HTTP. Held now by one table of who may do what, a test of it, and a
  verification that replays each page action as each role.
- **The agent no longer dies of a request of one line.** `GET //[ HTTP/1.1`, sent to a node's port with no token at all,
  made the agent throw before it had checked who was asking, and it exited (in every release so far; on Linux systemd brought it
  back after five seconds and every console, backup and upload in flight was gone; on Windows nothing brings it back).
  A request target the agent cannot route is now a `400` and the same process keeps answering; a download whose client went
  away no longer ends the process either; and anything unforeseen that does reach the top is written as one structured line,
  then the agent exits with a code a supervisor restarts on.
- **An address nobody has no longer answers faster than one somebody has.** The dummy hash an unknown address was compared against was 65
  characters, which bcrypt refuses outright, so it answered in 0.01 ms against 264 ms for a real one, the opposite of what the
  documentation said, and "does this account exist" was a stopwatch. Measured now: medians of 258.3 and 258.7 ms over fifty sign-ins each.
- **Reading a stored secret no longer stops the panel for 30 ms.** The key was derived with scrypt on every read, by every page that touched
  a node, a bucket, a DNS provider or a notification channel, by the poller for every node on every pass, and by the heartbeat before it
  compared the token: about 33 bad heartbeats a second, from anybody who knew a node's name, kept a core busy and stopped the panel
  answering anyone. It is derived once (0.01 ms a read now), and the heartbeat and registration routes refuse a source that has failed
  thirty (ten for registration) times in a minute without reading its request, whatever it puts in the first `X-Forwarded-For` entry.
  A node whose real token is proved is never refused because a stranger guessed at its name. An API key's bcrypt compare (73 ms of
  stopped panel, a hundred times a minute for a client that polls) is remembered for five minutes, and the row is still read each
  time, so a revoked key is refused at once.
- **Every response carries security headers.** `X-Content-Type-Options`, `X-Frame-Options: DENY` and `frame-ancestors 'none'`, a referrer
  policy (never `no-referrer`, which would make every POST's `Origin` `null`), a permissions policy, and no `X-Powered-By`; a panel at a
  **name over https** also sends HSTS for a year (an address, plain http and localhost do not). A script policy with nonces is not set yet.
- **A request that changes something and carries only a cookie has to come from the panel's own pages.** `POST`, `PUT`, `PATCH` and
  `DELETE` under `/api/v1` check `Origin` and, with a body, that it is JSON; a request with an API key is not asked. Nothing in the product
  sent one; this is for a script that copied a cookie, and for a stranger's page.
- **Smaller:** a node's address at registration is refused if it is the cloud metadata service or another link-local, multicast or unspecified
  address, or has a password written into it (the token is not spent, so the command can be run again); a carriage return inside a console
  command is refused, in the panel and in the agent, as a newline was; recovery codes are a salted scrypt hash and not SHA-256 (the ones you
  have still work; make new ones from the account page to move them); the audit export's cells that begin with a tab or a carriage return are
  made text too, and a carriage return inside a cell no longer ends the row; the Terminal page tells a member that it is for owners instead
  of "No nodes yet" and a link to add one.

### Upgrading

- **An upgrade takes a dump first, and says how to go back.** Re-running `install-panel.sh` is the upgrade, and it ran `migrate`
  under the old panel and poller, with no copy of the database, said "no data was changed" when a migration failed, and printed nothing
  about undoing it. A panel that is already running is now looked at for operations in flight, stopped (the poller gets two minutes to
  finish a pass), dumped into `/var/backups/geeboard/` (root only, read back before it is believed, with the secrets file beside it),
  migrated once with Prisma's output kept and each migration's time shown, started, and the commands that undo it are printed — they were
  run as printed on a real machine, and the data came back as it was. A migration that fails leaves the panel and the poller stopped and says the
  database may be partly changed. `--no-backup`, `--backup-dir <dir>` and `--force`; `docs/upgrading.md` is one procedure now.
- **A panel on a database that is not at its schema says so and does not start.** A release behind (nobody ran `migrate`), a release ahead
  (a newer image migrated it and an older one was started), a migration that did not finish: one sentence and the command, from the panel and
  the poller, and on every page of a panel that is already running, instead of "something went wrong, trying again usually works".
  `panel status` and `panel resolve` are new verbs of the image; `panel migrate` ends with an offline catalog sync. `npm run verify:upgrade`
  builds the database 0.4.1 left, applies this checkout's migrations to it and checks every count, the DNS records the 0.7.0 migration copies,
  `prisma migrate diff`, and a migration that fails and is put right.
- **A re-run reads the machine it runs on.** A panel on a domain stays on its domain: a bare re-run or `--yes` used to take the default
  answer to "do you have a domain?" and rewrite a Let's Encrypt site as `tls internal`, taking every remote node off the panel while the
  installer's own check passed. The mode is recorded in `deploy/panel/.env` (`PANEL_TLS_MODE`, `ACME_EMAIL`; an older install is read from
  its Caddyfile). An agent on the same machine is upgraded with the panel, with its version before and after and its contract (it was
  "Not a node"); a missing `.env` beside the database volume stops the run before it writes new secrets; registering this machine under
  the name of a node that exists asks first (refused under `--yes`); the last words say *installed*, *upgraded from X to Y* or *already here*,
  and a checkout that is not at a release tag is warned about.
- The compose file gives the poller two minutes to stop and the panel thirty seconds (it was ten for both: a poller in the middle of a scheduled
  backup was killed by `docker compose stop`), and pins Postgres by digest, so **the first `up -d` after this release recreates the database
  container**. Its volume is untouched. A checkout made before 0.9.0 has scripts recorded without the execute bit and `git pull` refuses over
  them; `git config core.fileMode false` once, then pull again. `docs/upgrading.md` says it first.

### Backups and restores

- **The cleanup no longer removes good backups because of failed ones.** It kept "the newest N rows", and a row can be a backup that
  failed: seven days of failures (a disk that filled, a node whose uplink to the bucket was cut) left seven failed rows in seven
  slots and every good backup older than them was removed. It counts complete backups only, removes failed ones after a week
  with whatever archive they left, and never touches a running or a locked one.
- **A restore that cannot finish changes nothing.** The archive is unpacked beside the world and the two are exchanged only when it
  is whole. Before, the world was emptied first: a truncated archive replaced it with a partial one, and a missing archive removed it
  and made the agent exit. Now the answer says *Nothing was changed*, and the server goes back to what it was doing. A node without
  room for two copies refuses with the numbers and offers **restore in place** (a checkbox; `"inPlace": true` over the API), which
  removes the world first and says plainly that a failure then leaves it incomplete. The agent moves a world back that a power cut
  left set aside between the two renames.
- **A backup the disk cannot hold is refused with the numbers,** not allowed to fill the disk every world on the node writes to; the
  floor kept free is the larger of 2 GB and 5 percent (`GEEBOARD_BACKUP_FLOOR_BYTES`). A world that is being written to is archived
  as each file was when it was opened and the result lists what changed, instead of failing the backup (nineteen of twenty failed on a
  server with a busy log). An archive is written under a `.partial` name and listed only when whole, so a process killed mid-backup
  no longer leaves a file that looks like a backup; what a kill leaves is removed at start. A failed off-site upload is retried, and
  the archive is kept as a local backup rather than left on the node with no row.
- **What changes for you:** an agent before 0.9 still empties the world first. The panel works with it, but the restore guarantees
  above need the new agent: upgrade your nodes. The failed-backup rows older than a week are removed by the next cleanup.

### Tooling and the project's own checks

- **A verify script refuses a database that is not named for verification.** `npm run verify` from the wrong directory replaced a
  running demo with the sample workspace on 2026-09-20; one of about two dozen scripts refused it. All of them do now, naming the
  script and the database; `db:reset` and `db:seed` ask for the database's name. Set `GEEBOARD_VERIFY_ANY_DB=1` or
  `GEEBOARD_CONFIRM_DB=<name>` to mean it.
- **`npm run verify` goes on after a failure** and ends with a table, instead of stopping at the first. Two scripts had failed for
  three pushes, one behind the other. The development database's port is bound to this machine only.
- **CI is pinned and narrower.** Every job runs on `ubuntu-24.04` (the `ubuntu-latest` label moves to 26.04 from 2026-10-19), with a
  26.04 leg beside it that may fail without failing the run; Node 22, the floor the documentation promises, runs the type check and
  the unit tests; the actions are on their current majors; a job has a timeout, the workflow reads the repository and a tag run's
  install of npm packages no longer sits next to a token that can publish. `.github/dependabot.yml` and a weekly advisory job
  (`scripts/audit-gate.mjs`, with the advisories somebody has read in `.github/audit-allow.json`) watch the dependencies.
- `next` 16.3.8 (0.8.1 shipped 16.3.5, which has a critical advisory in `next/og`, a route the panel does not use), `sharp`,
  `source-map-js`, `fast-uri` and the agent's `@grpc/grpc-js` 1.14.5; both packages declare Node 22 or newer and approve the
  install scripts they rely on (`allowScripts`). The base images are pinned by digest. `SECURITY.md` says how to report a
  vulnerability and which versions are fixed. `daemon/src/provision.ts` had a raw NUL byte in a regex, which made git treat it as
  binary and hid it from every diff and search; it is written as an escape and CI fails on any other.

### Changed in the agent

- **Stopping is quick.** `systemctl restart geeboard-agent` with a console open took 30 s (it waited for the browser to let go
  and ended in SIGKILL); it now takes under a second: open console and terminal streams are closed at once, a request in
  flight gets 20 s to finish, and a request that would change something is refused with `503` and `Retry-After` meanwhile.
- **A second agent on a taken port says so, once, and is not restarted.** It prints the sentence, exits with code 78 and the
  unit's new `RestartPreventExitStatus=78` leaves it stopped, instead of a restart every five seconds for ever. Re-install
  the unit with `sudo bash deploy/linux/install.sh` to get the line.
- **A file the editor can open can be saved.** The body limit of 64 KiB applied to saving a file too, so a config the panel
  opened at 100 KB could not be written back; it is now sized for the editor's 2 MB.
- **A long upload is not cut at five minutes.** A 200 MB file over a 4 Mbit/s line needs about seven; the request as a whole is
  now bounded at an hour and a connection that stops sending is cut after two minutes.
- **A typo in a number is a sentence at start.** `GEEBOARD_PULL_STALL_MS=2min` used to make every pull "stalled" within five
  seconds; every numeric setting is now checked when the agent starts, and a bad one names the variable.
- Smaller: bad JSON is a `400`, not a `500`; `/health` gives up on a hung Docker after five seconds; a create on a node whose Docker is not
  answering says so instead of asking you to pull an image the node already has; a console that closes while the engine is
  still answering no longer leaves a log stream running.

## [0.8.1] — 2026-10-06

**The release you can install: 0.8.0 was tagged and never published.** 0.8.1 is 0.8.0 with the project's own
checks repaired. Nothing in the panel or in the agent changed.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.0, 0.4.1, 0.5.0, 0.6.0, 0.7.0 or
0.8.0.** The agent in 0.8.1 is the 0.4.1 agent with its version moved, because a release tags the panel and
the agent together.

### Why there is no 0.8.0 image

A tag publishes the panel and the agent to GHCR only after the whole of CI passes, and the panel's CI job had been
failing since 0.5.0. `verify:templates`, which 0.5.0 added to `npm run verify`, starts a real agent from `daemon/`,
and the job had never installed the agent's packages: it timed out waiting for it. `verify:community`, after it in the
chain, refuses any database not named `geeboard_verify`, which the job's was not. Both pass on a machine that has the
agent's packages and a database so named, which is why neither showed locally. So **no image was published for 0.5.0 or
0.8.0**, and `v0.6.0` and `v0.7.0` were never pushed. 0.8.1 has everything the four of them changed.

### Upgrading

**From 0.4.1 or any earlier release, go straight to 0.8.1.** The migrations of each release in between are applied in
order by `panel migrate`, and [docs/upgrading.md](docs/upgrading.md) has what each one asks of you: read the sections
from your version up to 0.8, and **back up the database first**. The panel image is
`ghcr.io/danielemarino70/geeboard-panel:0.8.1`.

### Fixed

- The panel job of CI installs the agent's packages, and its database is named `geeboard_verify`. It runs the whole of
  `npm run verify` and the production build again, and a tag can be released.

## [0.8.0] — 2026-10-04

*Tagged as `v0.8.0`, but its release checks failed and no image was published: install 0.8.1, which is this with the checks repaired.*

**A third DNS provider, which is any DNS you can reach with a small program of your own, and an off-site
bucket that says what each store asks for.** Two things that do not depend on each other: a webhook that
tells a receiver to set or remove a server's records, and a storage form that knows Backblaze B2, Amazon S3 and
Cloudflare R2 by name — and a stand-in store for the verification that can be pulled again.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.0, 0.4.1, 0.5.0, 0.6.0 or 0.7.0.** The
agent in 0.8.0 is the 0.4.1 agent with its version moved, because a release tags the panel and the agent
together.

### DNS

- **A webhook as a DNS provider.** For BIND, Knot, PowerDNS, a router, or a host with an API of its own, the
  panel does not write the records: it sends a receiver you run `dns.set` and `dns.remove`, signed as a
  notification is, each of them something that can be said twice, and the receiver does the writing. The
  DNS page makes the signing secret in the form and shows it once, **before** the receiver has to hold it,
  because a receiver that checks signatures cannot answer the test that saves the provider without it; nothing is
  saved unless the receiver answers that signed `dns.test` with `2xx`. The panel sends **what changed** and not
  everything again, an `SRV` too, and the receiver decides what it keeps. A record there is **accepted**, not
  *written*: a `2xx` says the receiver will act, and the panel cannot look at your DNS. See
  [docs/dns-webhook.md](docs/dns-webhook.md), which has the contract, what each status means, and a receiver that
  runs `nsupdate` in about a hundred lines — [`examples/dns-webhook/receiver.mjs`](examples/dns-webhook/receiver.mjs),
  a file the page and a test hold to be one.
- **It goes out under a notification webhook's rules and no looser ones**: https to a public address, or a private
  network and plain http when the operator has set `GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1`; every address its name
  resolves to judged; no redirects; a five-second timeout; and the answer read for its status alone, never kept or
  shown. The address is stored encrypted beside the secret, and `rekey` seals both.
- **A receiver that is not there is waited for once.** Creating, moving and deleting a server wait for the call.
  The poller now leaves the rest of a pass alone after a provider could not be asked at all, and does not ask again for
  five minutes: measured with a receiver that never answers, a pass over six servers took 5.1 seconds.
- **The provider kinds are a table**, not a `cloudflare ? … : DuckDNS` in a dozen places: what each can hold (an SRV),
  whether it can be read, and what the panel may call a record it took. A kind that is not in the table is an error
  and is no longer taken for DuckDNS, and the wizard's and the settings' hints follow the kind and not the zone's name.

### Off-site storage

- **The form asks where the bucket is.** Amazon S3, Backblaze B2, Cloudflare R2, or a self-hosted store, each with what it
  asks for from its provider's documentation. **The region follows the endpoint** where the endpoint carries it, and a
  region that contradicts it is refused before anything is sent, with the one it says: a wrong one came back as
  `SignatureDoesNotMatch`, which does not say which part was wrong. A store's refusal is explained where there is
  something to do (`RequestTimeTooSkewed` is the panel's clock). The form says, for a provider Geeboard has not been run
  against, that the first save — a test upload and its delete — is the test.
- **Run against a real Backblaze B2 bucket, which found a bug.** The panel's own test upload was sent chunked, and
  Backblaze answers that with `411 MissingContentLength`; MinIO and SeaweedFS take it, so no store the panel had been run
  against could have shown it, and a first save at Backblaze could not have worked. A body now goes with its length, in the
  notification webhooks and the DNS webhook too. Then the off-site half of `verify:backups` passed against the bucket —
  147 checks, virtual-hosted and again path-style. Amazon S3 and Cloudflare R2 were not run. A bucket that keeps old versions
  keeps a deleted backup: measured at Backblaze, with the lifecycle rule *keep only the last version*, a deleted archive is
  still there, hidden, until a day after, and the form and [docs/backups.md](docs/backups.md#which-store) say so.
- **`npm run verify:backups` runs again.** Its stand-in store was MinIO, whose image can no longer be pulled; it is
  SeaweedFS, pinned, which checks signed requests and presigned URLs as a real one does. With `GEEBOARD_VERIFY_STORE`
  naming a JSON file kept outside the repository it runs the same half against a hosted bucket instead
  ([docs/field-checks.md](docs/field-checks.md#off-site-backups-against-a-real-provider)).

### Also

- **A good community manifest is no longer refused because the machine was busy.** The checker runs each regular
  expression against lines built to hurt it, with 40 milliseconds to answer, and the clock that cuts it off fires when
  its thread is not scheduled as much as when the expression is slow. A line is now tried three times and an expression
  is called slow only if it is on every try; a backtracking one is still cut off each time, and still refused.

### Upgrading

One migration, which `panel migrate` applies and which moves no data: a DNS provider gets a column for a webhook's
address, empty for the provider you have. A saved bucket is untouched; saving one again with an Amazon or Backblaze
endpoint and the wrong region is now refused with the right one. See [docs/upgrading.md](docs/upgrading.md).

## [0.7.0] — 2026-10-03

**A Minecraft server is reached by its name alone, and the panel keeps a month of what a server and
a node have been doing.** Two things that do not depend on each other: the records behind an address —
IPv4, IPv6, and an SRV record that carries the port — and the history of servers and nodes, now with the
network in it.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.0, 0.4.1, 0.5.0 or 0.6.0.** The
agent in 0.7.0 is the 0.4.1 agent with its version moved, because a release tags the panel and the agent
together. The network figures the new charts draw were always in what the agent returns; the panel
threw them away.

### The address

- **An SRV record for Minecraft: Java Edition, on Cloudflare.** Given a name with no port, the Java client
  asks DNS for `_minecraft._tcp.<name>`. The panel now writes that record, `0 5 <port> <name>`, with the port of
  the block the server holds, and keeps it: written as the server is created, moved to the new port when the
  server moves, removed with it. A second Java server on a node, which holds 25568 and not 25565, and one that
  moved to another node, are reached by the name alone, and the server's page says *found by SRV* beside the
  port and shows the name without it. DuckDNS cannot hold an SRV record, and there a Java server is `name:port` as
  before. Bedrock's client does not look one up. A community game's manifest cannot ask for one: it would write
  into the owner's own zone. See [docs/servers.md](docs/servers.md#dns).
- **IPv6.** A node has a *Public IPv6 address* beside its public address, set in *Configure*. With one, every
  server on it gets an AAAA record beside its A record — at Cloudflare as a record, at DuckDNS as the subdomain's
  IPv6 address — and loses it again when the address is taken away. **It is never guessed:** the address the
  panel observed is not taken for the other family, since nothing says the Internet can reach it. An A and an
  AAAA at one name used to be refused as *two records*; they are now decided each on its own.
- **One row for each record.** A server's record was four columns for one address; it is now a table with a row
  for each of A, AAAA and SRV, each with the name it is at, so a record is removed from where it was written even
  after the server's address changed. The DNS page lists them, the server's page names them, and the API's `dns`
  carries `records` and `byName`, and the server's `address` carries `srv`. The wizard's review says what the
  players will type.

### History

- **Network, and thirty days, in the charts.** A server's *Resource usage* is now CPU, memory, network and — once it
  has been measured — the world's size, one panel for each, each with a scale and axis of its own rather than two
  scales on one chart; a crosshair that reads every panel at one moment; the peak beside an average; a gap where
  the server was not running; and a table of the same numbers under it. Windows are 1 hour, 6 hours, 24 hours,
  7 days and, new, 30 days.
- **A node keeps its history.** CPU, memory, storage and the round trip from the panel, for thirty days, in a
  chart on the node's page. A node the poller could not reach has a gap where it was silent.
- **Two API routes.** `GET /api/v1/servers/:id/metrics` and `GET /api/v1/nodes/:name/metrics`, with
  `?range=`, at most 120 buckets with the units in the names. The first is under `metrics:read`, which until now opened
  nothing; the second under `node.read`. The documentation had promised metrics history as server-sent events under
  `/api/servers/:slug`; there were none, and it no longer says so.
- **Read where the rows are.** A chart's buckets are made by the database and not by the page: the week of one
  server that took 160 ms to read took 20, and the thirty days the new window needs take about 190.
- **Docker's network counters start again at every restart**, which the panel measured and takes account of: a
  restart is not a drop to nothing and not a day's traffic in one sample.
- `tps`, which was written as the constant 20 and read by nothing, is gone.

### Also

- **`npm run manifest:check`**, from a checkout, runs the community-game checker on files and directories, with
  `--registries` and `--json`, and exits 0, 1 or 2. It is for somebody writing a manifest with no panel to paste it
  into, and for a repository that collects them. It came after the `v0.6.0` tag.
  See [docs/community-games.md](docs/community-games.md#checking-a-manifest-without-a-panel).
- **Palworld's parked definition** named a query port it did not have, which the registry's audit would have refused
  had the game been offered. It has the port, and every definition, parked ones included, is now held to the audit.
- `GEEBOARD_SAMPLE_MS` was documented as the agent's sampling interval and drove nothing; the documentation says so.

### Upgrading

Two migrations, which `panel migrate` applies. **The first moves data**: each server's written DNS record is
copied into the new table before the four columns are dropped, and nothing is written to or asked of a provider.
**Back up the database first**, as for every release: the columns do not come back. The second adds the network and
disk columns to the samples, a table of node samples, and the fields network counters are differenced from, and
drops `tps`. History from before the upgrade has no network figures. A node's *Public IPv6 address* is empty,
and nothing changes about a record until somebody sets one; Minecraft: Java servers on Cloudflare get their SRV
record on the poller's next pass. See [docs/upgrading.md](docs/upgrading.md).

## [0.6.0] — 2026-10-03

**A game somebody else wrote can run on your nodes — if an owner has read what it
would do, an authenticator code says yes, and the machine agreed.** Community
games: a *manifest*, which is a game definition in JSON naming a container image,
proposed from a page, approved by an owner, and placed only on a node whose
machine said it will take one. Nothing is fetched from the Internet to make one.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.0, 0.4.1 or
0.5.0.** The agent in 0.6.0 is the 0.4.1 agent with its version moved, because a
release tags the panel and the agent together; the node's page says *contract 1*
beside its version. What the agent already refused it still refuses — it builds
every container from a fixed list of options, and a test now holds that list.

### Community games

- **A manifest is a game definition, as JSON.** The eight games Geeboard ships all
  survive that round trip unchanged, so there is no second format. A new page,
  **Games → Community games**, for owners and admins, takes one pasted or chosen from a
  file, checks it, and says what is wrong with it by the path of the field —
  `versions[0].image` — or keeps it as a *revision* that is waiting. A waiting revision
  runs nothing, is in no wizard and is on no node. See
  [docs/community-games.md](docs/community-games.md), which has the format, the rules
  and why each is there, and a real example: Factorio.
- **An owner approves, with a fresh code from their authenticator**, after a page shows
  what it would do rather than what it says it is: the image to its digest, the
  arguments and environment it starts with, the ports and who can reach each, the
  folders, the limits, every word typed at its console, the files written, every
  setting and where it lands, every regular expression, and — in plain sentences — what
  an image can and cannot do on the node. The approval is bound to the SHA-256 of the
  manifest that was read, and the manifest is checked again at that moment. Only an owner
  can approve; an admin can propose, turn one down and retire one. **No API key can do
  any of these.**
- **Revisions and retiring.** A newer revision replaces the approved one when it is
  approved; there is never more than one. *Retire* takes a game out of the wizard,
  templates and clones; its servers keep running and can be managed, and say
  *community · retired*. A retired game can be proposed again.
- **In the wizard, the Games page and a server's page it says *community*.** On the
  placement step a node that has not agreed is listed as *cannot run this game — Missing
  Community games*.
- **The API** lists a community game with `"community": true`, `"official": false` and the
  `revision` that is approved, by number and hash. There is no route to propose or approve
  one.

### What a manifest cannot say

- **An image is named by its digest.** `registry/name:tag@sha256:…`: a tag moves and a digest
  cannot, so what an owner read is what runs. The registry has to be on the owner's list,
  `docker.io` and `ghcr.io` to begin with, which the owner can change; the agent would pull from
  anywhere, so the panel holds this line.
- **No mods, no download, no Steam branch**, versions only from the manifest, install only
  from an image. No port the panel, the agent, the proxy or the machine use, none below 1024.
  No file written outside the server's folder, no variable that begins `GEEBOARD_`, no
  setting written into a JSON file (the panel cannot write one yet, and a game approved and then
  not creatable would be worse than a refusal). A field the panel does not know is an error.
- **Every regular expression is checked three times.** A static rule at proposal (no
  back-references or look-behind, bounded repeats, no repeat inside an unbounded group), a
  timed run against lines built to hurt it at proposal and again at approval, and a guard at
  run time for the patterns of an approved game: each line cut to 2000 characters, each
  match stopped after 25 ms. `^(a+)+$` freezes the panel for 22 seconds on 32 characters;
  none of the 36 patterns Geeboard ships fails the rule.

### Nodes

- **A node takes a community game only if its machine says so.** The capability is
  `community-games`, declared on the machine: `--community-games` on the Linux installer,
  `-CommunityGames` on the Windows one, which are `--capabilities community-games` for the
  join. **The panel has no switch for it**: *Add a node* offers no checkbox and its command
  never carries the flag. The pending-node card and the node's page say what it means. A node
  that already joined adds it to what it declares, as
  [docs/community-games.md](docs/community-games.md#the-node) says.
- **`deploy/linux/container-firewall.sh`**, new, closes the node's side: a container no longer
  reaches `169.254.169.254` (the cloud provider's metadata service), or the node's SSH and
  agent ports. Three rules, each commented so `remove` takes away exactly what `add` put;
  `status` says which are present. Tested on a real Linux machine before and after, with a
  game's published port, DNS and the Internet unaffected. It is not run by the installer.

### What this does not do

- **It is not a sandbox, and the approval page says so.** An approved image runs as root in
  its container with Docker's default capabilities and reaches the Internet and the node's
  own network: measured from a container on a real node, the node's SSH, the agent's port,
  the proxy and the cloud metadata service all answered. That is true of every game Geeboard
  hosts. A digest says which bytes run and not what they do.

### Upgrading

One migration, which `panel migrate` applies: two tables, for the revisions of community
games and for the owner's list of registries. Nothing changes until somebody proposes a game,
and no node declares `community-games` after an upgrade. Two permissions are new —
`community.propose` for owners and admins, `community.approve` for owners — and in no API scope.
See [docs/upgrading.md](docs/upgrading.md).

## [0.5.0] — 2026-10-02

**The panel can tell you what it knows, and a server that went well can be used
again.** Two things that do not depend on each other: notifications to Discord and
to webhooks, and templates of your own with a clone of a server.

**Agent contract: 1, unchanged. No agent upgrade is needed from 0.4.0 or 0.4.1.**
The agent in 0.5.0 is the 0.4.1 agent with its version moved, because a release
tags the panel and the agent together; an agent that is already running goes on
working, and the node's page says *contract 1* beside its version.

### Notifications

- **Discord and webhooks, for six things that need a person.** A server crashed
  (with whether the panel restarted it), the panel gave up restarting one, a node
  went offline or came back, a backup failed or is damaged, an update is available.
  A new **Notifications** page, under Infrastructure and for owners and admins, adds
  a channel: pick Discord or a webhook, paste its address, tick what it should hear
  and send a test; it is saved only if the test goes through. With no channel nothing
  is sent and nothing about a server changes. There is no email: the project has no
  mail server. See [docs/notifications.md](docs/notifications.md).
- **They are made from what the panel already writes to its audit log**, after the
  fact, so nothing that starts or stops a server knows about them. A crash the panel
  puts right is one message and not two; servers that fall over together because a
  host restarted are one message naming them; a backup that failed because its node
  is down is not sent as a second alarm; a channel is sent at most ten messages a
  minute, with one notice saying how many were held back. A server that stops without
  crashing — somebody typed `stop` at its console — is not announced, since the panel
  cannot tell it from one that went wrong.
- **Delivery is at least once**, from the poller, beside its pass and not in it: a
  failure that could pass is tried again after a minute, five and thirty, one that
  would not is final, and a message a day old is not sent. The page lists the latest
  messages with their state and why.
- **A webhook's messages are signed.** `X-Geeboard-Signature` is an HMAC-SHA256 of
  the timestamp and the body with a key made with the channel and shown once; the
  JSON is documented and changes only by adding. A Discord message is an embed that
  cannot ping anybody or carry a link of its name's choosing.
- **Update available is now a fact the panel records**, once for each server and each
  version it could move to, written as a *server.update.available* line after each
  catalog sync. It was a calculation made when a page was drawn.

### Templates and cloning

- **Templates of your own.** *Reuse this server*, on a server's Settings page, keeps
  its settings, limits and version under a name; the new **Templates** page, under
  Catalog, lists them, and *Create a server* on one opens the wizard on its game and
  version with those values. A template does not keep the world, the players, the
  address, the schedule, a join password, or a setting that names a file in the
  server's own folder (Terraria's world file): the page says which it left behind.
  Deleting one touches no server made from it. See
  [docs/servers.md](docs/servers.md#templates-and-cloning).
- **Clone a server.** *Clone* opens the wizard filled in from a server, named *… copy*.
  With an off-site bucket set up, the review step offers to copy the world too: a
  backup of the source goes into the bucket and is restored into the new server, with
  the source left running. It is two steps and not one — if the world cannot be put
  in, the new server stays, on the world it was created with, and the message says
  why. Without a bucket the copy gets the settings and a new world. A server made from
  a template or a clone says so in its creation line in the audit log.

### Security

- **A webhook may not call just anything.** The panel calls a webhook from inside its
  own network, where the database, the agent and a VPS's metadata service answer, so
  Discord is accepted only at the addresses Discord issues and a webhook only over
  `https` to public addresses. A name is looked up once, every address it gives is
  judged, and the call goes to one of them — not to a second lookup, which is how DNS
  rebinding walks round a check. A redirect is never followed, the answer is read for
  its status and no more, and a failure says a fixed phrase and the host, never the
  address or the token. This machine itself and link-local or cloud metadata addresses
  are refused in every spelling and in every setting.
- **`GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1`** is the one thing that widens it, for ntfy or
  Home Assistant on the LAN: private networks, and plain `http` there. It is set in the
  panel's environment by the person who owns the machine and is not a setting on a
  page, on purpose. The compose file passes it through, empty by default.
- **The off-site bucket's address gets the same guard.** It was called, signed, at
  whatever an owner or admin typed, with a few lines of the answer shown in the error.
  Now link-local and cloud metadata addresses, the unspecified address and the
  multicast and reserved ranges are refused, and no redirect is followed; a store on
  this machine, in the same Docker network or on the LAN — the usual way to run it —
  is unaffected. An endpoint saved before this that falls in a refused range is not
  deleted: the panel will not call it, and says so when the bucket is checked.
- **`rekey` covers the new secrets.** A channel's address and a webhook's signing key
  are sealed with `SECRETS_KEY` and re-sealed with it; `verify:rekey` proves both.

### Upgrading

Two migrations, which `panel migrate` applies: the notification channels, their queue
and cursor, and a column for the update each server was last told about; and the saved
templates. Nothing is sent until a channel is added. A new optional variable,
`GEEBOARD_WEBHOOK_ALLOW_PRIVATE`, is passed through by `deploy/panel/docker-compose.yml`.

## [0.4.1] — 2026-10-01

**Closed gaps, and no new feature.** This is 0.4.0 made sturdier, found by reading
the code and then by trying to break it; `docs/roadmap.md` has what was measured.
Same release line as 0.4.0.

**Agent contract: 1, reported for the first time. No agent upgrade is needed from
0.4.0.** An agent on 0.4.0 is on the same release line as this panel, so it stays
compatible; it does not send a contract until it is upgraded, and is judged by its
line until then. The agent in 0.4.1 is the 0.4.0 agent plus the number.

### Nodes

- **Agents are told apart by a contract number, not by the release they are.** The
  release-line rule made every minor an upgrade of every agent, including the ones
  that had not changed — 0.4.0 shipped an agent with no code change in it because
  the panel's line had moved. The agent now sends an integer, its *contract*, with
  its version: in its registration, in every heartbeat and in `GET /version`. The
  panel works with an agent that speaks the same number, whatever release it is, and
  only raises its own when a panel and an agent one number apart would misread each
  other. An agent that sends none — every one up to 0.4.0 — is judged by its release
  line exactly as before; the first upgrade to 0.4.1 or later is the last one that
  rule forces on it. The node's page shows the contract after the version, the
  column `nodes.contract` holds it, `GET /api/v1/nodes` has it as `agentContract`,
  and every refusal and banner says which of the two criteria decided. One migration
  adds the column. See [docs/nodes.md](docs/nodes.md#panel-and-agent-versions).

### Servers

- **An address is a name, and has one owner.** Creating a server stored its
  address as typed and compared it exactly, so `Aurora.example.com` and
  `aurora.example.com` made two servers on one name — which, with a DNS provider,
  is two servers fighting over one record — and two creates at the same moment on
  different nodes both went in, five pairs in six. The address is lower-cased
  where it is written now, and the database refuses a second one. The one who loses
  is told *Address in use*. A lost port is tried again instead of being reported as
  "just taken", which is what it was being read as.
- **A create the panel did not live to finish is an error, not "Installing" for
  ever.** If the panel was stopped in the middle of a create, the server's row said
  `INSTALLING` with no workload, and nothing read it again: no error, nothing to do.
  After ten minutes without its row being written — a live create writes it every
  second and a half during a download — the poller turns it into an error that says
  where the create had got to and what to do: delete it from its Settings page, which
  clears what the node was left holding, and create it again. Nothing is deleted for
  anybody, and the audit log has a line for it. Only a create; see
  [limitations.md](docs/limitations.md#interrupted-operations).
- **The migration stops if it would have to choose.** If two servers already share
  an address, case aside, `panel migrate` stops with their names and does nothing
  else: change the address of all but one of each in the panel, and run it again.
  Otherwise it lower-cases the addresses it finds.

### Node terminal

- **No terminal over plain HTTP across the Internet.** A terminal carries what is
  typed and what the shell prints, passwords included, and the panel reaches most
  agents over plain HTTP — which was fine on a private network and is not across the
  Internet, and nothing stopped it. An agent reached with `http:` at a public address
  now gets no terminal: the page says why and what to do, before any code is asked for.
  A private or loopback address is still allowed over `http:`, and `https:` is allowed
  anywhere. A name, which can point anywhere, is treated as a public address over
  `http:` — `localhost` too: register such a node by its IP address, or put TLS in
  front of its agent. **A node with a public address has a terminal only if its agent
  is reached over HTTPS.** See [docs/security.md](docs/security.md#node-terminal).

### Security

- **`rekey` changes the key stored secrets are sealed with, without losing them.**
  Editing `SECRETS_KEY` used to make every stored secret unreadable at once — the
  nodes' tokens, the off-site bucket's key, the Steam key, a DNS provider's token, every
  account's two-factor secret — and the only way out was to register every node again
  and set the rest up again, so in practice the key was never changed. `panel rekey`
  seals them all again under a new key in one transaction, and the agents need nothing.
  It stops and changes nothing if any value does not open with the current key, or one
  changes while it runs; `--dry-run` says what it would do; the new key comes from the
  environment and is printed nowhere. See [security.md](docs/security.md#changing-secrets_key).
  In development, where `SECRETS_KEY` may be left out and `SESSION_SECRET` stands in for it,
  rotating `SESSION_SECRET` has the same effect as editing the key: the security page says so.
- **A server action from another origin is refused, and a test now holds it there.** The
  panel's own route handlers that take the session cookie check the origin themselves —
  they are the four of the terminal — and everything else is a server action, covered by
  Next's check. That was measured, not assumed: a foreign origin and the opaque `null` of a
  sandboxed frame are refused before the action is looked up. `verify:terminal` keeps it so.

### Accounts

- **Expired sessions are removed, and Members counts only live ones.** A session
  that had expired was never deleted: the only removals were a person signing out,
  changing a password or ending their sessions, so the table grew by a row for every
  sign-in for ever, and the Members page counted the dead rows beside the live. The
  poller now removes them once an hour, and the count is of the ones that can still be
  used.

## [0.4.0] — 2026-09-30

**DNS records kept for you, and a member who is somebody a server was given
to. Upgrade every node, after the panel.** The agent has no change of its own in
this release — it is the `0.3.5` agent — but a panel and an agent work together
when they share a release line, and this is a new one, so a `0.4` panel and a
`0.3` agent do not. In this order:

1. **The panel**, as [Upgrade](docs/upgrading.md) says: back up, fetch
   `v0.4.0`, run `panel migrate` — one migration: a table for the DNS provider,
   three columns on a node for where players reach it, four on a server for its
   record — and restart.
2. **Every agent**, on its own machine: `sudo bash deploy/linux/install.sh` on
   Linux, `deploy\windows\install-node.ps1` on Windows, both with no arguments.

In between, each node is a line behind, and that is expected: the heartbeat never
refuses an agent, the node stays in service, and **its servers keep running**. Its
page says *This node runs agent 0.3.5, and the panel is 0.4.0*, the create wizard
greys it out and puts nothing new there, and an update, a rollback, a rebuild and
**Ask the node** on it are refused until its agent is upgraded. An agent upgraded
before the panel is the one order that does not work.

**If you have members**, they see less from this release: the servers given
to them and nothing else of the workspace. Until now a member read every
server's page, the node list, the member list and the whole audit log, and
could act on nothing — a server's owner is whoever created it, and members
cannot create. Owners, admins and moderators are unchanged.

**If you want the panel to write DNS records**, set a provider on the new DNS
page under Infrastructure: DuckDNS with the account's token, or Cloudflare with
a token that has Zone:Read and DNS:Edit on one zone. Nothing is written until
you do, and nothing changes if you never do.

### DNS

- **The DNS page walks you through the provider you chose.** Pick DuckDNS or
  Cloudflare and the steps beside the form are that provider's: where the token
  is, what to make there, what to paste here, and what to do to a server. Each
  is ticked from what the panel holds, never from a timer. Below, four counts —
  written, waiting for a node's address, needing attention, and yours — and
  every server's record with its state. **DuckDNS's API cannot make a
  subdomain** (its specification has a call to update a record and one to
  update a text record, and no more), so a server whose subdomain is not in the
  account says *make it on duckdns.org* beside a button that copies the name;
  Cloudflare needs nothing made first.
- **The create wizard checks the address you type.** Under *Name and address*, a
  moment after you stop typing, the panel looks the name up and tells you what it
  comes to: already at one of your nodes, not created yet, pointing at a machine
  that is not a node, or — with a provider set — a name Geeboard will write, one
  outside the zone that is yours to make, or no node with an address to point at.
  With no provider set, a name that does not exist or points elsewhere gets a
  friendly offer, *Want a name of your own?*, that opens the DNS page in a new tab
  and leaves the draft as it is. A lookup that could not be made says so and
  never blocks creating the server.
- **DuckDNS: one subdomain per node is enough.** DuckDNS answers for every name
  under a subdomain of your account with that subdomain's address, so a server
  can be `aurora.myserver.duckdns.org` without making `aurora` on their site. The
  wizard proposes names under the subdomain the token was checked with; the panel
  writes the record through the subdomain; servers on one node share it, a server
  on another node is told it needs its own, and the last one to be deleted clears
  it. A name straight under `duckdns.org` works as before.
- **A server's address gets its record written.** With a provider configured,
  a server whose address is under its zone gets an `A` (or `AAAA`) record
  pointed at its node when it is created; the record follows the server when
  it moves and the node when its address changes, is rewritten when the
  address changes on the Settings page, and goes with the server when it is
  deleted. A record the provider will not write is never a reason the server
  is not created: the toast says so, the server's page shows it, and the
  poller tries again every five minutes. See
  [servers.md](docs/servers.md#dns).
- **Where players reach a node** is a fact of the node now: *Public address*
  in **Configure** on its page, or the address the panel sees its heartbeats
  come from, used only when it is public. The node's page says which, and
  when neither is known.
- **A record that is already there** with the same address is adopted; one
  that points elsewhere and is not the panel's is left alone and reported,
  never overwritten. Cloudflare records are written unproxied — the proxy
  does not carry a game's ports — with a comment naming the server.
- **The token** is checked against the provider before it is saved, stored
  encrypted, never shown again, and in no API-key scope; a Cloudflare check
  proves DNS:Edit by writing and removing a `TXT` record under the zone.
  `dns.configured`, `dns.checked`, `dns.removed` and `server.dns.*` are in the
  audit log, with addresses and never the token.
- **The API** says how each server's record stands in a `dns` field on every
  server. See [api.md](docs/api.md).
- **The wizard** proposes an address under the provider's zone, and its hint
  under *Address* says whether the record will be written or is yours.

### Accounts

- **A server can be given to an account.** The *Owner* card on a server's
  Settings page, for owners and admins, hands it to somebody; the audit log
  records `server.assigned` with who it was and who it is. A member sees the
  servers given to them, starts, stops and restarts them, and watches their
  console; a moderator given a server gains its settings, files, backups and
  schedule, as for one they made. Removing an account that owns servers has
  always asked for this first, and there was no way to do it.
- **A member sees only what a member can open.** The sidebar lists Dashboard,
  Servers, Console, Players and Games for them, and their dashboard is their
  servers; every other page says whose it is to whoever types its address. A
  member holds no API key.
- **The API follows.** `POST /api/v1/servers/:id/assign` under
  `servers:manage`; `GET /api/v1/servers` answers a member with their servers
  rather than a 403; a server not theirs is `NOT_FOUND`. See
  [api.md](docs/api.md).

## [0.3.5] — 2026-09-28

**A shell on a node's machine, from the panel; and a node that arrives with
less to paste.** Additive on the `0.3` line: a `0.3.5` panel works with every
`0.3.x` agent, and a `0.3.5` agent with every `0.3.x` panel. The panel has
two migrations for `panel migrate` — a column for what each machine says about
its terminal, and one for why the panel could not reach a node. Upgrade the
panel as [Upgrade](docs/upgrading.md) says, then the agents: a node whose
agent is older is shown as *agent too old* on the Terminal page, and nothing
else about it changes.

**If you want a terminal on a node**, switch it on at the machine and restart
the agent: `sudo bash deploy/linux/install.sh --terminal` on Linux,
`install-node.ps1 -Terminal` on Windows. Nothing in the panel can do it. See
[nodes.md](docs/nodes.md#node-terminal).

### Node terminal

- **Terminal**, under Infrastructure, opens a shell on a node's machine as the
  account its agent runs as: PowerShell on Windows, `/bin/sh` inside the
  agent's container on Linux — the page says which, above the terminal. A
  real terminal (resizing, colours, Ctrl-C), not a console: what a machine
  allows, who may open it, and what is recorded are all narrower than a
  game console's, and written in [security.md](docs/security.md#node-terminal).
- **Off until the machine says otherwise.** `GEEBOARD_TERMINAL=1`, the
  installers' `--terminal` / `-Terminal`, `join --terminal`, or `npm run
  terminal -- on`. The node reports the switch in every heartbeat, and the
  Terminal page says *off*, *unavailable* (with the agent's reason) or
  *agent too old* before any code is asked for.
- **Owners only, with a fresh authenticator code each time.** `node.terminal`
  is the one permission an admin does not share, and it is in no API-key
  scope. A session belongs to the sign-in that opened it, and closes when that
  ends, when the role changes, when the node's token is rotated, after fifteen
  idle minutes, after four hours, or when the agent stops — with the reason as
  its last line. A page reload within thirty seconds picks the shell back up.
- **Nothing typed or printed is kept.** The audit log has *node.terminal.opened*
  and *closed* — node, who, shell, duration, reason, bytes each way — and
  *refused* for a wrong code.
- **The agent** gains `POST /terminal`, `DELETE /terminal/:id`, a WebSocket
  at `/terminal/:id/stream` that takes the token in its header only, and one
  dependency, `@homebridge/node-pty-prebuilt-multiarch`, whose Linux binaries
  are in the package and whose Windows binary is fetched when the agent's
  packages are installed. When a session ends, everything the shell started
  ends with it. See [daemon/README.md](daemon/README.md#the-node-terminal).
- The console's socket from panel to agent now carries the token in the
  handshake's header rather than its URL. An agent keeps taking the old form
  from `0.3.0`–`0.3.4` panels.

### Nodes

- **Add a node follows the machine the whole way in.** The dialog draws four
  steps from facts the panel holds — the token used, registered, approved,
  reached by the panel — and stops only when the node is in service or the
  token is spent. It shows how long the token is good for, and, when the
  panel's call to the node's address fails, why, in the words the attempt
  failed with, with the two things that fix it. Until now that reason went
  only to the agent's log and the dialog stopped at *registered*.
- The node's page shows the same under **The machine**: *Not reached*, with
  the reason, beside *Reached*; and *Terminal*, with what the machine said.
- **The panel's own machine can be a node, from the installer.**
  `install-panel.sh` ends by asking *Run game servers on this machine too?*
  (`--node` / `--no-node`, `--node-name`; *no* under `--yes`), mints the
  token itself through the new `node-token` verb and runs `install.sh`, so
  the node registers with nothing pasted. It lands as `PENDING`, like every
  node. Run again on a machine that is already a node, it upgrades the agent
  instead of registering it twice. Proved on a clean Ubuntu VPS, end to end,
  with a Terraria server created on the node it made.
- The panel image has one more verb, `node-token <name>`, which prints a
  registration token once. Whoever can run it as the panel is already the
  administrator; the audit log names the installer.

### Known limitations

- Nothing yet refuses a terminal on an agent the panel reaches over plain
  HTTP across a network that is not yours; a rule for it is planned as its
  own change. Until then, see [security.md](docs/security.md#known-gaps).

## [0.3.2] — 2026-09-26

**What an account could read of a server that was not theirs.** Every account
sees every server's page, and was given more on the way than the permissions
say: a member read its console and the commands typed into it, and a member or
a moderator read its join password and its backups. A moderator still watches
every console and reads every command, as the permissions have always said.
Only the panel changes: a `0.3.2` panel works with every `0.3.x` agent, and
there is nothing for `panel migrate` to do. Upgrade the panel as
[Upgrade](docs/upgrading.md) says; the agents stay as they are.

**If a join password was changed from the panel before this**, the audit log
has it, as it was and as it became, readable by every account. Nothing removes
those lines; change the password again if they matter.

**An API client may be given less than before**, never a different shape: a
join password only with `server.settings.write` on that server (a key needs
`servers:write`), and a console command's text only with `server.console.read`
(a key needs `console:write`). What was left out is named in new fields —
`hidden`, `hiddenSettings`, `targetHidden`. See [api.md](docs/api.md).

### Console

- **The console page and a server's last lines were open to anybody signed
  in.** A member sees every server's page and may watch only their own
  server's console, and the stream refused them — but the console page loaded
  a thousand lines of any server named in its address, and a server's page
  showed its last six, to anybody. Both ask first now, before the node is
  asked anything, and say why there is nothing to show: *No console access*.
  **Console** in the sidebar takes a member to their own server rather than to
  a refusal for somebody else's.
- **A crash quoted the console to everybody.** A server made unhealthy by a
  line matching its game's crash pattern showed that line on its page. To
  somebody who may not watch that console, the page now says the line is in
  the console instead of quoting it.
- **An open console is asked again every ten seconds.** It was asked once,
  when it opened, so a role taken away or a session ended from the account
  page left it streaming for as long as the tab stayed open. It closes now,
  says why — *Your role is now member, which does not watch this server's
  console* — and clears what it showed.
- **The console's stream did not ask for two-factor.** An owner or admin who
  had not enrolled, sent to the account page by every page, could still open a
  console's stream by its address, download the audit log as CSV, and read the
  create wizard's progress. All three ask now, as the pages do, and the export
  asks for `audit.read` too.

### Settings

- **A join password was on every account's Settings page.** Terraria's,
  Zomboid's and Valheim's server password were in the game's form for anybody
  who opened it, read from the panel and from the server's own files, and in
  `GET /api/v1/servers/:id` and `…/settings` for any key that could read the
  server. It is given now only to whoever may change the server's settings;
  anybody else sees *Hidden*.
- **The Settings page looked editable to people who could not save it.** A
  member or a moderator on somebody else's server gets both forms without their
  Save buttons, and a sentence saying who can change them; the Danger zone,
  which counted the server's backups, is drawn only for whoever may delete it.
- **A changed password was written into the audit log.** It is recorded as
  changed now — *Server password: not recorded → changed* — and never as what
  it was or became. A definition's password field has to say it is secret, or
  the registry refuses the game.

### Backups

- **Every account saw every server's backups.** The Backups page and a
  server's own page listed them, names and failures included, to anybody; the
  API already asked for `server.backup.read`. Both pages ask now, and say whose
  backups they are. The workspace's totals — how many are kept, how much of
  the nodes' disk they take — are shown to whoever may list every backup. The
  audit log still records each backup taken, as it records everything done to
  every server.

### Audit log

- **Every account read every command typed into every console.** A command's
  text is shown now to whoever may watch that server's console, on the Audit
  and Activity pages, the dashboard, the CSV export and the API, and the search
  does not look inside a text its reader may not see. The line stays — who sent
  a command, to which server, when — with *command not shown* in place of it.

## [0.3.1] — 2026-09-26

**Fixes from a production Terraria server, on the same release line.** A `0.3.1`
panel works with a `0.3.0` agent and the other way round, and there is nothing
for `panel migrate` to do. Upgrade the panel as
[Upgrade](docs/upgrading.md) says, then the agents when you can: three of the
fixes are theirs — an upload that arrives short is refused before it replaces
anything, the console carries the time each line was printed, and a console
left open across a restart goes on. Coming from `0.2.x`, the
[0.3.0](#030--2026-09-25) upgrade applies as written: the panel, then every
agent.

**If a Terraria world failed to load**, it was probably cut at 10 MB on the way
in: see the first item below. After upgrading, upload it again from Files — its
row gives the exact bytes on hover — and choose **Use as world** on it.

### Files

- **Uploads over 10 MB were cut at 10 MB, and called uploaded.** Next.js keeps
  a copy of every request body its proxy sees, up to 10 MB, and past that ends
  the stream without an error; the file was written as far as it went and the
  panel answered `201`. Measured: 20 MB sent, 10,485,760 bytes on the node. The
  upload route is out of the proxy now, and 4, 20 and 60 MB arrive whole.
- **What arrives is counted.** The browser's `Content-Length` goes to the node,
  which refuses a body that ends short before it renames anything — *the upload
  ended at 1000 of 11932207 bytes, so nothing was written* — and the file that
  was there stays. With an agent before 0.3.1 the panel finds the short file
  afterwards and removes it, saying the old file of that name is gone.
- A file's size shows its exact number of bytes on hover.
- **A file a game can use has the button for it.** A Terraria world at the root
  of the server's folder has **Use as world** on its row, or *in use*.

### Servers

- **Terraria's world is a setting: World file.** It was a fixed line,
  `world=/data/geeboard.wld`, written again at every save, so an uploaded world
  could be opened only by editing `serverconfig.txt` by hand until the next save
  put the line back. A world file name is all it takes, and a path is refused:
  `world=/data`, found on a production server, made Terraria generate a new
  world and fail to save it. `worldpath=/data` stays fixed. A server whose file
  names another world by hand shows it on the Settings page as a change on the
  node; one that names nothing opens `geeboard.wld`, as before.
- **A server that stops because of something it printed says what.** A
  definition can name lines that mean a server cannot work, with the sentence to
  show. Terraria's are *Load failed!* — a world it could not read to the end,
  after which it exits with code 0 and the panel said *Stopped* and nothing more
  — and *Failed to create the file* — a world it cannot save, after which it
  says *Server started* and the panel said *Running*. The first is now *Stopped*
  with the reason on the server's page and in the audit event; the second is
  *Not healthy* with the reason, at once, inside the boot grace too.

### Console

- **A line shows the time it was printed, in your own clock.** Every line was
  stamped when it reached the browser, so each reload moved the whole backlog to
  that moment, and the time was formatted on the server, in UTC. A downloaded
  log dates every line and says in its first line which clock it is in.
- **A line is shown once.** The stream's opening copy of the last hundred lines
  was added again under the page's, and again at each reconnect; a downloaded
  log had a hundred lines twice. Lines with the same time and text are one.
- **A restart goes on in the console that watched it.** The node's log stream
  ended when the server stopped and nothing followed the next run; the console
  stayed quiet until the page was reloaded. The agent follows the next run from
  the last line it sent.
- **Lines split across two reads were lost.** The agent dropped a log frame that
  a read ended inside, and the one after it; under a boot printing thousands of
  lines that was runs of them. Frames are carried across reads now.
- **Progress is folded.** Runs of lines that differ only in their numbers show
  as their last, one per kind — *Resetting game objects 100%* where there were a
  hundred lines — so a boot and its error fit the page. The page reads the last
  thousand lines, the overview's six come from as many, and *last 6 lines* shows
  six, not five.
- **Geeboard's health check is marked.** Terraria logs each check as a
  connection from the node's Docker bridge, booted for its version, which read
  as somebody trying to get in every five minutes. Those lines are dimmed and
  tagged **Geeboard health check**.
- Stack-trace lines are no longer levelled `CHAT`, the exception they name is an
  `ERROR`, and blank lines — Terraria writes byte-order marks to stderr — are
  left out rather than shown as empty `ERROR` rows.

### Fixed

- **The create wizard ticked reasons against its own recommendation.**
  *✓ Agent attached: No agent on this node* and *✓ Not in eu-west*: every reason
  under *Recommended* had a tick. The ones that count against the node are
  marked `!`, in the warning colour. `PlacementCandidate` has `against`, the
  reasons of that kind.
- **A disabled primary button looked ready.** The accent colour at 45% read as
  a button to press — *Save changes* on a Settings page nobody had touched. It
  is grey now.
- **The Settings form refused a rename on a full node, and did not say why.** A
  server whose memory limit is more than its node now has room for could not
  save anything from the form, with no error shown, though the save itself
  allows keeping that limit. The form applies the same rule, and once anything
  has changed every error shows.
- `verify:registration` expected the Linux join command as it was before 0.2.2
  and counted retired games as the catalogue, so it failed on any database that
  had been through a catalog sync.

## [0.3.0] — 2026-09-25

**Upgrade every node, after the panel.** The agent now downloads a server's
build as a job the panel watches, and reads a mod's download in a new shape, and
answers the panel in new shapes for both — so this is a new release line, and a
`0.3` panel and a `0.2` agent do not work together. In this order:

1. **The panel**, as [Upgrade](docs/upgrading.md) says: back up, fetch
   `v0.3.0`, run `panel migrate` — five migrations this time — and restart.
2. **Every agent**, on its own machine: `sudo bash deploy/linux/install.sh` on
   Linux, `deploy\windows\install-node.ps1` on Windows, both with no arguments.

In between, each node is a line behind, and that is expected. The heartbeat
never refuses an agent, so the node stays in service and **its servers keep
running**. Its page says *This node runs agent 0.2.4, and the panel is 0.3.0*;
the create wizard shows it greyed out with the same sentence and puts nothing
new there; and an update, a rollback, a rebuild, a setting that needs a rebuild
and **Ask the node** on it are refused, saying to upgrade the agent. The next
heartbeat after its agent restarts clears all of it. An agent upgraded before
the panel is the one order that does not work.

### Servers

- **The first server of a large game is created at the first attempt.** The
  node gave an image pull two minutes and the panel gave the create three, and
  Project Zomboid's Build 42 image is 2.2 GB to download and 10.4 GB unpacked: on
  a node that had not pulled it before, creating a Zomboid server failed by
  construction, left nothing behind to say why, and worked at the second
  attempt because Docker had gone on downloading behind the failure. A pull is
  now a job of its own on the node, with no time limit — it is stopped only when
  it goes two minutes without moving, and says where it stopped — and the create
  that follows finds the image there.
- **The wizard shows the download as it goes** — *Downloading: 1.2 GB of 2.2 GB,
  8 of 9 layers*, with a bar, then *Unpacking: 3 of 9 layers* — in the layers and
  bytes the node counts from Docker's own stream. The total is shown once it is
  known, which is once every layer has begun; until then the wizard says how
  much has come so far and draws no bar. Its review step no longer promises
  "cached, or a minute the first time".
- **An update downloads the new build before it stops anything**, and shows it
  the same way; a download that fails leaves the server running and untouched.
  Before, the download happened after the server had been stopped. A rollback
  and a rebuild download first too, when the node no longer has the build, and
  all three say what they are doing while they work — backing up, stopping,
  restoring — where the button used to say *Working…* and nothing else.
- **A settings change that needs a rebuild downloads first too**, before the
  old workload is removed. A download that fails there changes nothing: the
  server goes on running, on the settings it had, and the form says so. Before,
  the download came after the removal, and failing twice — once, then again
  putting the server back — left it down and in `ERROR`.

### Nodes

- **`GEEBOARD_PULL_TIMEOUT_MS` is retired.** It bounded a whole pull. Its place
  is taken by `GEEBOARD_PULL_STALL_MS` (default two minutes): how long a pull may
  go without moving, not how long it may take. An agent started with the old
  variable set says so in its log.
- The agent has two new routes, `POST` and `GET /images/pull`, and `POST
  /servers` no longer pulls: an image that is not on the node is refused at
  once, with a `409`. See [daemon/README.md](daemon/README.md).
- **Until a node's agent is upgraded, its servers cannot be updated, rolled
  back or rebuilt**, nor given a setting that needs a rebuild. Each of those
  downloads its build first, which a `0.2` agent cannot do, so the panel refuses
  before asking it and says to upgrade the agent; the servers go on running. An
  agent that reports no version is asked, and its `404` is read the same way.

### Mods

- **Mods load on Build 42.** This closes the limitation in 0.2.4's notes. Build
  42 keeps a mod's `mod.info` in a folder per game version — `42/`, `42.0/` —
  beside a `common/` folder, and the agent read it only at the top of the mod,
  where Build 41 keeps it: on a Build 42 server **Ask the node** left every
  Build 42 mod *waiting* and **Apply** loaded none of them. The agent now reads
  every folder and every `mod.info` in a download, and the panel works out
  which one the server's build reads. **The fix is in the agent: upgrading the
  panel alone does not bring it.** Until a node is upgraded, Ask the node on
  its servers says so instead of answering.
- **A mod the server's build will not load stays out of the load list, and its
  row says why** — *laid out for an older build*, *needs 42.21 or later*.
  Measured on 41.78.19 and 42.20.4: Build 42 reads the highest version folder
  not above its own major.minor, with `common/`, and never the top of the mod;
  Build 41 reads only the top; both honour `versionMin` and `versionMax`.
  Neither refuses to start over a mod it cannot see — it logs "not found" and
  starts without it — so before this, a Build 41 mod on a Build 42 server was
  called loaded here and was not.
- **A mod whose requirement is missing stays out too.** A `mod.info`'s
  `require=` is read once the mod is downloaded, and the game — measured on
  both builds — skips a mod whose requirement it cannot find, and every mod
  that requires that one. The row names what is missing: *needs Erikas_Tiles*.
  Finding the item that carries it is still yours. A mod switched off that
  another switched-on mod requires is loaded by the game anyway, and its row
  says so.
- **The Workshop's tags warn before the download.** A pasted collection says
  what its items are tagged for — *5 for Build 42, 1 for Build 41 only* — and
  marks the ones for the other build; a single mod tagged only for the other
  build is added with a warning. Tags are the author's, so they never refuse:
  the files decide once the game has them.
- A mod whose directory has a space or an apostrophe in its name —
  *BuildingCraft Erika's tiles* is a real one — was skipped by the agent. It is
  read.
- The agent no longer follows a `mod.info` that is a symbolic link.
- `GET /servers/:id/mods` on the agent answers each mod as its directory, the
  folders in it and every `mod.info` with what it declares, rather than `{ id,
  name, poster }` — see [daemon/README.md](daemon/README.md).
- `panel migrate` adds a column, `server_mods.contents`: what the node found,
  kept so an update that moves the game is judged again without asking the
  node.
- **A collection's mods can be removed as one.** A collection adds hundreds of
  mods in a click and they left one click at a time. Each mod now remembers the
  collection that added it — its row says so — and each collection on the list
  has **Remove its mods**, which takes those and nothing else: a mod of it added
  on its own, or brought by another collection, stays. Mods added before this
  have no collection; pasting theirs again counts them as its own without
  moving them.
- **A mod's Workshop requirements are named before the game misses them**, with
  a Steam Web API key. When a mod is added, and when the node is asked, the
  panel asks Steam what the item's page lists as required, and a row whose
  requirement is not on the list names it with **add it**. The list is the
  author's and can be short — measured here, a mod whose page lists nothing
  needs one the node finds — so the node's own check stays. Without a key it is
  not known, because Steam answers it only to the keyed API.
- **The mods have an API**: the list, adding an item or a collection, removing
  one or a collection's worth, switching one off, the order, applying, and
  asking the node — `/api/v1/servers/:id/mods`, under `servers:read` and
  `servers:write`, the tab's own operations. See [api.md](docs/api.md).
- `panel migrate` adds three columns to `server_mods`: the collection a mod came
  from, its title, and what its Workshop page requires.

### Fixed

- **What was done to a server's mods was recorded without the account that did
  it.** The audit log showed *system* for adding, removing and applying mods
  and for adding a collection; each carries its account now.
- **A link pasted into the Mods tab as it opened could vanish.** The tab fills
  its shelf with a search of its own when it opens, and that answer, arriving
  after a pasted collection's preview, replaced it. Only the last question's
  answer is shown now.
- `verify:mods` and `verify:pull` exited 0 when they crashed halfway, reporting
  the checks that had passed until then as all of them. A crash counts as a
  failure.
- **Deleting a server deleted its history from the audit log.** Every line about
  it — its creation, every setting changed, every command typed into its
  console, its backups, its mods — went with the row, and only the line saying
  it had been deleted remained, on a page that says it keeps "every privileged
  action". The lines stay now, named after the server: the Audit
  page shows it struck through and "· deleted", finds it by name, and filters to
  it with **Every event of this server**; the CSV export carries its name, and
  `GET /api/v1/audit` answers it with `"deleted": true` and still finds it by
  its slug. `panel migrate` changes how an event refers to its server and adds
  three columns to `activity_events`; lines already lost are not brought back.
- **A create that failed left nothing behind to say why.** Its row was rolled
  back and the steps it had reported went with it. A `server.create.failed` line
  now stays, with the step it failed at, the node's reason, and what was left
  on the node afterwards — and when the node does not answer the clean-up
  either, the wizard says something may be left there, where it said nothing
  was.
- **The games promised what nothing here does.** Minecraft Java's card offered
  Forge and "the whole modded ecosystem", Valheim's BepInEx mod loading and
  Bedrock's add-on support: there is no Forge version, and nothing installs a
  plugin, a mod or an add-on for any of them. The cards say what the catalogue
  offers and that those are not installed from the panel; Project Zomboid's
  says it takes Workshop mods, which it does.
- **The create wizard described changes that do not work that way.** It said a
  different version later was "a restart rather than a migration" — it is an
  update with a backup first, and another kind, Paper to Fabric or Build 41 to
  42, is refused and needs a new server — and that a server's node could not
  change, when an owner or admin can move it.
- **A mod list applied while the server was starting could be lost.** A
  Zomboid start that downloads mods rewrites the game's settings file once they
  are in, from what it read as it started, so a `Mods` line written in between
  was gone by the time it said *SERVER STARTED* — and in between is when **Ask
  the node** first sees the files, so restart, Ask the node, Apply walked
  straight into it. Apply now writes nothing until the game has said it started,
  and says so.
- **The create wizard could not create anything from a plain-http address other
  than localhost.** It made its progress key with `crypto.randomUUID`, which
  browsers offer only on https and localhost — measured: on this PC's LAN
  address the function is not there, and the click failed before any request
  was sent. The key comes from `crypto.getRandomValues` now, which is there
  everywhere.
- **An update killed the server it was updating.** A rollback and a rebuild stop
  the server with the game's own command before replacing its workload; an
  update did not, and left the stop to the rebuild, which removes the old
  workload by force — so the game was killed where it stood, a moment after the
  backup had saved it, with whatever it was writing half-written. It is stopped
  the same way as the other two now: on this project's machine Docker records
  Paper exiting with code 0 before its workload is removed.
- **Ask the node called a download in progress one with nothing in it.** Steam
  writes an item into its folder as it arrives; one whose `mod.info` has not
  landed yet is *waiting*, as it is.
- **Building the panel no longer asks Google Fonts for anything.** Geist and
  JetBrains Mono are files in the repository now, the same ones the
  documentation site serves, so `docker compose build` and `npm run build` work
  behind a firewall that does not let Google through — and on a day Google's
  answer changes shape, which is what made the development server answer 500
  on every page in CI while the same commit built here.
- **The panel is set in Geist, as it was designed to be.** Its text had been in
  the browser's default sans — Segoe UI on Windows — on every page: the font's
  variable was set on the page's body, and the theme reads it from the root,
  where it did not exist. The monospace was unaffected.

## [0.2.4] — 2026-09-23

**The panel only: no node has to move.** Nothing here touches the agent or the
contract between the two halves, so a `0.2.x` agent works with this panel
exactly as it did — upgrade the panel and leave the nodes alone. It does add one
table, for the Steam key, so this is an upgrade where `panel migrate` has
something to do; [Upgrade](docs/upgrading.md) runs it every time. If you run
Project Zomboid, take it: in 0.2.3 nothing in the panel led to the Mods tab.

### Servers

- **A game's own minimum is advice now, not a bound.** Asking for less memory or
  CPU than a game declares is allowed — in the create wizard, on the settings
  page and through the API — and said where it is asked for: *"Project Zomboid
  asks for 6 GB. With 3 it may fail to start, or run until the world grows and
  then stop."* It was a hard floor in four places at once (the slider, the
  settings field, `createServerOp` and a failed compatibility check), so an
  operator with a small machine and three friends could not ask for a 4 GB
  Zomboid at all. What this catalogue believes about somebody else's hardware
  does not outrank what an operator knows about their own.
- **`cpuPctMin` is checked at last.** Every game in the catalogue declared one
  and nothing read it; under it is now the same warning memory gets.
- What still refuses: the platform's own floor — 1 GB and 50% of a core, below
  which a container is not a server — a game's ceiling, and the node's
  uncommitted capacity, which the review step can still be told to overrule.
  Storage keeps the game's minimum too: a disk too small for the image is not a
  slow server, it is a download that cannot finish.
- `checkCompatibility` returns these as reasons of kind `advice`: failed checks
  that do not make a placement incompatible. `blockers()` leaves them out,
  `cautions()` returns them.

### Mods

- **A Workshop collection can be pasted like an item.** The Mods tab shows what
  is in it — how many mods, how many the server already has, what was left out —
  and **Add** puts the new ones after everything already on the server, in the
  collection's own order. Nothing the server already has moves, or is switched
  back on. Collections it links are followed, with their items where the link
  sits; each item is added once, two collections that link each other are each
  walked once, and past 1,000 items or 50 collections it stops and says so. It
  needs no Steam key, like pasting an item: both questions it asks Steam are
  keyless.
- **Nothing changes on the nodes.** A collection is expanded by the panel; the
  game is still told item ids and the agent still reports what it downloaded,
  exactly as before. No agent upgrade.
- **The Steam Web API key can be set from the Mods tab**, by an owner or admin.
  It is tried against Steam before it is kept, stored encrypted like the
  bucket's keys, and never shown again; the tab says who set it and whether
  Steam still takes it, and a key Steam starts refusing is marked there the
  next time somebody searches. **`STEAM_API_KEY` in the environment still
  works, and wins**: while it is set the tab says so and offers nothing to save.
  To manage the key from the tab, empty that line in `deploy/panel/.env` and
  restart the panel.
- **Upgrade with `panel migrate`**, as [upgrading](docs/upgrading.md) says for
  every release: the key has a table of its own, `workshop_key`.

### Fixed

- **A pasted collection link was offered as a mod.** Steam describes a
  collection as an item of size nothing, so **Add** put the collection's id in
  the list and **Apply** would have written it into `WorkshopItems`, where the
  game cannot download it. A collection now opens as a collection, and adding
  one by its id as a single mod is refused.
- **A link to another game's Workshop item was accepted.** It is refused now,
  with the item's name and why.
- A key Steam refuses is called that — *"Steam refused the key"*, with where it
  came from — rather than *"check STEAM_API_KEY on the panel"*, which was wrong
  whenever the key did not come from there.
- **The Mods tab was greyed out on every server page but its own**, Zomboid
  servers included, so nothing in the panel led to it: only the Mods page told
  the row of tabs that the game takes mods. The tabs now work it out from the
  server's game, on every page.

### Known limitations

- **On Build 42, mods are downloaded and not loaded.** Build 42 keeps a mod's
  `mod.info` in a folder per game version — `42.0/`, `common/` — and the agent
  reads it only where Build 41 puts it. So on a Build 42 server **Ask the node**
  leaves every Build 42 mod *waiting* although the game has downloaded it, and
  **Apply** never puts it in the load list: the server starts, without them.
  Build 41 servers are unaffected. The fix is in the agent, so it comes with
  0.3.0 and a node upgrade rather than in this release.

## [0.2.3] — 2026-09-22

**The installer only.** Nothing here touches the panel, the agent or the
database — it is the shell that installs them, so an installation already
running is unaffected and nothing has to be upgraded to get it. Take it before
installing anywhere new.

### Installing

- **The installer checks the address you give it.** Asked "the address
  browsers will use" one line after a yes-or-no question, an installation
  answered `y` — and was taken at its word: `PANEL_URL` became `https://y`,
  Caddy was configured for a site called `y` and issued a certificate for it,
  and the panel came up perfectly behind an address that does not exist. An
  address now has to be one: an IPv4 or IPv6 address, or a name with a dot in
  it. Digits and dots that are not a valid address — `1.2.3`, `256.0.0.1` — are
  refused as the mistyped addresses they are rather than accepted as hostnames.
  A bad `--ip` or `--panel-url` is refused before the machine is touched at
  all, and the question itself now says that Enter accepts the address in
  brackets.
- **`deploy/lib/verify.sh` is new, and CI runs it.** The panel and the agent
  have verify scripts; the shell that installs them had none, which is how a
  question with an unchecked answer reached a release. Forty-two checks over
  the pure helpers — what counts as an address, the host out of a URL, where
  the panel listens, that a secret already written is never rewritten, that the
  Caddyfile is the template filled in — and a CI job that also refuses an
  installer that does not parse.

## [0.2.2] — 2026-09-22

**The panel only: no node has to move.** Nothing here touches the agent, the
contract between the two halves, or the database schema, so a `0.2.0` agent
works with this panel exactly as it did — upgrade the panel and leave the nodes
alone. See [Upgrade](docs/upgrading.md).

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

### Fixed

- **"Create it anyway, over the node's capacity" can be reached now.** It was
  offered on the review step and the create operation took it, but the same
  memory and CPU checks also disabled **Next** on the resources step before it
  — so the only route to the checkbox ran through a button the checkbox was
  needed to enable. Memory and CPU now stop the create on the review step,
  where the sentence that clears them is on the screen; storage still stops
  both, and nothing anywhere offers a way past it. The API has always accepted
  `"overcommit": true`, so this was the wizard alone.
- The same checkbox now appears on a node with **no agent** as well. Capacity is
  counted for those too, and the create refuses them the same way, so the card
  that said only "this one will be simulated" was the second dead end of the
  same shape.
- The rules about what stops each step moved to `web/src/lib/create-wizard.ts`,
  out of the component, with a test that walks every combination of shortfall
  and step and fails if the wizard can ever refuse something it is not also
  asking about.
- **The mark is on every screen now.** Three kept the placeholder they had
  before there was one — a lightning bolt in a lime square: the second step of
  signing in, the page a one-time link lands on, and the create wizard's own
  header, which runs outside the shell and carries its own. The favicon and the
  touch icon were always the mark, so only screens were wrong. A test now
  refuses both the shape of that placeholder and a wordmark with no mark beside
  it.

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

[0.5.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.5.0
[0.4.1]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.4.1
[0.4.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.4.0
[0.3.5]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.5
[0.3.2]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.2
[0.3.1]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.1
[0.3.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.0
[0.2.4]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.4
[0.2.3]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.3
[0.2.2]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.2
[0.2.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.0
[0.1.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.1.0
