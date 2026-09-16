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
| Minecraft: Java Edition | maintained build | docker, java | environment |
| Minecraft: Bedrock | maintained build | docker | environment |
| Terraria | maintained build | docker | `serverconfig.txt` — run on a real node |
| Project Zomboid | SteamCMD (380870) | docker, steamcmd | `Server/servertest.ini` — **see below** |
| Rust | SteamCMD (258550) | docker, steamcmd, high-memory | environment |
| Valheim | SteamCMD (896660) | docker, steamcmd | environment |
| Palworld | SteamCMD (2394010) | docker, steamcmd, high-memory | environment + INI |
| Satisfactory | SteamCMD (1690800) | docker, steamcmd, high-memory | environment |

**Project Zomboid's settings do not reach the game yet.** Found while checking
the image the definition uses (`renegademaster/zomboid-dedicated-server`):

- The image starts the game with `-servername "$SERVER_NAME"` (default
  `ZomboidServer`), so the game reads `Server/ZomboidServer.ini`. The definition
  writes `Server/servertest.ini`, which nothing reads
- On every start the image rewrites `MaxPlayers`, `PauseEmpty`, `Open`,
  `PublicName`, `Password` and `WorkshopItems` from its own environment
  variables, so those would be overwritten even in the right file
- `ZombiePopulationMultiplier` is not an `.ini` key at all. Population is
  `ZombieConfig.PopulationMultiplier` in `servertest_SandboxVars.lua`, which
  has no writer — so the Apocalypse template does not change the population
- The image also ties the public server name to the save directory, so mapping
  the name to `SERVER_NAME` would make renaming a server start a new world
- The memory limit is not passed to Java; the image's `MAX_RAM` defaults to 4 GB

Fixing it means either moving these settings to the image's environment
variables and accepting its rules, or choosing a different image. That is a
decision, not a patch, and it is open.

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

**Terraria is the only game that has been run from its own image on a real node.**
The Docker-backed verify scripts use an Alpine stand-in wearing a game image's
name, which proves the platform and says nothing about the game. `/data` is
where the node mounts a server's directory; the itzg Minecraft images use it,
and whether the world actually lands there is unverified for Zomboid, Rust,
Valheim, Palworld and Satisfactory.

## What a definition holds

### Identity and presentation

`id`, `name`, `family`, `art`, `official`, `popularity`, `blurb`.

`family` is what the panel groups by — both Minecraft editions share
`"Minecraft"` — and is what a server row stores as plain text so it survives its
definition being renamed.

### Ports

Each game reserves a block of consecutive ports on a fixed stride, so one
allocation decision covers the whole layout and two servers can never interleave
into each other's range.

```ts
ports: [
  { id: "game",  label: "Game",  offset: 0, protocol: "both", primary: true },
  { id: "query", label: "Query", offset: 1, protocol: "udp" },
  { id: "rcon",  label: "RCON",  offset: 2, protocol: "tcp",
    container: 25575, public: false, note: "private" },
]
```

Exactly one port is `primary` — the address players connect to. `public: false`
marks an administrative port that is never advertised in the API or the UI.
`container` is for a game that insists on a fixed port inside its own runtime
while the host port varies.

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

### Installation

```ts
install: { kind: "image", env: { EULA: "TRUE" } }
install: { kind: "steamcmd", appId: 380870, anonymous: true }
install: { kind: "download", archive: "tar.gz", stripComponents: 1 }
```

`install.env` is what the build needs before it will run at all — a licence
acceptance, a server type. It is not offered as a setting, because changing it
does not make sense, it just breaks the server.

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

The node mounts a server's directory at **`/data`** inside its container, and
nothing else. A game whose image keeps its world elsewhere has to be pointed at
`/data` — by the image's own variables where it has them — or its world is in an
anonymous volume that Files, backups and rebuilds cannot see.

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
SIGTERM. Restart, restore and rollback stop the same way.

`examples` are the console page's suggestions. An empty `examples` is a real
answer: Valheim's dedicated server has no console command language at all, and
saying so beats offering a text box that does nothing.

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
