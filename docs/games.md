# Games

A game is a `GameDefinition`: one object holding everything the platform needs
to know about hosting it. They live in
[`web/src/domain/games/definitions/`](../web/src/domain/games/definitions), one
file each, and are listed in
[`registry.ts`](../web/src/domain/games/registry.ts).

Nothing outside `src/domain/games` should ever branch on which game it is
holding. If something has to, the definition is missing a field.

## Shipped

| Game | Install | Requires | Configured by |
| --- | --- | --- | --- |
| Minecraft: Java Edition | maintained build | docker | environment — run on a real node |
| Minecraft: Bedrock | maintained build | docker | environment — run on a real node |
| Terraria | maintained build | docker | `serverconfig.txt` — run on a real node |
| Project Zomboid | maintained build | docker | `Server/geeboard.ini` — run on a real node |
| Rust | SteamCMD (258550) | docker, steamcmd, high-memory | environment |
| Valheim | SteamCMD (896660) | docker, steamcmd | environment |
| Palworld | SteamCMD (2394010) | docker, steamcmd, high-memory | environment + INI |
| Satisfactory | SteamCMD (1690800) | docker, steamcmd, high-memory | environment |

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
  an `.ini` key; zombies, loot, power and water live in `geeboard_SandboxVars.lua`,
  which the image fills from one of the game's own presets on a new world's first
  start. That is the "World rules" setting — Apocalypse, Six Months Later,
  Outbreak, Rising, Extinction — and it is marked fixed after creation, because
  changing it later would rebuild the server and change nothing. Tune the rest by
  editing the Lua file with the server stopped
- The Workshop mods field is gone. The game needs `WorkshopItems` and `Mods` to
  agree, and Geeboard does not manage mods yet

Players are not counted: nobody has joined it with a real client yet, so the
console's join and leave lines are unknown.

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

The versions are behind. Paper 1.21.4 is what the definition ships, while
Minecraft itself is on 26.2 — the version panel says so rather than calling the
server current. Adding newer versions is a definition change nobody has made yet.

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
to exactly the server the world was running on. Players are not counted yet:
nobody has joined it with a real client, so the join and leave patterns are
still written from documentation.

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

Two things about it are worth knowing before hosting it. Every Valheim setting
is an environment variable, so **every settings change takes a rebuild**; and a
rebuild re-downloads the game, because the image installs the 2.2 GB server into
the workload rather than into the mounted directory. On this PC that is about
four minutes. Its console shows output and takes no commands: the dedicated
server reads nothing from its input, and the panel says so instead of offering a
prompt. Players are not counted — Valheim's log names a character on connect but
says nothing identifiable when one leaves.

**Terraria, TShock, both Minecrafts, Valheim and Project Zomboid are the games
run from their own images on a real node.** The Docker-backed verify scripts use
an Alpine stand-in wearing a game image's name, which proves the platform and
says nothing about the game. The node mounts a server's directory at the game's
`dataPath`; whether the world actually lands there is unverified for Rust,
Palworld and Satisfactory — the three that need more memory than the machine
this was developed on — and three of the six real runs found it would not have.

## What a definition holds

### Identity and presentation

`id`, `name`, `family`, `art`, `official`, `blurb`.

`family` is what the panel groups by — both Minecraft editions share
`"Minecraft"` — and is what a server row stores as plain text so it survives its
definition being renamed.

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
The same question stands for `steamcmd`, which the Steam games' images also
carry (see Installation below); it is left until one of them has been run.

### Installation

```ts
install: { kind: "image", env: { EULA: "TRUE" } }
install: { kind: "steamcmd", appId: 380870, anonymous: true }
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
nothing today, because every Steam game shipped so far runs an image that
performs the SteamCMD fetch itself on first boot. The strategy is still declared
because **placement** needs it: an image doing the fetching does not change what
the machine must be able to do, so a node without SteamCMD still cannot host
Zomboid. `download` refuses loudly rather than provisioning a server with no
game in it.

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

Progress is reported per step and lands in the activity log. Streaming it into
the creation flow is still to do.

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

Targets: `env`, `properties`, `ini` (with a section), `json` (a pointer), `arg`.

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

Probe kinds: `port`, `log`, `query` (Minecraft ping, Source A2S, Terraria REST),
`rcon`, `process`. `process` is the weakest and is never the only one.

`bootGraceSeconds` matters more than it looks. Zomboid's first boot builds the
map cache, which on a cold node is minutes; Rust generates its map. Calling
either unhealthy before then would restart a server that was working perfectly.

`port`, `log` and `process` are executed every poll pass. `query` and `rcon` are
**declared and skipped** — see [servers.md](servers.md) on why running them
would mean putting game protocol knowledge on the node.

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

A setting can be `fixedAfterCreation` when the game reads it once — Zomboid's
world rules are copied into the world on its first start. The form shows it
and does not let it change, and the operation refuses a change to it.

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

Both patterns must compile and must capture a group called `name`; the registry
audit fails a definition that gets this wrong. Omitting `players` is the honest
answer for a game whose console says nothing about connections — the panel then
reports no players for it and the Players page names it as uncounted, rather
than showing zero as though zero had been observed.

Sessions are opened on a join line and closed on a leave line, on a stop, and at
the start of a new run: a player who was connected when the panel stopped
watching did not stay connected forever. Someone who joined before the panel was
watching appears when they rejoin.

Verified against a real client for Minecraft Java only. Terraria's and Bedrock's
patterns are written from their documented output and have not been seen with a
real player on them.

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
3. `npm run test:unit` — the registry audit runs at import and will reject
   duplicate version ids, two primary ports, a template naming a setting the
   game does not have, or defaults outside the game's own limits.
4. `npm run games:sync` to write it into the catalog tables.

Nothing else. The catalog page, the wizard, the API and the compatibility engine
all read the registry.

Then run it on a real node before calling it shipped: create a server, watch it
reach its ready line, find its world in Files, stop it and see it save. Every
Terraria bug above passed the unit tests.
