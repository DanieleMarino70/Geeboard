import type { GameDefinition } from "../types";

/* Minecraft: Java Edition.

   The image installs and updates the server itself; which server it
   installs is a matter of two environment variables, which is why each
   version carries TYPE and VERSION rather than a tag of its own. Without
   them every version in the list would produce the same server. */

export const MINECRAFT_JAVA: GameDefinition = {
  id: "minecraft-java",
  name: "Minecraft: Java Edition",
  family: "Minecraft",
  art: "MC\nJAVA",
  /* Minecraft is not on Steam, and minecraft.net publishes no vertical
     poster: measured on 2026-10-12, its pages have square key art
     (Homepage_Discover-our-games_MC-Vanilla-KeyArt_864x864.jpg, served
     648 × 648), 600 × 800 cut-outs of characters on a transparent ground,
     and square slides with black bands — none of them a poster. Its CDN
     also leaves unanswered a client whose name carries an address, which
     the panel's does. So the poster is the one Mojang's publisher puts on
     its own store: the Microsoft Store's "Poster" image of "Minecraft:
     Java & Bedrock Edition for PC" (product 9NXP44L49SHJ), fetched
     2026-10-12: a JPEG, 720 × 1080, 178,141 bytes, with this sha256. */
  poster: {
    url: "https://store-images.s-microsoft.com/image/apps.808.14492077886571533.be42f4bd-887b-4430-8ed0-622341b4d2b0.c8274c53-105e-478b-9f4b-41b8088210a3",
    sha256: "e93ee7aef2ed6bf27dfee5be358a8a3d88c6c2fe02195d7d71e1e40009d398b0",
    width: 720,
    height: 1080,
  },
  official: true,
  /* What the catalog offers, and no more. This said "Forge" and "the
     whole modded ecosystem" while no version was Forge, Purpur and Fabric
     stopped at 1.21.4 and nothing installed a plugin or a mod. */
  blurb: "Vanilla, Paper, Purpur and Fabric servers. Plugins and mods are not installed from the panel.",

  portBase: 25565,
  portSpan: 400,
  /* The container ports are fixed, as Terraria's are: the server inside
     listens on 25565 whichever block the node allocated. Found running
     the image — as first written, a second server on a node published
     25965 to a container port nothing was listening on.

     The game is TCP only. Query is GameSpy's UDP protocol, which the
     server answers on its own game port number once it is enabled. */
  /* The client asks `_minecraft._tcp.<name>` when the address it is given has no port. */
  srv: { service: "minecraft", protocol: "tcp", port: "game" },
  ports: [
    { id: "game", label: "Game", offset: 0, container: 25565, protocol: "tcp", primary: true },
    { id: "query", label: "Query", offset: 1, container: 25565, protocol: "udp" },
    {
      id: "rcon",
      label: "RCON",
      offset: 2,
      protocol: "tcp",
      container: 25575,
      public: false,
      note: "private",
    },
  ],

  defaults: { memoryGb: 8, cpuLimit: 300, diskGb: 60, playersMax: 40 },
  limits: { memoryGb: [1, 32], cpuLimit: [50, 800], diskGb: [5, 250] },
  requirements: {
    /* 2 GB, not 1. Paper 1.21.4 given 1 GB (a 768 MB heap at 75%) was killed by the kernel at the end of its first start — Docker said
       OOMKilled, the node's log "Memory cgroup out of memory: Killed process (java) anon-rss:1036472kB" — on a Debian 13 VPS, October
       2026; the same server rebuilt at 2 GB booted and took a player. What a JVM needs outside its heap (class metadata, the code
       cache, a thread and a network buffer per connection) does not shrink with the heap, so a quarter of 1 GB is not enough for it.
       The slider still goes down to the platform's 1 GB: this is what the panel tells the operator and what a node has to have
       uncommitted for the wizard to place the server, not a wall (docs/games.md, on `memoryGbMin`). */
    memoryGbMin: 2,
    cpuPctMin: 50,
    diskGbMin: 5,
    os: ["linux"],
    arch: ["x64", "arm64"],
    /* Not Java: the image carries its own. Asking the node for it
       refused every machine that had not declared a runtime the server
       never uses. */
    capabilities: ["docker"],
  },

  install: {
    kind: "image",
    env: {
      /* The image refuses to start without this, and it is not a setting:
         there is no server to run if it is false. */
      EULA: "TRUE",
      /* The heap follows the server's memory limit. Left to itself the
         image starts Java with a 1 GB heap whatever the container is
         given, so an 8 GB server used one. Emptying MEMORY hands the
         decision to the JVM, which reads the container's limit; 75%
         leaves the rest for what a JVM needs outside its heap, because
         past the limit the kernel kills the process. Verified against
         the image at 2 GB: a 1.5 GB heap, booted. */
      MEMORY: "",
      JVM_XX_OPTS: "-XX:MaxRAMPercentage=75",
      // The Query port is declared, so it answers.
      ENABLE_QUERY: "TRUE",
    },
  },

  /* Every setting is a line of server.properties, written by the panel
     and read by the game when it starts: a change is saved at once and
     applies at the next restart. Until 0.11.0 they were the image's
     environment variables, which made each one a rebuild — the workload
     stopped, made again and started for a new MOTD.

     What the image does with the file, measured on
     itzg/minecraft-server:2026.9.1-java25 with Paper 26.2, October 2026,
     before anything here was changed. Its start script runs
     `mc-image-helper set-properties` over /data/server.properties on every
     start (OVERRIDE_SERVER_PROPERTIES defaults to true) with the image's
     /image/property-definitions.json, which maps a variable to each key —
     MOTD to motd, MAX_PLAYERS to max-players — and sets a key only when
     its variable is set. A file holding `motd=Hand edited`,
     `allow-flight=true`, `max-players=7` and `pvp=false`, started with
     only EULA, TYPE, VERSION, MEMORY, JVM_XX_OPTS and ENABLE_QUERY, came
     out with all four as they were and four lines added: enable-query,
     enable-rcon, rcon.port and a new rcon.password, which the image sets
     itself on every start. The same file started with MOTD=From env and
     PVP=true came out with those two overwritten. So the variables a
     setting used to be are all that has to go; SKIP_SERVER_PROPERTIES
     or OVERRIDE_SERVER_PROPERTIES=false are not needed, and would stop
     the image writing the query and RCON lines it relies on. Two more
     things the script does: it writes a default MOTD and white-list=false
     only when there is no server.properties at all, which is never the
     case here because the panel writes the file before the first start;
     and it rewrites the whole file as java.util.Properties does, as the
     server does again when it boots, so `motd=Hello: world!` reads back
     as `motd=Hello\: world\!` and the target is `syntax: "java"`.

     A server made before 0.11.0 still has those variables in its
     workload, and they would put a changed value back at the restart: a
     change to one of them rebuilds the server once (`formerEnv`), and its
     version panel says it needs a rebuild until then.

     Key names as Paper 26.2 writes them, from the server.properties it
     generated on a first start. Two of what this offered are no longer
     there: 1.21.9 moved pvp and enable-command-block into the world as
     game rules (pvp and, on 26.2, command_blocks_work). A 26.2 world
     started with pvp=false in its file answered "Gamerule pvp is currently
     set to: true". On 1.20.6 and 1.21.4 they are still lines of the file,
     and the two settings say what to type on the newer ones. */
  config: [
    {
      key: "motd",
      label: "MOTD",
      type: "string",
      target: { kind: "properties", file: "server.properties", key: "motd", syntax: "java" },
      formerEnv: "MOTD",
      default: "A Geeboard server",
      maxLength: 120,
      group: "Presentation",
      help: "The line shown under the server name in a player's list.",
      restartRequired: true,
    },
    {
      key: "mode",
      label: "Game mode",
      type: "enum",
      target: { kind: "properties", file: "server.properties", key: "gamemode", syntax: "java" },
      formerEnv: "MODE",
      default: "survival",
      options: [
        { value: "survival", label: "Survival" },
        { value: "creative", label: "Creative" },
        { value: "adventure", label: "Adventure" },
        { value: "spectator", label: "Spectator" },
      ],
      group: "World",
      help: "What a player gets the first time they join. Players already in the world keep theirs: change one from the console with gamemode <mode> <name>.",
      restartRequired: true,
    },
    {
      key: "difficulty",
      label: "Difficulty",
      type: "enum",
      target: { kind: "properties", file: "server.properties", key: "difficulty", syntax: "java" },
      formerEnv: "DIFFICULTY",
      default: "normal",
      options: [
        { value: "peaceful", label: "Peaceful" },
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
      group: "World",
      help: "Peaceful: no monsters, and hunger does no harm. From Easy to Hard, monsters hit harder at each step.",
      restartRequired: true,
    },
    {
      key: "hardcore",
      label: "Hardcore",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "hardcore", syntax: "java" },
      formerEnv: "HARDCORE",
      default: false,
      group: "World",
      help: "One life each. Death moves a player to spectator.",
      restartRequired: true,
    },
    {
      key: "seed",
      label: "World seed",
      type: "string",
      target: { kind: "properties", file: "server.properties", key: "level-seed", syntax: "java" },
      formerEnv: "SEED",
      default: "",
      maxLength: 64,
      group: "World",
      /* Read once, when the server generates its world on the first
         start; after that the world is on disk and the seed changes
         nothing. So it is chosen in the wizard and shown, not offered,
         afterwards — a rebuild for it took the server down to do nothing. */
      help: "The world is generated from it on the first start. Empty: a random one.",
      fixedAfterCreation: true,
      advanced: true,
    },
    {
      key: "levelType",
      label: "World type",
      type: "enum",
      /* The server writes it back as `minecraft\:normal`; the escape is
         the syntax's, and taken off when the file is read. */
      target: { kind: "properties", file: "server.properties", key: "level-type", syntax: "java" },
      default: "minecraft:normal",
      options: [
        { value: "minecraft:normal", label: "Default" },
        { value: "minecraft:flat", label: "Superflat" },
        { value: "minecraft:large_biomes", label: "Large biomes" },
        { value: "minecraft:amplified", label: "Amplified" },
      ],
      group: "World",
      help: "How the world is generated on the first start. Superflat is a build world with no terrain; Amplified asks the most of the server.",
      fixedAfterCreation: true,
    },
    {
      key: "commandBlocks",
      label: "Command blocks",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "enable-command-block", syntax: "java" },
      default: false,
      group: "World",
      help: "Lets command blocks run what operators put in them. Up to 1.21; from 26.1 it is a rule of the world: type gamerule command_blocks_work true in the console.",
      restartRequired: true,
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "max-players", syntax: "java" },
      formerEnv: "MAX_PLAYERS",
      default: 40,
      min: 1,
      max: 500,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "pvp",
      label: "PvP",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "pvp", syntax: "java" },
      formerEnv: "PVP",
      default: true,
      group: "Players",
      help: "Players can hurt each other. Up to 1.21; from 26.1 it is a rule of the world: type gamerule pvp false in the console.",
      restartRequired: true,
    },
    {
      key: "allowFlight",
      label: "Allow flight",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "allow-flight", syntax: "java" },
      default: false,
      group: "Players",
      help: "Off, the server kicks a player it sees flying in survival, which is what a flying mount or a jetpack mod looks like to it.",
      restartRequired: true,
    },
    {
      key: "whitelist",
      label: "Whitelist only",
      type: "boolean",
      /* The image's ENABLE_WHITELIST also set enforce-whitelist, which
         turns away the players not on the list when it is reloaded with
         the server running. A change here waits for a restart, which turns
         them away anyway, so the file's own line is left as it is. */
      target: { kind: "properties", file: "server.properties", key: "white-list", syntax: "java" },
      formerEnv: "ENABLE_WHITELIST",
      default: false,
      group: "Players",
      help: "Only players on the whitelist can join. Add them from the console with whitelist add <name>.",
      restartRequired: true,
    },
    {
      key: "onlineMode",
      label: "Verify accounts",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "online-mode", syntax: "java" },
      formerEnv: "ONLINE_MODE",
      default: true,
      group: "Players",
      help: "Turning this off lets anyone join under any name. Leave it on unless a proxy is doing the checking.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "resourcePack",
      label: "Resource pack",
      type: "string",
      target: { kind: "properties", file: "server.properties", key: "resource-pack", syntax: "java" },
      default: "",
      maxLength: 500,
      pattern: { regex: "^https?://\\S+$", message: "must be a link to the pack's .zip, starting with https://" },
      group: "Presentation",
      help: "A link to a .zip players are offered when they join. Empty: none.",
      restartRequired: true,
    },
    {
      key: "resourcePackRequired",
      label: "Require the resource pack",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "require-resource-pack", syntax: "java" },
      default: false,
      group: "Presentation",
      help: "A player who declines the pack is disconnected instead of joining without it.",
      restartRequired: true,
    },
    {
      key: "resourcePackPrompt",
      label: "Resource pack message",
      type: "string",
      /* JSON text to the game: a plain `Please accept` was logged as
         "Failed to parse resource pack prompt" and not shown, on 26.2. */
      target: { kind: "properties", file: "server.properties", key: "resource-pack-prompt", syntax: "java", json: true },
      default: "",
      maxLength: 200,
      group: "Presentation",
      help: "Shown to a player when the pack is offered. Empty: the game's own wording.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "resourcePackSha1",
      label: "Resource pack SHA-1",
      type: "string",
      /* Without it the server warns that a pack "will be updated on the
         client only if you change the name of the pack". */
      target: { kind: "properties", file: "server.properties", key: "resource-pack-sha1", syntax: "java" },
      default: "",
      maxLength: 40,
      pattern: { regex: "^[0-9a-fA-F]{40}$", message: "must be the 40 hexadecimal characters of the pack's SHA-1" },
      group: "Presentation",
      help: "The pack's checksum, so a player's game downloads it again when it changes. Empty: only a new link does that.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "viewDistance",
      label: "View distance",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "view-distance", syntax: "java" },
      formerEnv: "VIEW_DISTANCE",
      default: 10,
      min: 3,
      max: 32,
      group: "Performance",
      help: "Chunks. Each step costs memory and CPU on every player.",
      restartRequired: true,
    },
    {
      key: "simulationDistance",
      label: "Simulation distance",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "simulation-distance", syntax: "java" },
      default: 10,
      min: 3,
      max: 32,
      group: "Performance",
      help: "Chunks around each player where the world moves: crops grow, mobs act. It costs more CPU than view distance, so it is usually lower.",
      restartRequired: true,
    },
    {
      key: "maxTickTime",
      label: "Max tick time",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "max-tick-time", syntax: "java" },
      default: 60000,
      min: -1,
      max: 86400000,
      group: "Performance",
      help: "Milliseconds one tick may take before the server decides it has hung and stops itself. -1 turns that watchdog off.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "spawnProtection",
      label: "Spawn protection",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "spawn-protection", syntax: "java" },
      formerEnv: "SPAWN_PROTECTION",
      default: 16,
      min: 0,
      max: 256,
      group: "World",
      help: "Blocks around the spawn point that only operators can build on. 0 turns it off.",
      advanced: true,
      restartRequired: true,
    },
    /* There was a "Keep inventory on death" here, on KEEP_INVENTORY, and
       it did nothing: keepInventory is a game rule, kept in the world's
       level.dat, and the image maps no variable to it. On
       itzg/minecraft-server:2026.9.1-java25 with Vanilla 26.2, October
       2026, a server started with KEEP_INVENTORY=true answered "Gamerule
       keep_inventory is currently set to: false". It is set from the
       console — gamerule keepInventory true on 1.21.4, keep_inventory on
       26.2, which refused the old name — and a value stored for it by an
       older panel renders nothing. */
  ],

  health: {
    probes: [
      { kind: "port", port: "game" },
      { kind: "query", protocol: "minecraft-ping" },
    ],
    bootGraceSeconds: 180,
    readyPattern: 'Done \\([\\d.]+s\\)! For help',
    crashPattern: "(java\\.lang\\.OutOfMemoryError|Exception in server tick loop)",
  },

  console: {
    stopCommand: "stop",
    saveCommand: "save-all",
    broadcastCommand: "say %s",
    examples: ["list", "whitelist add <player>", "op <player>", "time set day", "save-all"],
    /* With a slash or without: `/list` and `list` answered the same on
       vanilla 1.21.4, October 2026. The server does not repeat a command
       typed at it, only its answer. */
    hint: "With a slash or without. The server prints only its answer, not the command.",
    /* "[22:06:16 INFO]: Steve joined the game" from Paper, and the same
       after "[Server thread/INFO]: " from vanilla and Fabric. A Java
       username is letters, digits and underscores, which is what keeps a
       chat line — "<Steve> Bob joined the game" — from matching. */
    players: {
      join: "\\]: (?<name>[A-Za-z0-9_]{1,16}) joined the game$",
      leave: "\\]: (?<name>[A-Za-z0-9_]{1,16}) left the game$",
    },
  },

  versionSources: [{ provider: "static" }, { provider: "minecraft-launcher" }],

  /* One line per server software. A world moves between them, but its
     plugins and mods do not — so Paper to Fabric is a migration somebody
     chooses, never an update somebody is offered.

     The image is pinned, like Terraria's. `java21` is rebuilt every few
     days, and what starts the server — the entrypoint, the memory flags,
     where it downloads configs from — should be the same bytes tomorrow
     as the day a version was verified. */
  versions: [
    {
      id: "paper-1-21-4",
      line: "paper",
      label: "Paper 1.21.4",
      upstream: "1.21.4",
      image: "itzg/minecraft-server:2026.9.1-java21",
      env: { TYPE: "PAPER", VERSION: "1.21.4" },
      note: "The last 1.21 this was verified on, for a world or a plugin not ready for 26",
      released: "2024-12-03",
      channel: "stable",
    },
    {
      id: "purpur-1-21-4",
      line: "purpur",
      label: "Purpur 1.21.4",
      upstream: "1.21.4",
      image: "itzg/minecraft-server:2026.9.1-java21",
      env: { TYPE: "PURPUR", VERSION: "1.21.4" },
      note: "Paper with more knobs, for a PvP server that needs them",
      released: "2024-12-03",
      channel: "stable",
    },
    {
      id: "fabric-1-21-4",
      line: "fabric",
      label: "Fabric 1.21.4",
      upstream: "1.21.4",
      image: "itzg/minecraft-server:2026.9.1-java21",
      env: { TYPE: "FABRIC", VERSION: "1.21.4" },
      note: "The mod loader, when the modpack asks for it",
      released: "2024-12-03",
      channel: "stable",
    },
    {
      id: "vanilla-1-21-4",
      line: "vanilla",
      label: "Vanilla 1.21.4",
      upstream: "1.21.4",
      image: "itzg/minecraft-server:2026.9.1-java21",
      env: { TYPE: "VANILLA", VERSION: "1.21.4" },
      note: "Mojang's own server, with nothing added",
      released: "2024-12-03",
      channel: "stable",
    },
    {
      id: "paper-1-20-6",
      line: "paper",
      label: "Paper 1.20.6",
      upstream: "1.20.6",
      image: "itzg/minecraft-server:2026.9.1-java21",
      env: { TYPE: "PAPER", VERSION: "1.20.6" },
      note: "Held back for a plugin that has not caught up yet",
      released: "2024-04-29",
      channel: "legacy",
    },
    /* Minecraft changed how it counts in 2026 — 26.1, 26.2, 26.3, the year
       and then the drop — and with 26.1 it started asking for Java 25.

       Measured against the bare images, September 2026, before anything
       here was written. The `java21` tag every version above uses resolves
       and downloads Paper 26.3 and then refuses to run it: "Minecraft 26.1
       and newer requires running the server with Java 25 or above." The
       same release's `java25` tag boots 26.2 and 26.3 with everything else
       unchanged — the world in /data, the same "Done (…)! For help" line,
       `list` and `stop` on its console, a clean exit after saving every
       dimension, and the status ping answered. So the new versions are a
       different image and nothing else, and the old ones stay on the image
       they were verified on rather than being moved to a Java they were
       not run with.

       They go after the 1.x entries on purpose: the Docker-backed verify
       scripts cover `versions[0]`'s image with a stand-in, and the order
       here decides nothing else — the newest stable one is found by
       number. */
    {
      id: "paper-26-2",
      line: "paper",
      label: "Paper 26.2",
      upstream: "26.2",
      image: "itzg/minecraft-server:2026.9.1-java25",
      env: { TYPE: "PAPER", VERSION: "26.2" },
      note: "The newest Minecraft that Paper calls stable. Players choose 26.2 in their launcher to join",
      released: "2026-06-16",
      channel: "stable",
      recommended: true,
    },
    {
      id: "paper-26-3",
      line: "paper",
      label: "Paper 26.3",
      upstream: "26.3",
      image: "itzg/minecraft-server:2026.9.1-java25",
      env: { TYPE: "PAPER", VERSION: "26.3" },
      /* What a game client updated this week joins. Paper's own builds for
         it are still on its alpha channel, which is why it is a preview
         here however stable Mojang's half is: a production server is not
         offered it as an update. */
      note: "What an up-to-date game client joins. Paper's builds for it are still alpha",
      released: "2026-09-15",
      channel: "preview",
    },
  ],

  templates: [
    {
      id: "survival",
      name: "Survival",
      blurb: "The default world, with the guardrails an operator usually wants on day one.",
      summary: "Whitelist on, hard difficulty",
      config: { mode: "survival", difficulty: "hard", whitelist: true },
    },
    {
      id: "creative",
      name: "Creative",
      blurb: "Flight and unlimited blocks, for a build server nobody has to survive.",
      summary: "Creative mode, peaceful, whitelist off",
      config: { mode: "creative", difficulty: "peaceful", whitelist: false },
    },
    {
      id: "hardcore",
      name: "Hardcore",
      blurb: "One life each. Death puts a player into spectator rather than removing them.",
      summary: "Hardcore, hard difficulty, whitelist on",
      config: { mode: "survival", difficulty: "hard", hardcore: true, whitelist: true },
    },
    {
      id: "minigames",
      name: "Minigames",
      blurb: "Adventure mode with a fixed spawn, for a hub that hands players off elsewhere.",
      summary: "Adventure mode, spawn protection on, PvP off",
      config: { mode: "adventure", pvp: false, spawnProtection: 32 },
    },
  ],
};
