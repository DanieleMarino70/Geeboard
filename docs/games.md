---
title: Games
parent: Operate
nav_order: 3
---

# Games

A game is a `GameDefinition`: one object holding everything the platform needs
to know about hosting it. They live in
[`web/src/domain/games/definitions/`](https://github.com/DanieleMarino70/Geeboard/tree/main/web/src/domain/games/definitions), one
file each, and are listed in
[`registry.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/games/registry.ts).

Nothing outside `src/domain/games` should ever branch on which game it is
holding. If something has to, the definition is missing a field.

## Shipped

| Game | Install | Requires | Configured by |
| --- | --- | --- | --- |
| Minecraft: Java Edition | maintained build | docker | environment — run on a real node |
| Minecraft: Bedrock | maintained build | docker | environment — run on a real node |
| Terraria | maintained build | docker | `serverconfig.txt` — run on a real node |
| Project Zomboid | maintained build | docker | `Server/geeboard.ini` — run on a real node |
| Valheim | SteamCMD (896660) | docker, steamcmd | environment — run on a real node |

Three more definitions exist and are not offered — see [Parked](#parked).

**Project Zomboid was run for real in September 2026**, after its settings had
been found not to reach the game at all. The definition moved to a different
image, `danixu86/project-zomboid-dedicated-server`, chosen by checking both
images rather than their READMEs:

| | renegademaster (before) | danixu86 (now) |
| --- | --- | --- |
| A version | a Steam branch, fetched on every start — build 41 became build 42 on a restart | a pinned tag with the game inside it: `42.20.4-release`, `41.78.19-release` |
| The `.ini` | thirteen keys rewritten from its environment on every start | only keys whose variables are set; mod keys left alone with `SELF_MANAGED_MODS` |
| Memory | `MAX_RAM`, default 4 GB | `MEMORY`, passed as `-Xms`/`-Xmx` |
| Console | not tested | reads the container's input — verified |

Run on the Windows node from the wizard, then through the panel: a console
command (`players` answered `Players connected (0)`), a settings save, a backup
preceded by the game's own `save`, a stop, a restore and a start. What it found:

- **The world lives in `/home/steam/Zomboid`**, and the image fixes that
  directory's ownership for its `steam` user on every start. Mounting anywhere
  else works under Docker Desktop and fails on a Linux node, where the directory
  would belong to root. `dataPath` is that directory, and the agent now allows a
  mount point four segments deep
- **A signal does not save.** `docker stop` waited ninety seconds and killed it,
  exit 137. `quit` on its console saves in under a second, but the process takes
  about forty-five seconds to let go of Steam and the JVM — past the panel's
  thirty-second grace. Dialects can now say how long they need
  (`stopGraceSeconds`); Zomboid's is ninety
- **It will not start a new world without an admin password, and then prints it
  on every start** (`pzexe: arg: …`). The password is now random for each
  workload, stored nowhere, and blanked out of every console the panel shows —
  the console page, its live stream, the server page's tail and the logs API. An
  operator makes their own character an admin from the console:
  `setaccesslevel <name> admin`
- **The second port is the game's business.** The server tells clients which
  UDP port to use, so it is told the one it was allocated (`PORT`, `UDPPORT`),
  and ports map one to one rather than to fixed container ports
- **The heap was not sized.** The launcher asks for 8 GB whatever the container
  allows; `MEMORY` is now three quarters of the limit
- **Its own backups went inside Geeboard's.** The game zips the world into
  `Zomboid/backups` on every start. `BackupsOnStart`, `BackupsOnVersionChange`
  and `BackupsPeriod` are written off
- **It saved only on shutdown.** `SaveWorldEveryMinutes` defaults to 0, so a
  backup of a running server was as old as its last restart. It is a setting now,
  defaulting to 10
- **Population was never a server setting.** `ZombiePopulationMultiplier` is not
  an `.ini` key; zombies, loot, power and water live in
  `Server/geeboard_SandboxVars.lua`, the world's rules. Geeboard now writes that
  file itself when the server is created, before its first start — see
  [World rules](#world-rules-a-lua-file-written-once) below — and the "World
  rules" group in the wizard is where they are chosen
- The Workshop mods field is gone. The game needs `WorkshopItems` and `Mods` to
  agree, and Geeboard does not manage mods yet

Players are counted from patterns nobody has confirmed: they were written
afterwards from the format strings in the game's own server code, and no real
client has joined yet — see [Console](#console).

#### World rules: a Lua file, written once

Run again in September 2026 to settle how the world's rules should be written,
against the bare image by hand before touching the definition. What the game
does, measured on 42.20.4 and then on 41.78.19:

- **A partial file is accepted.** A `SandboxVars` table holding four keys booted
  a new world; the game filled every other option from its defaults and rewrote
  the file in full — every option, each with the game's own comment on it,
  about a thousand lines — before "Loading world" (its log says `writing
  …/geeboard_SandboxVars.lua`). The rewritten file is the game's own record of
  what it loaded
- **`require` works from inside the file.** `SandboxVars = require
  "Sandbox/Extinction"` followed by assignments loaded the preset from the
  image and the assignments over it: the rewrite held Extinction's loot factors
  and zombie senses and the overridden count, multiplier, speed and XP rate.
  Build 41 does the same with a preset it ships; given one it does not
  (Extinction is build 42's) it exits with "attempted index of non-table"
- **The file is read on every start, not only the first.** A hand edit with
  the server stopped — `Zombies = 3` to `6` — was in the rewrite after the
  restart. So "fixed after creation" is a rule of the panel, not of the game
- **The zombie count does not set the multiplier on load.** `Zombies = 6` over
  Apocalypse left `PopulationMultiplier` at `0.65`, although the game's own UI
  sets both together. Geeboard writes both, with the multipliers the game's
  comment gives for each count

So the file Geeboard writes at creation is the preset by `require` — the
game's own file, from inside the image, never copied into this repository —
then one assignment per choice made in the wizard:

```lua
SandboxVars = require "Sandbox/Rising"
SandboxVars.Zombies = 3
SandboxVars.ZombieConfig.PopulationMultiplier = 1.2
SandboxVars.ZombieLore.Speed = 3
SandboxVars.DayLength = 5
SandboxVars.StartMonth = 10
SandboxVars.MultiplierConfig.Global = 2.0
SandboxVars.MultiplierConfig.GlobalToggle = true
```

The choices: the preset, zombie population, zombie speed, zombie respawn (build
42 only), day length, starting month, water and power shutoff, XP multiplier.
Each defaults to "As the preset sets it", which writes nothing and leaves the
preset's value standing. Loot is not offered: build 42 has no single loot
rarity, only twenty per-category multipliers, and a knob that pretended
otherwise would be a guess.

Two builds, two shapes. Build 42 has six zombie counts, four speeds, a respawn
option and a 27-step day; build 41 has five counts, three speeds, no respawn
option, 25 day steps that start differently, its own preset list and a
top-level `XpMultiplier` where build 42 has `MultiplierConfig.Global` with a
toggle. Each field names its version line (`lines: ["b42"]`), and the wizard and
the settings form show the right one. A version that no longer resolves gets
only the settings every build shares.

Demonstrated on this PC: a build 42 server created from the wizard with Rising,
High, Shamblers, 2 hours, October and 2.0× showed that eight-line file in Files
before its first boot, and after it the game's full rewrite carrying every one
of those values and Rising's own — a starter kit, fewer locked houses, respawn
Low — with the settings form reading them back, locked, and a save of an
unrelated setting going through. The Playwright run is the evidence; nobody has
yet joined that world with a client to feel the difference.

After creation the file belongs to the game and the operator: the settings form
shows what the file holds and does not let it change; changes are made in
Files with the server stopped, and the game reads them at the next start. The
panel never writes the file again — not on a settings save, not on a rebuild —
so creation-day values are never put back over a world that has moved on.

**Terraria had never run for real until September 2026**, and running it on a
real node found five things wrong, all in the definition:

- The images were wrong. "Terraria 1.4.4.9 — unmodified" ran
  `ryshe/terraria:latest`, which is TShock; the TShock and 1.4.3.6 entries named
  tags that were never published. Every version now names a pinned tag that
  exists, and 1.4.5.8 — what a current game client joins — is recommended
- Geeboard wrote `serverconfig.txt` into the server's directory, mounted at
  `/data`, while the image reads `/config`. The world would have lived in an
  anonymous volume that Files could not see and a backup did not contain.
  `CONFIGPATH=/data` points the image at the server's directory, and
  `install.files` adds `world=/data/geeboard.wld` so the world is created there
- `WORLD_FILENAME` was set, which makes the image's bootstrap look for that world,
  find none on a new server, and exit before the game reads its config
- The port probe crashed it. A TCP connection that closes without Terraria's
  handshake throws `ObjectDisposedException` in vanilla 1.4.5.8's netplay loop
  and the server exits — reproduced against the bare image. Probed every poll,
  a healthy server crash-looped. Terraria is judged on its console instead
- Its container port followed the host port, so a second Terraria server on a
  node would have published 7779 to a port nothing listened on

TShock needed one more thing: its image reads Terraria's `serverconfig.txt` only
when told where it is, on its command line, and nothing could pass start
arguments to a node. Versions now declare `args`, and the TShock version starts
with `-config /data/serverconfig.txt` — so its world, its settings and TShock's
own `config.json` and database all live in the server's directory. Run from its
image on a real node, created from the wizard.

The two older vanilla builds were booted from their pinned images afterwards,
bare, with the file and variable Geeboard gives them: `ryshe/terraria:vanilla-
1.4.4.9` and `:vanilla-1.4.3.6-4`, both on Mono rather than the native build.
Each honoured `CONFIGPATH=/data`, made `geeboard.wld` in `/data`, printed
`Server started`, answered `playing` typed at its console, and saved and exited
on `exit`. Both survived three bare TCP connections to their port, logging only
`… is connecting…` — the crash on a port probe is 1.4.5.8's alone. They are
supported; neither has been driven through the panel or joined by a client.

**Health had a gap on vanilla, and it is closed.** A log probe says the server
said "Server started" once; a process alive and hung afterwards read healthy,
and the port probe that would notice crashes 1.4.5.8. What closes it is
Terraria's own first packet — a connect request carrying a version no server has
— which the server answers with a disconnect ("You are not using the same
version as this server") and then hangs up on itself.

The crash turned out to be about who goes first. Measured on the bare 1.4.5.8
image: connect-and-close killed it within five tries
(`ObjectDisposedException` in `Netplay.ServerLoop`); a connection held for 300 ms
did not; and the hello, held until the server answered, did not in any number —
nor when the server was frozen, the question timed out, and the server came back
to find the connection gone. 1.4.4.9, 1.4.3.6 and TShock 5.2.4 answer the same
packet the same way. So the node's exchange never hangs up while an answer may
still come, and Terraria is asked every five minutes rather than every pass,
because each question is two lines in its console.

Running it on a real server found one more thing: the server sometimes sends a
net-module packet *before* the disconnect, and a reply judged on its first
packet alone turned a healthy server `UNHEALTHY` the second time it was asked.
Every frame of the reply is read now. Frozen with `SIGSTOP` in its container —
which Docker still calls running — the real server was `UNHEALTHY`, "the game
took a query and did not answer it", within its five minutes, and `RUNNING`
again fourteen seconds after it was let go.

**Minecraft: Java Edition was run for real in September 2026** — Paper 1.21.4
from `itzg/minecraft-server`, created from the wizard on a Windows PC running
Docker Desktop. Its world, config and libraries land in `/data`; the console,
`stop` (four seconds, every dimension saved), Files, a backup and a restore all
work. Checked against the bare image first, then through the panel. It found:

- The container port followed the host port, as Terraria's had. The server
  inside always listens on 25565, so a second server on a node published 25568
  to nothing. Both the game and query ports are now fixed at 25565 inside; two
  servers on one PC answered a Minecraft status ping on 25565 and 25568
- The heap was 1 GB whatever the server was given: the image defaults `MEMORY`
  to `1G`. The definition empties it and sets `-XX:MaxRAMPercentage=75`, so the
  JVM sizes the heap from the container's limit — 2.25 GB of a 3 GB server —
  and keeps the rest for memory outside the heap, since past the limit the
  kernel kills the process
- The node was asked for Java. The image carries its own, so a machine with
  Docker and nothing else was refused
- The query port was published and nothing answered it. `ENABLE_QUERY` is now
  set, and a GameSpy query on the published port returns the server's details
- RCON, marked private, was published on every interface of the node. Private
  ports are now bound to the node's loopback address — see Ports below
- Every backup failed. The agent's archive writer stopped at 100-byte paths, and
  Paper's `libraries/` directory has paths of 148
- The image was the floating `java21` tag, rebuilt every few days. It is pinned,
  as Terraria's are

**Minecraft 26.** In 2026 Minecraft started counting by year and drop — 26.1,
26.2, 26.3 — and with 26.1 started asking for Java 25. Measured against the bare
images before the definition was touched: the pinned `java21` tag resolves and
downloads Paper 26.3 and then refuses it ("Minecraft 26.1 and newer requires
running the server with Java 25 or above"); the same release's `java25` tag boots
26.2 and 26.3 with nothing else different — the world in `/data`, the same ready
line, `list` and `stop` on the console, a clean exit after saving every
dimension, the status ping answered. So the new versions are a different image
and the 1.x ones stay on the one they were verified on. **Paper 26.2** is
recommended, because it is the newest Paper calls stable; **Paper 26.3**, which
an up-to-date game client joins, is a preview, because Paper's builds for it are
on its alpha channel — a production server is not offered it as an update.
Players on a 26.2 server choose 26.2 in their launcher. Paper 26.2 was then
created on the Windows node through the panel and judged healthy by its status
ping. Only Paper has 26.x entries; Purpur, Fabric and vanilla stop at 1.21.4
until each has been run.

**Minecraft: Bedrock was run for real in September 2026** — `itzg/minecraft-bedrock-server`
on the Windows node, checked against the bare image first, then created from the
wizard and put through the panel: `list` on its console, a setting that needs a
rebuild, a backup, a stop, a restore and a start. It found three things wrong:

- **A restart was an upgrade.** The definition used `VERSION=LATEST`, which the
  image resolves against Mojang on every start, and a world does not open in an
  older server than made it. Versions now pin the server — `1.26.51.1`, and the
  preview `1.26.60.27` with `PREVIEW=true` — and the image tag. With the server
  already in `/data`, a restart or a rebuild downloads nothing ("Using given
  version"). The old ids live on as former ids
- **The second server on a node was unreachable.** Ports mapped one to one, but
  the server listens where `SERVER_PORT` says, and nothing said: it listened on
  19132 inside a container published on 19332. It is now told its ports
- **A backup stopped the world saving.** `save hold` pauses Bedrock's saving
  until `save resume`; the backup sent the first and never the second. It now
  resumes after every archive, success or not, and before archiving asks
  `save query` until the game answers "Files are now ready to be copied" — on a
  new world, one second — instead of waiting two seconds and hoping

SIGTERM is turned into `stop` by the image's runner; the server says "Quit
correctly" within a second. The server binary lives in `/data` beside the
worlds, so a backup carries about 95 MB of server with the world — and restores
to exactly the server the world was running on. Its player counts are
unverified: nobody has joined it with a real client, so the join and leave
patterns are still written from documentation.

**Valheim was run for real in September 2026** — `lloesche/valheim-server` on the
Windows node, created from the wizard, rebuilt, backed up, stopped, restored and
started again through the panel. Checked against the bare image first. It found
four things wrong in the definition and one in the platform:

- **The world was going to land in the container.** The image keeps worlds in
  `/config/worlds_local` and nothing in it moves that. Geeboard mounted the
  server's directory at `/data`, as it did for every game — so the world would
  have been invisible to Files, absent from every backup and destroyed by the
  next rebuild. Games now declare a `dataPath`, and Valheim's is `/config`
- `crossplay` targeted `SERVER_ARGS_CROSSPLAY`, which does not exist. The image
  reads `CROSSPLAY` and adds `-crossplay` itself
- `preset` targeted `PRESET`, which does not exist either. World modifiers are
  command-line flags, and the image appends `SERVER_ARGS` to them, so the
  setting's values are `-preset hard` and the like
- **An unset password is not no password.** The image defaults `SERVER_PASS` to
  the literal `secret`, so a server nobody gave a password to had one that is in
  the image's source. `install.env` now sets it to empty explicitly. An empty
  password boots fine as long as the server is not listed publicly — verified —
  and Valheim's rules (five characters, never containing the world name,
  required when listed) are now declared on the field
- The image runs its own hourly backup cron into `/config/backups`, which is
  inside what Geeboard archives. `BACKUPS=false`

Three things about it are worth knowing before hosting it. Every Valheim setting
is an environment variable, so **every settings change takes a rebuild**. A
rebuild used to download the game again, because the image installs the 2.2 GB
server into the workload; it is kept between workloads now, in a cache mount
(see [Where its files live](#where-its-files-live)), and a rebuild is a minute
and a half of the image checking what is there. And **the image updated itself**:
left alone it asks Steam for a new build every fifteen minutes and, finding one
with nobody connected, installs it and restarts the server — an update nobody
asked for, with no backup before it, which the panel saw as a server that went
away and came back. `UPDATE_CRON` is set empty, so the image checks only when a
workload starts. That is still not a pinned version — Steam gives an anonymous
login the current build and nothing older, so a start after Iron Gate ships is an
update — but it is one a person caused. Its console shows output and takes no commands: the dedicated
server reads nothing from its input, and the panel says so instead of offering a
prompt. Valheim's log names a character on connect and only a Steam id when one
leaves; the two are paired through a `connect` pattern — see
[Console](#console) — written from the server's known log and not yet seen with
a real player.

**Every game offered has been run from its own image on a real node.** The
Docker-backed verify scripts use an Alpine stand-in wearing a game image's name,
which proves the platform and says nothing about the game. The node mounts a
server's directory at the game's `dataPath`; three of the five real runs found
the world would have landed somewhere else.

## Parked

| Game | Install | Requires | Configured by | Why parked |
| --- | --- | --- | --- | --- |
| Rust | SteamCMD (258550) | docker, steamcmd, high-memory | environment | needs 12–16 GB, never run |
| Palworld | SteamCMD (2394010) | docker, steamcmd, high-memory | environment + INI | needs 16 GB, never run |
| Satisfactory | SteamCMD (1690800) | docker, steamcmd, high-memory | environment | needs 12 GB, never run |

Their definitions are in
[`definitions/`](https://github.com/DanieleMarino70/Geeboard/tree/main/web/src/domain/games/definitions) with a header saying so,
and are commented out of the registry since September 2026. None of the three
has ever been booted: each needs more memory than the machine Geeboard is
developed on gives Docker (7.7 GB), and every game that *has* been booted found
bugs a definition cannot show — a world outside the backed-up directory, settings
that never reached the game, a health probe that crashed the server. A game
nobody has run is a guess, and the wizard does not offer guesses.

What parking does: `npm run games:sync` marks the three catalog rows retired
rather than deleting them, so a workspace that had a server on one keeps the row
its server points at. The Games page, the wizard and `GET /api/v1/games` list
from the registry and no longer show them; `GET /api/v1/games/rust` is the
ordinary `GAME_NOT_FOUND`. A server whose game has left the registry keeps
running and keeps its console and files; Settings shows the platform settings
only, the Players page lists it among the servers it cannot count, and the
scheduler refuses a command or broadcast for it, since without a definition
nothing knows its console language.

Re-enabling one means a machine with the memory and the method under
[Adding a game](#adding-a-game): run the bare image by hand, measure where the
world lands, which variables the image reads, the ready line, stdin, SIGTERM
and what a restart downloads; fix the definition; create one from the wizard and
drive it through the panel; then put its import and its line back in
[`registry.ts`](https://github.com/DanieleMarino70/Geeboard/blob/main/web/src/domain/games/registry.ts). The unit tests that need
a mechanism only a parked definition has — a `text` field, an INI target, two
versions on one Steam branch — import that definition directly, past the
registry, and say so.

## What a definition holds

### Identity and presentation

`id`, `name`, `family`, `art`, `official`, `blurb`.

`family` is what the panel groups by — both Minecraft editions share
`"Minecraft"` — and is what a server row stores as plain text so it survives its
definition being renamed.

**The cover is drawn, not fetched.** Every game's real artwork belongs to
somebody, and this project is AGPL: committing key art would hand every fork a
licence problem it did not choose, and pulling it from a store's CDN would put
the same artwork in the panel, need the network on every render, and cover
neither Minecraft. So each game has a handful of flat shapes in
`components/covers.tsx`, keyed by the definition's id — no requests, no files,
readable at 28 px in a list and 56 px in the wizard. `art` is what is shown when
a game has none: two lines of text on the striped square the panel has always
had. A cover that is missing is that square, never a broken image.

### Where its files live

`dataPath`, defaulting to `/data`: where the node mounts the server's own
directory inside the workload. Most images read `/data`, some do not, and the
difference is not cosmetic — a game whose world lands anywhere else writes it
into the container layer, where the file browser cannot see it, no backup
contains it, and a rebuild throws it away. Valheim's image keeps worlds in
`/config/worlds_local`, so its definition says `dataPath: "/config"`. Zomboid's
says `/home/steam/Zomboid`: its image fixes that directory's ownership for the
user the game runs as, and a mount anywhere else would belong to root on a Linux
node.

The agent refuses a mount point that would break the container: it must be
absolute, at most four segments, and never `/`, `/var`, `/root` or inside a
directory a Linux system needs to run.

`cachePaths` is the second kind of mount, with the opposite promises. It is for
what an image downloads *for itself* and would download again for every new
workload: Valheim's image installs 2.2 GB of game into `/opt/valheim`, and every
Valheim setting is an environment variable, so every settings change was a new
workload and another download. Mounting the server's directory there would put
the game in every backup. A cache mount is not the world: the node keeps it
beside the server's data (`<dataRoot>/.cache/<serverId>/opt-valheim`), it is in
no archive, Files does not show it, it survives a rebuild, it goes with the
server, and losing it costs a download and nothing else. It does not travel with
a move. Two at most, the data mount's rules, and never overlapping it.

Measure before adding one. Valheim's, on the bare image with the directory
mounted from the node: 565 seconds to "Game server connected" the first time, 98
for a second workload on the same mount, with no download — the image's
`app_update … validate` finds the game whole. Then through the panel on the
Windows node: 487 seconds for the first workload, 106 for **Rebuild on this
version** with nothing downloaded, a backup of 630 bytes with no game in it, and
the cache directory gone when the server was deleted. It costs 4.1 GB of the node's
disk, because the image keeps a download copy beside the installed one, which is
why Valheim's disk floor is 10 GB.

### Ports

Each game reserves a block of consecutive ports on a fixed stride, so one
allocation decision covers the whole layout and two servers can never interleave
into each other's range.

```ts
ports: [
  { id: "game",  label: "Game",  offset: 0, container: 25565, protocol: "tcp", primary: true },
  { id: "query", label: "Query", offset: 1, container: 25565, protocol: "udp" },
  { id: "rcon",  label: "RCON",  offset: 2, container: 25575, protocol: "tcp",
    public: false, note: "private" },
]
```

Exactly one port is `primary` — the address players connect to. `public: false`
marks an administrative port: it is never advertised in the API or the UI, and
the node publishes it on its loopback address only, so the agent can reach it and
the internet cannot. Until September 2026 it was published on every interface —
Minecraft's RCON, TShock's REST API — with nothing in front of it but the image's
own password. An existing server picks the change up when it is rebuilt.

`container` is the port inside the workload. Almost every image listens on a
fixed port whatever the host port is, and leaving it out publishes the host port
to the same number inside — which is right for the first server of a game on a
node and wrong for every one after it. Both Terraria and Minecraft shipped with
that mistake.

Two games may share a `portBase`; Terraria and Satisfactory both genuinely
default to 7777. Allocation checks the ports actually taken on the node, not the
range they came from, so overlap costs a little fragmentation and nothing else.

### Requirements

```ts
requirements: {
  memoryGbMin: 8, cpuPctMin: 200, diskGbMin: 20,
  os: ["linux"], arch: ["x64"],
  capabilities: ["docker", "steamcmd"],
}
```

The compatibility engine reads these and nothing else does. A node that has not
reported its OS or capabilities yet is **partial**, not incompatible — see
[nodes.md](nodes.md).

The memory floor is a real refusal, not a hint. Project Zomboid asks for eight
gigabytes because a smaller server dies during map streaming rather than at
boot, which is the worst possible time to find out.

A capability is something the **node** has to provide. A runtime the image
already carries is not one: Minecraft Java asked for `java` until a real run
showed its image brings its own, and every node without the flag was refused.
The same question was asked of `steamcmd` when the Steam games were run.
Project Zomboid dropped it: its image has the game inside, and nothing is
fetched. Valheim kept it, although its image carries SteamCMD too, because that
image downloads 2.2 GB from Steam on the node at first boot and again at every
rebuild — and whether a machine should be doing that is the operator's call,
which is what a declared capability is (see Installation below).

### Installation

```ts
install: { kind: "image", env: { EULA: "TRUE" } }
install: { kind: "steamcmd", appId: 896660, anonymous: true }
install: { kind: "download", archive: "tar.gz", stripComponents: 1 }
```

`install.env` is what the build needs before it will run at all — a licence
acceptance, a server type, how its memory is sized. It is not offered as a
setting, because changing it does not make sense, it just breaks the server.
Minecraft's sets `MEMORY` to empty and `JVM_XX_OPTS` to
`-XX:MaxRAMPercentage=75`, so the heap follows the memory limit the operator
chose instead of the image's fixed 1 GB.

`install.files` is the same rule for a config file: lines the game has to read
before it will run under Geeboard. Terraria's is which world to load — without it
the server waits at an interactive menu:

```ts
install: {
  kind: "image",
  env: { CONFIGPATH: "/data" },
  files: [{ file: "serverconfig.txt", kind: "properties",
            entries: { world: "/data/geeboard.wld", worldpath: "/data", port: "7777" } }],
}
```

They are merged beneath the settings, so a setting with the same key wins.

`install.env` works the same way for `steamcmd`. Valheim's sets `BACKUPS=false`,
because the image runs its own hourly backup cron into the very directory
Geeboard archives, and `SERVER_PASS` to the empty string, because the image
defaults an unset password to the literal `secret` — a server nobody gave a
password to must not quietly have one everybody knows.

The node mounts a server's directory at the game's `dataPath` — `/data` unless
the definition says otherwise — and mounts nothing else. A game whose image keeps
its world elsewhere is either pointed at the mount by its own variables, as
Terraria's `CONFIGPATH` does, or the definition moves the mount to where the
image already writes, as Valheim's does.

Each strategy has an installer, and they differ only in `prepare` — the work
that has to happen before a workload exists. `image` and `steamcmd` both prepare
nothing today, because the one `steamcmd` game offered, Valheim, runs an image
that performs the SteamCMD fetch itself on first boot. The strategy is still
declared because **placement** needs it: an image doing the fetching does not
change what the operator has agreed the machine may do, so a node that has not
declared `steamcmd` still cannot host Valheim. Project Zomboid was declared the
same way until its real run moved it to an image with the game already inside
it; it is `image` now and asks a node for `docker` alone. `download` refuses
loudly rather than provisioning a server with no game in it.

### The install sequence

```
prepare → provision (stopped) → write config files → start
```

Starting last is the point. A game reads its configuration once, at boot;
writing it into a running server changes nothing until the next restart, so
provisioning with `start: true` would mean every file-configured server ignored
the template it was created from.

Any failure destroys what it made. A workload that exists in the runtime but not
in the panel is invisible, holds a port, and cannot be cleaned up from the
panel — a worse outcome than the failure that caused it.

What it made is not always the directory. The same sequence runs every update,
rollback and settings rebuild, around a world that was there first, and those
callers pass `existingData: true` so a failure removes the workload and leaves the
files. It used to remove the directory every time: an update whose new workload
would not start took the world, and the locked backup beside it.

A caller can pass `start: false` to leave the configured workload stopped. A
rebuild of a stopped server on its own version does; an update or a rollback
starts the new build anyway and stops it again, because a build that will not
start is caught — and rolled back — there, rather than at the next start.

Progress is reported per step. It lands in the activity log, and on the server's
row while the install runs, where the creation wizard reads it once a second and
shows which step it is on — the step and its sentence, not a percentage, because
the node does not say how far through pulling a build it is.

### Settings

Each `ConfigField` has a domain key, a type with bounds, and a **target** — the
place the value has to land for the game to read it.

```ts
{ key: "maxPlayers", label: "Max players", type: "number",
  target: { kind: "env", name: "MAX_PLAYERS" },
  default: 40, min: 1, max: 500, group: "Players" }

{ key: "difficulty", label: "World difficulty", type: "enum",
  target: { kind: "properties", file: "serverconfig.txt", key: "difficulty" },
  default: "0", options: [...], restartRequired: true }
```

Targets: `env`, `properties`, `ini` (with a section), `json` (a pointer), `arg`,
and two for a Lua table the game reads as a file:

```ts
{ key: "sandboxPreset", type: "enum", lines: ["b42"], fixedAfterCreation: true,
  target: { kind: "lua-base", file: "Server/geeboard_SandboxVars.lua",
            table: "SandboxVars", prefix: "Sandbox/" } }      // = require "Sandbox/<value>"

{ key: "zombiePopulation", type: "enum", lines: ["b42"], fixedAfterCreation: true,
  target: { kind: "lua", file: "Server/geeboard_SandboxVars.lua",
            table: "SandboxVars", key: "Zombies",
            also: [{ key: "ZombieConfig.PopulationMultiplier",
                     byValue: { "1": "2.5", "2": "1.6", "3": "1.2", "4": "0.65", "5": "0.15", "6": "0.0" } }] } }
```

`lua-base` is what the table starts from — the game's own preset, by
`require`, from inside the image. `lua` is one key inside the table, dotted for
a nested one, written as a Lua literal: numbers and booleans bare, other
strings quoted. `also` names assignments that go with it, either fixed or
picked by the field's value, for a game whose UI sets two options when a person
picks one. A field's `lines` are the version lines it exists on: two fields may
share a key when their lines are disjoint, which is one setting with a
different shape per build, and everything that draws or validates settings
narrows the game to the version's line first (`scopeToLine`).

The writer, `mergeLua`, handles both shapes the file has — the one Geeboard
writes and the one the game rewrites it into — and replaces a key only inside
the table it belongs to. A key the game's file does not have is an error, not
an insertion; so is a table it does not recognise. `readLuaValue` reads either
shape back for the settings form.

A field can also carry the game's own rules about it, declaratively — not as a
function, because the settings form renders these fields in the browser, and not
as a branch in a validator, because "Valheim needs a password when the server is
listed" is a fact about Valheim:

```ts
minLength: 5,                                 // when it is set at all
requiredWhen: { key: "public", equals: true }, // may not be empty then
mustNotContain: "worldName",                   // Valheim refuses to start otherwise
```

They are checked over the settings the server would end up with, defaults
included, so a rule about a field the caller did not send is still applied.

An `arg` target is a flag on the server's command line. Arguments go to the
image's entrypoint in the order version → settings: a version's own `args` first
(TShock's `-config /data/serverconfig.txt`), then each `arg` setting as flag and
value. They reach the container as separate argv entries — no shell parses them —
and are applied at creation, like environment variables. Until September 2026
they were rendered and then dropped, because no provision plan carried them.

`renderConfig(game, values, version)` turns settings into what each target
needs. Environment variables are applied at creation, in the order
install → version → settings, so an operator's choice wins over a default the
build ships with.

File targets come back as **patches** — a list of keys to merge — never whole
files, and the installer writes them to the node before the server's first
start. A game writes to its own config as it runs, and regenerating the file
from the panel's idea of it would quietly throw that away. `mergeProperties()`
and `mergeIni()` do the merge, preserving comments, ordering and every key the
panel has never heard of. An INI key is written inside its own section, because
one that drifts past the next header silently configures something else.

**An empty value is an absent one** and is not written at all. An empty seed or
password means "not set", and writing `seed=` into a file where the game has
already recorded the seed it chose would erase it — which is the exact loss that
merging rather than replacing exists to prevent. `renderConfig`'s `includeEmpty`
option turns this off for the settings-update path, where clearing a password
has to be possible.

**Not yet:** there is no JSON writer. No shipped game uses a `json` target, and
`applyPatch` refuses rather than dropping the settings quietly.

### Versions

See [versions.md](versions.md). A version carries the environment that
distinguishes it from its siblings — one build often serves many versions, and
the difference between Paper 1.21.4 and vanilla 1.20.6 is two variables, not a
different tag.

Three fields decide what happens to servers already running:

- **`line`** — versions in one line are updates of each other. Give every piece
  of server software its own (`paper`, `fabric`), and every build whose worlds
  do not open in the next (`b41`, `b42`). A definition with one version needs
  none
- **`formerIds`** — when a version id has to change, the old one goes here, so
  servers and rollback records that hold it still resolve
- **`supported: false`** — for a version that is no longer installed. Keep it
  rather than deleting it while servers may still be on it

An id names what the version is, not how it is currently distributed. Leave the
channel out of it — and out of the label, which is stored on every server
created from it.

### Health

```ts
health: {
  probes: [{ kind: "port", port: "game" },
           { kind: "query", protocol: "minecraft-ping" }],
  bootGraceSeconds: 180,
  readyPattern: 'Done \\([\\d.]+s\\)! For help',
  crashPattern: "(java\\.lang\\.OutOfMemoryError|Exception in server tick loop)",
}
```

Probe kinds: `port`, `log`, `query` (Minecraft's status ping, Source A2S,
Terraria's own connect request; TShock's REST API is named and not spoken),
`rcon`, `process`. `process` is the weakest and is never the only one.

`bootGraceSeconds` matters more than it looks. Zomboid's first boot builds the
map cache, which on a cold node is minutes; Rust generates its map. Calling
either unhealthy before then would restart a server that was working perfectly.

`port`, `log` and `process` are executed every poll pass, and so is `query` —
through one bounded exchange on the node, with the protocol in the panel; see
[servers.md](servers.md#health). `rcon` is **declared and skipped**.

```ts
{ kind: "query", protocol: "terraria-hello", everySeconds: 300 }
{ kind: "query", protocol: "source-a2s",
  when: [{ key: "public", equals: true }, { key: "crossplay", equals: false }] }
```

`port` names the definition's port to ask on when it is not the protocol's usual
one; `everySeconds` spaces the questions out for a game that writes each one to
its console (a good answer stands in between, a bad one is asked again at once);
`when` is for a game that only answers under some of its own settings — Valheim
answers A2S only while listed publicly with crossplay off, measured both ways —
and a probe whose conditions do not hold is reported as *not asked*, never as
failed. The registry audit refuses a query on a port the game does not have, on
the wrong transport, or conditioned on a setting it does not have. Put the bytes
to the real image first: `npx tsx scripts/probe-query.mts <protocol> <port>`.

A port probe is a TCP connect and nothing more, and **not every game survives
one**: vanilla Terraria 1.4.5.8 crashes on a connection that closes without its
handshake. Check a new game against its real image before giving it a `port`
probe.

A `log` probe reads the last 120 lines of output, and a busy server pushes its
ready line out of them within minutes. So the first time every log probe matches
in a run, the poller records `readyAt`, and the probe passes for the rest of that
run from the record. A restart has to say it is ready again. Terraria, judged on
its console alone, used to go `UNHEALTHY` for having players on it.

`crashPattern` is a case-sensitive regular expression; match what the server
actually prints.

### Console

```ts
console: {
  stopCommand: "stop", saveCommand: "save-all",
  broadcastCommand: "say %s",
  examples: ["list", "whitelist add <player>", "op <player>"],
}
```

`stopCommand` is how a server is stopped: it is written to the console, the panel
waits for the process to exit, and only signals it if it has not by the end of
the grace period. A signal alone killed Terraria unsaved — its shell ignores
SIGTERM — and Zomboid's image the same way. Restart, restore and rollback stop
the same way.

The grace is thirty seconds unless the dialect's `stopGraceSeconds` says the game
needs longer. Measure it rather than guess: Zomboid saves in under a second and
then takes about forty-five to exit, so its figure is ninety.

`resourceEnv` hands a workload what it was given rather than what was chosen:
its memory as a heap size, the ports it was allocated, and secrets the image
demands. A secret is `<prefix>-<32 hex>`, fresh for every workload and stored
nowhere, and `redactSecrets` blanks it out of every console view by that prefix:

```ts
resourceEnv: {
  memory: { name: "MEMORY", percent: 75 },          // "6144m" of an 8 GB server
  ports: { game: "PORT", direct: "UDPPORT" },       // the numbers on the node
  secrets: { ADMINPASSWORD: "gbadmin" },            // required, printed, never shown
}
```

A setting can be `fixedAfterCreation` when it is chosen once, for a new world —
Zomboid's world rules. Such a field is rendered only for a server being created
(`renderConfig`'s `creating` option): a later settings save or rebuild writes
nothing for it, so the panel's creation-day copy is never put back over a file
the game has rewritten or an operator has edited. The wizard is the one place
to choose it; the settings form shows what the server's file holds and does
not let it change. A save of some other setting sends the shown values back,
and a fixed value that matches the file is taken as the stored one rather than
refused — the form must stay usable after the world's rules have moved on.

`examples` are the console page's suggestions. A dialect that names no command at
all — no stop, no save, no broadcast, no example — is a real answer, and
`acceptsCommands(dialect)` is how the console page reads it: Valheim's dedicated
server is driven by signals and reads nothing from its input, so its console
shows the output with no prompt and says why. A prompt that swallows every line
typed into it is worse than no prompt.

`players` is how the poller learns who is connected, from the same output:

```ts
players: {
  join: "\\]: (?<name>[A-Za-z0-9_]{1,16}) joined the game$",
  leave: "\\]: (?<name>[A-Za-z0-9_]{1,16}) left the game$",
}
```

Both patterns must compile; `join` must capture a group called `name`, and
`leave` either `name` or — for a game that says who left only by a connection
id — `id`, with a third pattern, `connect`, to pair the id with a name:

```ts
players: {
  connect: "Got connection SteamID (?<id>\\d{5,20})",           // the id, first
  join: "Got character ZDOID from (?<name>.{1,32}?) : -?\\d+:\\d+$", // then the name
  leave: "Closing socket (?<id>\\d{5,20})",                      // the id alone
}
```

That is Valheim's log: a connection announced by Steam id, a character named on
the next lines, and only the id on the way out. The poller reads every line it
fetched for the pairing — a connect id waits for the next join without one, a
name announced again without a new connection (a respawn) keeps its id — and
turns only the lines after its cursor into events, so a connection whose two
lines straddle a poll is still paired. The id is stored on the session, and a
leave by id closes the session that carries it. The registry audit fails a
definition whose patterns do not fit this. Omitting `players` is the honest
answer for a game whose console says nothing about connections — the panel then
reports no players for it and the Players page names it as uncounted, rather
than showing zero as though zero had been observed.

Sessions are opened on a join line and closed on a leave line, on a stop, and at
the start of a new run: a player who was connected when the panel stopped
watching did not stay connected forever. Someone who joined before the panel was
watching appears when they rejoin.

Verified against a real client for Minecraft Java only. Terraria's and Bedrock's
patterns are written from their documented output; Valheim's from the server's
known log; Project Zomboid's from the format strings in its own server code
(`"<user>" fully connected`, `Disconnected player "<user>"`). None of the four
has been seen with a real player on it, and the Players page counts for them
are not to be trusted until one has.

### Templates

A starting point, in domain keys rather than environment variables:

```ts
{ id: "hardcore", name: "Hardcore", whitelist: true,
  summary: "Hardcore, hard difficulty, whitelist on",
  config: { mode: "survival", difficulty: "hard", hardcore: true } }
```

Everything a template sets is editable afterwards, which is why the wizard can
promise that.

## Adding a game

1. Write `definitions/<game>.ts`.
2. Add it to `DEFINITIONS` in `registry.ts`.
3. Draw its cover in `components/covers.tsx`, under the same id — a few flat
   shapes, no gradients, legible at 28 px. Without one the game shows the
   striped square, which is honest but plain; `test/covers.test.ts` says which
   games are missing one.
4. `npm run test:unit` — the registry audit runs at import and will reject
   duplicate version ids, two primary ports, a template naming a setting the
   game does not have, or defaults outside the game's own limits.
5. `npm run games:sync` to write it into the catalog tables.

Nothing else. The catalog page, the wizard, the API and the compatibility engine
all read the registry.

Then run it on a real node before calling it shipped: create a server, watch it
reach its ready line, find its world in Files, stop it and see it save. Every
Terraria bug above passed the unit tests.
