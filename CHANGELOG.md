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

[0.3.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.3.0
[0.2.4]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.4
[0.2.3]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.3
[0.2.2]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.2
[0.2.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.2.0
[0.1.0]: https://github.com/DanieleMarino70/Geeboard/releases/tag/v0.1.0
