---
title: What works today
parent: Roadmap
nav_order: 1
---

# What works today

An inventory rather than a history: what a fresh installation can do, as of the
current release. [roadmap.md](roadmap.md) is the same ground in order, phase by
phase, with what each one cost. [limitations.md](limitations.md) is the other
half of the truth.

- Five games, each with its own versions, settings, port layout, health policy
  and node requirements, and each run from its own image on a real node — see
  [docs/games.md](games.md). Three more are written and parked
- Creating a server: pick a game, a version, a template and any of the game's
  settings over it, a node and its resources; the panel claims a port block,
  provisions it on the node and rolls the whole thing back if any step fails
- Start, stop, restart, delete, with the audit trail
- Backups that copy bytes: archived and hashed on the node, restored after the
  hash is checked — and, with an S3-compatible bucket configured on the Backups
  page, sent off-site on a URL the panel signs, so a node never holds the keys
  and a dead node leaves its backups behind. Restore from the bucket onto any
  node. Verified against MinIO — see [docs/backups.md](backups.md#off-site)
- A live console over WebSocket, with commands going to the game's stdin
- A file manager confined to each server's own directory
- Real CPU, memory and network figures, sampled and kept
- Reconciliation: a server that crashes or is stopped by hand on the node is
  noticed, recorded and corrected
- Installation as a sequence, not a single call: provision stopped, write the
  game's own config files, then start — so a Terraria or Zomboid server boots
  with the settings it was created with rather than the game's defaults
- Live version data from Steam, GitHub and Mojang, refreshed by the poller
  whenever the catalog is more than six hours old and never by a page render;
  `npm run games:sync` is the same sync run by hand
- Update detection that works even for a game with no version number: Valheim
  moves by Steam build id, and Geeboard tracks the build id
- Accounts from the panel: **Members → Add a member** makes the account and
  hands you a one-time setup link to pass on; a reset is the same link from the
  member's row and ends their sessions. Everyone changes their own password from
  **Account**. Two-factor sign-in with any TOTP authenticator app and ten
  recovery codes, enrolled by scanning a QR code the panel draws itself,
  required for owners and admins, optional for the rest — see
  [docs/security.md](security.md)
- Node registration: **Nodes → Add a node** names the machine and hands you a
  command that joins the panel and installs the agent as something that starts
  at boot — a container under systemd on Linux, a scheduled task on Windows
  ([docs/installation.md](installation.md#a-node)). The agent works out its
  own address, makes its own secret, registers under the name and saves its
  settings; the dialog shows the machine when it turns up and lets you approve
  it. Verified on this PC three ways: the checkout as a task, a second checkout
  agent, and the container image
- Health that decays from silence rather than flipping on one dropped packet
- Moving a server to another node from its Settings: stopped, backed up to the
  bucket, provisioned and restored on the other node, started, and only then
  removed from the old one — with a rollback at every step that leaves it
  running where it was. Demonstrated between two agents on this PC
- Retiring a node from its page — move or delete its servers, drain it, remove
  it — with removal refused until nothing on the machine would be lost track of
- Terraria, TShock, Minecraft Java (Paper), Minecraft Bedrock, Valheim and
  Project Zomboid run for real from their own images on that node: created from
  the wizard, world in its own directory, live console, stop that saves first,
  files, a backup and a restore. Two Minecraft servers run side by side on one
  PC, each answering on its own port
- Minecraft (both editions), Terraria and Project Zomboid pin their versions —
  the image and the game server inside it — so a restart never moves a world to
  a build it cannot go back from
- A node's memory is what its container engine can hand out, not what the
  machine has: under Docker Desktop, the VM's 7 GB rather than the PC's 16, so
  the panel no longer places a server the engine cannot hold
- A game says where its files live: the node mounts a server's directory at the
  game's own `dataPath`. Valheim's image keeps worlds in `/config`, and mounting
  at `/data` would have left every world inside the workload
- Private ports — RCON, TShock's REST API — are published on the node's
  loopback address only
- Creation refuses a node that cannot run the game — wrong OS or architecture,
  or a capability it has not declared — and the wizard says so on the node
  before the last step
- Placement that recommends a node and shows its arithmetic, including keeping
  servers of one game, or one owner, off a single machine where there is room
- The creation wizard shows which step the install is on while it waits
- A node's agent token rotated from its page, with the node in service
  throughout and nobody shown the token
- Minecraft Java up to 26.3 (Paper 26.2 recommended), on the Java 25 the 2026
  versions need; Valheim keeps its 2.2 GB of game between rebuilds instead of
  downloading it again, and no longer updates itself behind the panel's back
- Health checks that ask the game, not the container — with `booting`,
  `unknown` and `unhealthy` kept apart, because they mean different things.
  Minecraft is asked with its own status ping and Terraria with its own first
  packet, through one bounded exchange on the node that knows neither protocol;
  a Terraria server that hangs after "Server started" is noticed
- A settings form generated from each game's own definition, which says what a
  change will cost before it is saved — and which reads the server's own config
  files first, so a value edited on the node is what the form shows, named as
  changed, instead of being silently overwritten by the next save
- Backups that archive a world, verify it and put it back — and a scheduled
  task that reads the archives back where they lie, on the node or in the
  bucket, and marks the damaged ones before a restore finds them
- Deleting a server offers a last off-site backup first, and deletes nothing if
  it cannot be taken. Off-site backups outlive their server: they stay on the
  Backups page and restore into another server of the same game
- Crash recovery with a ceiling, growing delays and a stable window, so
  nothing restart-loops
- Scheduled tasks that actually run: backups, restarts, broadcasts, cleanups
- Updates that back up first, rebuild around the same world, and leave a
  recorded way back — and that stay within a version's line, so a Fabric server
  is never offered Paper and a Zomboid build 41 world is never offered build 42.
  A failed update keeps the world and its backups
- A container removed outside the panel — `docker rm`, a Docker reset — is
  noticed once by the poller, and the server's page offers **Rebuild**: a new
  workload on the same version around the world still on the node. The same
  rebuild is on the version panel for a definition that changed what a workload
  is given — and the version panel says when that is needed, from a record of
  what each workload was made from. A settings rebuild whose new workload cannot
  be made goes back to the settings it had; a server with no workload can still
  roll back an update. Demonstrated on the Terraria container on this PC
- Players read from a server's own console: who is online now, who has played and
  for how long, for games whose console announces joins and leaves
- A world's size on disk, measured on the node every five minutes
- Analytics counted from what the poller recorded — unique players, playtime,
  peak online, joins by hour, and load per server — with no figure on the page
  that nothing measured
- Members, API keys, audit log, and the audit log as a CSV download that obeys
  the filters on screen
- An HTTP API at `/api/v1` that does what the panel's buttons do to servers,
  settings, files, backups, scheduled tasks and nodes, and reads the audit log —
  the same operations behind both, and every scope on the API keys page with
  routes behind it. See [docs/api.md](api.md)

