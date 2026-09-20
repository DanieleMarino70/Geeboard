---
title: What does not work yet
parent: Roadmap
nav_order: 2
---

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
  Paper's; 26.3, which an up-to-date game client joins, is offered as a preview
- Plugins and mods are not implemented: the tab on a server's page is disabled
  and the Plugins and Marketplace pages say so rather than showing a catalogue
- Mods and Steam Workshop are not implemented

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
- The HTTP API covers what the panel does to servers, backups, tasks and nodes,
  and reads the audit log; it does not manage members, keys, accounts or the
  off-site bucket, or stream live output, and nothing is pushed: a `202` is
  followed by polling. Every scope on the API keys page has routes behind it
- The file manager in the panel edits text; uploading and downloading other
  files is the API's

## Nodes and storage

- A registered node does not know where in the world it is: registration
  records its hostname as the location and `unknown` as the region, and
  somebody sets both from **Configure** on the node's page. The region is what
  placement matches against when a server asks for one
- No agent image is published: the Linux install builds it from a checkout on
  the machine, and Windows runs the checkout itself. The Windows task is
  interactive — it runs while its user is signed in, as Docker Desktop does
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
- A workload made before the panel recorded what it was made from cannot be
  told it needs a rebuild. Zomboid servers created before September 2026 are on
  the old image and need **Rebuild on this version** without being told
