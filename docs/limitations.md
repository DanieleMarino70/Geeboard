# What does not work yet

Stated plainly, because a panel that overpromises is worse than one that does
less. This is the whole list, kept in one place so it cannot go stale in two.
[roadmap.md](roadmap.md) says where each of these lands.

## Games

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
- Two operations on one server at once are not refused. The page disables the
  button that was pressed, not the others, so **Rebuild on this version** can be
  pressed while an update is downloading; the API says a second update is the
  one thing it must not be sent, and does not stop one

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
  and is cleared by deleting the server. An update, a rebuild, a move or a backup
  stopped the same way keeps its transitional state until somebody looks: those can
  legitimately take long, and the rule that fits a create — a live one writes its row
  every few seconds — does not fit them

## DNS

- One provider per workspace, Cloudflare or DuckDNS, and one zone. A server
  whose address is under another domain gets no record, and the page says so
- Address records only — `A` and `AAAA`. No `SRV` for Minecraft's port, no
  `CNAME`; a name that already carries one is left alone and reported
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
  live in its memory. The PTY library's Windows binary is downloaded when the
  agent's packages are installed, so a PC without access to github.com at that
  moment reports the terminal as unavailable until the installer is run again.
  See [nodes.md](nodes.md#node-terminal)
- Windows runs the agent from a checkout rather than an image, and its
  scheduled task is interactive — it runs while its user is signed in, as
  Docker Desktop does. Linux no longer builds: a `v*` tag publishes the panel
  and the agent to GHCR, and `deploy/linux/install.sh` pulls the tag matching
  the checkout, building from `daemon/` only when the pull does not work
- Off-site backups have been run against MinIO on this PC, not against Amazon
  or another provider yet; the signer matches Amazon's published vectors, and
  the procedure for a real one is in [field-checks.md](field-checks.md). One
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
