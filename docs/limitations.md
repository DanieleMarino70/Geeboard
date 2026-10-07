# What does not work yet

Stated plainly, because a panel that overpromises is worse than one that does
less. This is the whole list, kept in one place so it cannot go stale in two.
[roadmap.md](roadmap.md) says where each of these lands.

## Games

- **Community games are not sandboxed.** An approved image runs as root in its
  container and reaches the Internet and the network of the node, including its SSH
  and the agent's port, and on a cloud machine the metadata service. A digest says
  which bytes run, not what they do. The consent is the node's own, declared on the
  machine, and the rules that close the node's side are a script for Linux
  ([community-games.md](community-games.md#keeping-containers-off-the-node-itself)):
  not applied by the installer, not tested across a reboot or a restart of Docker, and
  there is nothing equivalent on Windows or macOS
- A manifest is pasted. There is no address to fetch one from and no catalogue of them,
  by design; what a manifest cannot say is listed with the rules
- A manifest cannot ask for a setting to be written into a JSON file, because the
  panel cannot write one yet; a game whose settings are in one is not expressible
- A community game's join and leave patterns are the author's. The one shipped as an
  example, Factorio's, was written from the game's documented log format and not seen
  with a client connected, so its player count is unproven
- A retired game's servers go on running and can be managed, but cannot be cloned or
  made into templates, and no new one can be made; there is no way to move them to
  another game
- **Rust, Palworld and Satisfactory are parked: written, never run, and not
  offered.** They need 12–16 GB each, more than the machine this is developed
  on gives Docker. Every game that has been run for real found bugs in its
  definition ([games.md](games.md#shipped)), and three of the five found the
  world would have landed outside the directory the node backs up, so offering
  an unrun game would be offering a guess. Their definitions stay in the
  repository, out of the registry, until they have been booted on a machine
  with the memory ([games.md](games.md#parked))
- Project Zomboid's world rules — the preset, zombie population, speed and
  respawn, day length, starting month, water and power shutoff, XP rate — are
  chosen in the wizard and written into `Server/geeboard_SandboxVars.lua` once,
  before the first start. Afterwards the settings form shows what the file
  holds and does not change it: the game rewrites the file and reads it on
  every start, so finer changes and later ones mean editing it in Files with
  the server stopped. Loot has no single knob in build 42 and is not offered
- Terraria 1.4.3.6 boots from its pinned image and answers the health query,
  run bare, and has not been driven through the panel; the other three builds
  have
- Every Valheim setting is an environment variable, so changing one rebuilds
  the server. Its version is not pinned: the image asks Steam for the current
  build whenever a workload starts, and Steam gives an anonymous login nothing
  older, so a start after an Iron Gate release is an update. Most Valheim
  servers are also judged on their log alone — the game answers a query only
  while it is listed publicly with crossplay off
- Minecraft Java's newest stable version is Paper 26.2, because that is
  Paper's; 26.3, which an up-to-date game client joins, is offered as a preview.
  Purpur, Fabric and vanilla are offered at 1.21.4 only, and there is no Forge
- **Mods are Project Zomboid's alone.** Its server downloads Steam Workshop
  items itself, from two keys in its own settings, which is what the Mods tab
  writes. No other game declares how it takes mods, so the tab is greyed out on
  them. Minecraft plugins and mods — a different mechanism, files in a
  directory — are not implemented, and neither are Bedrock add-ons or Valheim's
  BepInEx. A jar can be uploaded through Files, and nothing checks it
- Browsing the Workshop needs a Steam Web API key — set on the Mods tab, or as
  `STEAM_API_KEY` in the panel's environment, which wins — because Steam only
  offers search through its keyed API. Without one, a mod or a whole collection
  is added by pasting its link or id, which needs no key. Either way the pictures come
  from Steam's CDN to the browser: with the network gone, the mods a server
  already has are still listed and still apply, and the shelf is empty
- A mod's files are fetched by the game on its node, so the panel cannot say
  how far a download has got. It says what the node has, when asked, and the
  game does the rest on its next start
- Which build a mod is for is known for certain only once the game has
  downloaded it: the node reads its files, and a mod the server's build will not
  load stays out of the load list, with the reason on its row. Before that the
  Workshop's tags are the only word on it, and they are the author's — so they
  warn, in a collection's preview and when a single mod is added, and never
  refuse. The rule for which folder a build reads was measured on 41.78.19 and
  42.20.4; a later build that changes it would need measuring again
- Load order is a list the operator arranges. Dependencies between mods are
  read but not resolved: once a mod is downloaded, its `require=` is known, and
  a mod whose requirement the server does not have is kept out of the load list
  with the missing one named — but which Workshop item carries a given mod id
  is not something the panel can look up. With a Steam Web API key, what an
  item's Workshop page lists as required is asked of Steam and named on its row
  with a button to add it; that list is the author's, and can be incomplete.
  Without a key it is not known, because Steam answers it only through the
  keyed API
- A mod switched off is still loaded when a mod switched on requires it — the
  game loads what is required whether it is listed or not. The row says so; the
  switch cannot prevent it

## Creating, updating and rebuilding

- A download is shown in layers and bytes, as the node counts them from
  Docker. Unpacking is counted in layers, so a large layer holds the count still
  while it unpacks: Zomboid's Build 42 image stayed at *3 of 9 layers* for about
  a minute
- A settings change that needs a rebuild downloads the build first when the
  node does not have it, and shows nothing while it does: the form waits
- A settings change that needs a rebuild, made to a stopped server, starts it to
  see that it boots and stops it again after thirty seconds — by force, if the
  game is still booting, which Paper was
- Two operations on one server at once are refused: an update, a rollback, a rebuild, a settings
  rebuild, a restore, a move and a backup each take the server before they begin, by one
  compare-and-set, and the second is told what has it and for how long ("Busy: a backup has been
  running for 1 s."). Delete, Start, Stop and Restart are refused while one holds it, the API with
  `SERVER_STATE_INVALID`. What is **not** covered: the page still draws the other buttons enabled and
  says so only when one is pressed; and an update's download and pre-update backup come before its
  claim, so for those minutes the server is still free to be stopped or deleted (the update then
  fails at its claim, or at the node)

## What the panel measures

- Player counts are read from the console, so they exist only for games that
  say who joined. Minecraft Java's lines are verified against a real client.
  The patterns for Terraria, Bedrock, Valheim and Project Zomboid are written
  from documentation, the server's known log or its own code, and none has been
  seen with a real player: treat their counts as unverified until one has
  joined — the checklist for doing that is in
  [field-checks.md](field-checks.md)
- No game reports its tick rate, so Analytics has no performance panel and the
  stored `tps` is a placeholder
- RCON health probes are not executed — no game offered declares one — and a
  game that starts and then exits on a bad setting is a crash, handled by crash
  recovery, not a failed rebuild that is rolled back

## Accounts and the API

- The panel sends no email. A new account or a password reset is a one-time
  link the admin hands over themselves; SMTP was decided against for now, so
  there is no "forgot password" that a person can start on their own
- The HTTP API covers what the panel does to servers, their mods, backups, tasks
  and nodes, and reads the audit log; it does not search the Workshop, manage
  members, keys, accounts or the off-site bucket, or stream live output, and
  nothing is pushed: a `202` is
  followed by polling. Every scope on the API keys page has routes behind it
- A member reaches the servers given to them and nothing else: no page of the
  workspace, no settings, files, backups or schedule of their own servers, and
  no API key. Somebody who needs more of a server is made a moderator, which is
  a role for the whole workspace — there is no per-server grant between the two
- The Audit page has no list of servers to filter by: an event's detail links
  to every event of its server, and `?server=` with a slug does the same. A slug
  taken again by a newer server finds both servers' lines, each saying which is
  deleted
- The file manager uploads one file at a time and takes no folders: a modpack
  is its jars, dropped in, and a whole world goes in a backup rather than
  through a browser. Nothing resumes, either — an upload that drops halfway
  leaves the file that was there and is started again from the beginning. On a
  node whose agent is older than 0.3.1 a short upload is only found after it
  has replaced the old file: the panel removes it and says so, and the old file
  is gone
- A console shows the last thousand lines a server printed, folded. Making a
  new Terraria world prints tens of thousands, so the start of that run is
  outside the window; the end, and any error there, is not. Blank lines are
  left out, of the page and of a downloaded log
- The console's lines from a node before 0.3.1 carry the time they were sent,
  not the time they were printed: a reconnect's repeats cannot be told from new
  lines, and the backlog reads as having just happened. Upgrade the agent

## Interrupted operations

- A create the panel was stopped in the middle of becomes an error after ten minutes
  and is cleared by deleting the server. An update, a rollback, a rebuild, a settings rebuild, a
  restore, a move or a backup stopped the same way is **given back**: the process that holds a
  server writes a beat every thirty seconds, and a panel or a poller that starts again gives back
  what the last one of its kind held, at once. A backup's server goes back to what it was, and the
  backup is marked failed; anything else is in ERROR with a sentence ("An update did not finish: The
  panel was stopped while it ran. Its files are as the last step left them: rebuild it to bring it
  back, or restore a backup."), which is the state the page offers a rebuild for, and the audit log
  has a `server.operation.interrupted` line by the Watchdog. An operation that is hung and not dead is
  given back after five minutes without a beat (`OPERATION_STALE_MS`). A restore that was cut off may
  have replaced part of a world, and a move may have left a copy on the new node: the sentence says
  so, and neither is cleaned up for you

## The watchdog, and one instance

- **One poller, one pass at a time.** The poller is one loop in one process, by design, and a lock in
  the database enforces it: a second poller exits (code 75) with a line that says why, and a poller whose
  connection to the database ends leaves too, so that its supervisor starts it again. Under Compose a
  second poller (`--scale poller=2`) is restarted by Docker with a growing delay, and says the same line
  each time, until it is scaled back to one. The panel is one
  instance as well: sign-in, two-factor and API rate limits are counted in its own process
  ([security.md](security.md#one-instance-and-what-changes-with-more)).
- **"Within fifteen seconds" is how often it looks, not how fast it answers.** A crash, a stopped
  server or an unreachable node is noticed by the next pass: at the default interval that is up to
  fifteen seconds plus however long the pass takes, and every scheduled task (a backup of a large
  world) runs inside a pass, so while one runs the other servers are not looked at. The dashboard and
  the Nodes page say when the last pass ended and warn past three intervals; a pass that has been
  running longer than that says so as well, and a poller that is gone says it is gone
  ([production.md](production.md#is-it-up)). Taking scheduled work out of the loop is not done.
- **The watchdog is as good as the process it watches.** `docker compose ps` shows the poller
  unhealthy within about a minute and a half of its last pass, and nothing restarts a poller that is
  merely unhealthy: Compose restarts one that exits. There is no alert that leaves the panel; look
  at the dashboard, or at `docker compose ps`.

## Notifications, templates and clones

- Notifications go to Discord and to webhooks. There is no email — the project has
  no mail server — no Slack or Telegram of their own (a webhook with a small adapter
  at the receiving end reaches them), and no per-person notifications: a channel is
  the workspace's, set by an owner or admin
- Delivery is at least once, from the poller process. A message can arrive twice
  after a failure that was only a lost answer, and up to about a pass after the
  event; one that fails for a day is dropped. There is one poller, enforced by a
  lock: a second one leaves, so none sends twice
- A webhook may call public addresses only, unless the person who runs the panel
  sets `GEEBOARD_WEBHOOK_ALLOW_PRIVATE=1` on the machine, and never this machine
  itself or cloud metadata. A node that is only on a private network cannot be
  messaged about without that setting
- A server that stops with nobody asking and whose restart policy does not start it
  again is a notification (*left stopped*), and the panel says what it has evidence
  for about why and no more: a signal in the exit code names Docker or the machine, other
  servers of the node stopping in the same pass point at it, and a lone clean exit
  says nothing is known, because a game that Docker stops exits with the same code as
  one that quits. A server that is alone on its node is always in the last case
- A server whose restart policy is `ALWAYS` is started again after a reboot of the
  machine by the panel's poller, so a node the panel cannot reach is not: the servers on
  a node that comes back stay stopped until the panel sees it
- A template keeps a server's settings, limits and version, and not its world,
  mods, address, schedule, a join password or a setting that names a file in its
  folder. A template cannot be edited once saved; save it again from the server
  under another name and delete the old one
- A clone's world travels through the off-site bucket, so with none set up the copy
  is the settings and a new world. It is two steps and not one: if the world cannot
  be put in, the new server stays, on the world it was created with, and the message
  says so. The copy's Mods tab starts empty, though the mods in the world's files
  run

## DNS

- One provider per workspace — Cloudflare, DuckDNS or a [webhook](dns-webhook.md) — and one zone. A server
  whose address is under another domain gets no record, and the page says so
- `A`, `AAAA` and — for Minecraft: Java Edition, on Cloudflare or a webhook — `SRV`. No SRV for any other game
  or for a community game's manifest, none on DuckDNS, which holds an address of each family and nothing
  else, and no `CNAME`; a name that already carries one of these is left alone and reported — except at
  a webhook, which cannot be asked what is at a name
- **A webhook is accepted, not written.** A `2xx` says the receiver will act, and the panel cannot look at
  your DNS. It does not read, so it cannot refuse to overwrite a record it did not make (the receiver is sent
  the marker and has to), and a record changed or removed by hand at the DNS is not noticed: the panel sends
  a record when it changes, not on a timer. It has no native client for Route 53, Gandi, OVH or any other
  provider, which is what a receiver is for. The reference receiver is `nsupdate`, run against BIND 9.20;
  Knot and PowerDNS take the same update and were not run
- An `AAAA` is written only for an IPv6 address a person set on the node's page. The panel does not
  take one from the address it observed, because it cannot know that the Internet can reach it: Docker
  publishes a game's ports on IPv6 as well with its default settings (measured on a real machine), but
  whether a provider lets IPv6 traffic in was not, for there was no IPv6 client to try it from
- An SRV record is **written**, and the panel's tests and a live panel against a stand-in Cloudflare show
  it written, moved with the server's port and removed. What a Minecraft client does with it is Minecraft's,
  and no Minecraft client was pointed at one
- DuckDNS makes no subdomains through its API — its specification has one call
  to update a record, one to update a text record, and nothing to make, list or
  remove a subdomain — so each is made on duckdns.org first, and the panel points
  it. One per node is enough, since every name under it follows it, and a server
  on another node cannot share it: a subdomain has one address, and the second
  node needs its own. The number an account may have is DuckDNS's to say, on its
  site. Its token cannot be checked without one of them, so the form asks for one
- The node's observed address is read only behind a proxy that writes
  `X-Forwarded-For`, as the panel's own Caddy does; with none, or from the same
  LAN, the public address has to be set on the node's page
- A record that fails is retried every five minutes by the poller, and by
  **Retry now**; nothing is retried faster, and nothing is queued

## Nodes and storage

- A registered node does not know where in the world it is: registration
  records its hostname as the location and `unknown` as the region, and
  somebody sets both from **Configure** on the node's page. The region is what
  placement matches against when a server asks for one
- The node terminal is a shell of what the agent runs in, not always of the
  machine: on Linux that is the agent's container — `/bin/sh`, no `bash`,
  the agent's mounts and the host's network — and a shell of the host itself
  is not offered. On Windows it is the installing account's PowerShell, in the
  interactive session, so a program it starts with a window appears on that
  PC's screen. Owners only; two sessions per node; fifteen idle minutes and
  four hours at most; nothing is kept when the panel restarts, since sessions
  live in its memory. The PTY library is an optional dependency, and on Windows its
  binary is downloaded from github.com when the agent's packages are installed: a PC
  that cannot reach it at that moment gets a node whose terminal is reported as
  unavailable, with the reason, and everything else works; run the installer again
  with access to add it (before 0.9 the whole install failed instead).
  See [nodes.md](nodes.md#node-terminal)
- The Files page cannot be raced on Linux, with one exception, and can on Windows. The Linux agent walks every path through
  directories it holds open, so a game that swaps a directory for a link while a file is written changes nothing; but a
  **recursive delete** hands the folder to the system's own remover, and a game that swaps a directory *inside* that folder for
  a link during the delete could make it remove a file outside the server's folder. The Windows agent checks with `realpath`
  and then uses the name, as every release before 0.9.0 did on both: a game that can make a link or a directory junction in
  its own folder has a window there. See [security.md](security.md#file-security)
- Windows runs the agent from a checkout rather than an image, and its
  scheduled task is interactive — it runs while its user is signed in, as
  Docker Desktop does. Linux no longer builds: a `v*` tag publishes the panel
  and the agent to GHCR, and `deploy/linux/install.sh` pulls the tag matching
  the checkout, building from `daemon/` only when the pull does not work
- Off-site backups have been run against MinIO and SeaweedFS on this PC and against a real Backblaze B2
  bucket in eu-central-003, in both addressing styles, and not against Amazon S3, Cloudflare R2 or any
  other hosted store; the signer matches Amazon's published vectors, the form fills in what Amazon and
  R2 ask for from their documentation ([backups.md](backups.md#which-store)), and the procedure for a
  real one is in [field-checks.md](field-checks.md). A bucket that keeps old versions — Backblaze's does
  by default, and with *keep only the last version* still for a day — keeps a deleted backup, hidden and
  billed, and the panel cannot see it. One
  bucket per workspace, and an archive is either on its node or in the bucket,
  never both
- Moving a server needs the off-site bucket: there is no agent-to-agent
  transfer, so without a bucket retiring a node still means deleting its
  servers
- A failed health check after an update does not roll back on its own — that is
  a button, because an unhealthy server is not proof the update caused it

## Left over from earlier versions

- The sample workspace (`npm run db:seed`) is fixtures: nodes with no agent and
  simulated servers, marked as such. The console page still shows a fixture log
  for those servers
- The audit lines of a server deleted before September 2026 were deleted with
  it; only the line saying it was deleted is left. Lines are kept from now on
- A workload made before the panel recorded what it was made from cannot be
  told it needs a rebuild. Zomboid servers created before September 2026 are on
  the old image and need **Rebuild on this version** without being told
