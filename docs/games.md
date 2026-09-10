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
| Terraria | maintained build | docker | `serverconfig.txt` |
| Project Zomboid | SteamCMD (380870) | docker, steamcmd | `Server/servertest.ini` |
| Rust | SteamCMD (258550) | docker, steamcmd, high-memory | environment |
| Valheim | SteamCMD (896660) | docker, steamcmd | environment |
| Palworld | SteamCMD (2394010) | docker, steamcmd, high-memory | environment + INI |
| Satisfactory | SteamCMD (1690800) | docker, steamcmd, high-memory | environment |

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

Only `image` is carried out today. The other two describe work an installer has
to perform and are declared so a definition can be honest about how the game
actually works; the installers land in Phase 2.

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

`renderConfig(game, values, version)` turns settings into what each target
needs. Environment variables are applied at creation, in the order
install → version → settings, so an operator's choice wins over a default the
build ships with.

File targets come back as **patches** — a list of keys to merge — never whole
files. A game writes to its own config as it runs, and regenerating the file
from the panel's idea of it would quietly throw that away. `mergeProperties()`
does the merge, preserving comments, ordering and any key the panel does not
know about.

**Not yet:** patches are produced, tested, and not written to the node. Games
configured by file (Terraria, Zomboid, Palworld's INI settings) currently boot
with their own defaults. Phase 2.

### Versions

See [versions.md](versions.md). A version carries the environment that
distinguishes it from its siblings — one build often serves many versions, and
the difference between Paper 1.21.4 and vanilla 1.20.6 is two variables, not a
different tag.

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

**Not yet:** declared, not executed. Phase 4.

### Console

```ts
console: {
  stopCommand: "stop", saveCommand: "save-all",
  broadcastCommand: "say %s",
  examples: ["list", "whitelist add <player>", "op <player>"],
}
```

An empty `examples` is a real answer: Valheim's dedicated server has no console
command language at all, and saying so beats offering a text box that does
nothing.

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
