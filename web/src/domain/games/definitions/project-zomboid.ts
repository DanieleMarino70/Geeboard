import type { GameDefinition } from "../types";

/* Project Zomboid.

   Run through danixu86/project-zomboid-dedicated-server, chosen in
   September 2026 over renegademaster/zomboid-dedicated-server, which this
   definition used before any of it had been run. What decided it, each
   checked against the image rather than its README:

     - The game is installed when the image is built, so a tag pins a
       build — 42.20.4, 41.78.19 — the way Terraria's and Minecraft's tags
       do. The old image ran SteamCMD against a branch on every start, so
       "build 41" silently became build 42 on a restart.
     - It writes to the server's .ini only the keys whose variables are
       set, and leaves the mod keys alone when told to. The old image
       rewrote thirteen keys — MaxPlayers, PauseEmpty, Open, the password
       — from its own environment on every start, so a setting saved here
       lasted until the next restart.
     - It reads the game's console from the container's input, so the
       panel's console, a save before a backup and a scheduled broadcast
       all reach the game. Verified: a line typed at it is logged as
       "command entered via server console (System.in)".

   What it does not do is save on SIGTERM: stopped by a signal it was
   killed after ninety seconds, exit 137. It saves and exits on `quit`,
   which is what the panel sends — measured at about forty-five seconds
   from `quit` to the process gone, most of it Steam and the JVM letting
   go after the save itself, which took under a second. */

/* The world's rules, as a file. Named once: every world-rule field
   writes into the same table in the same file. */
const SANDBOX_FILE = "Server/geeboard_SandboxVars.lua";

/* The game's options are numbered from 1 in the order it lists them,
   and an empty choice leaves the key to the preset. */
function presetOr(labels: string[]): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "As the preset sets it" },
    ...labels.map((label, i) => ({ value: String(i + 1), label })),
  ];
}

// WaterShut and ElecShut share a scale; build 42 added the last two steps.
const SHUTOFF_B41 = ["Instant", "0 to 30 days", "0 to 2 months", "0 to 6 months", "0 to 1 year", "0 to 5 years", "2 to 6 months"];
const SHUTOFF_B42 = [...SHUTOFF_B41, "6 to 12 months", "Never"];

// A rate the game holds as a float (0 to 1000); the form offers the usual ones.
const XP_RATES = [
  { value: "", label: "As the preset sets it" },
  ...["0.5", "1.0", "1.5", "2.0", "3.0", "5.0"].map((value) => ({ value, label: `${value}×` })),
];

export const PROJECT_ZOMBOID: GameDefinition = {
  id: "project-zomboid",
  name: "Project Zomboid",
  family: "Project Zomboid",
  art: "PROJECT\nZOMBOID",
  official: false,
  blurb: "Persistent apocalypse worlds with sandbox rules set when the world begins.",

  portBase: 16261,
  portSpan: 200,
  /* One to one, host to container, unlike Minecraft and Terraria. The
     server tells clients which second port to use, so it has to be told
     the one it actually got — see resourceEnv — or the second server on a
     node would send its players to the first one's port. */
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "direct", label: "Direct", offset: 1, protocol: "udp", note: "player connections" },
  ],

  defaults: { memoryGb: 8, cpuLimit: 300, diskGb: 30, playersMax: 16 },
  limits: { memoryGb: [6, 32], cpuLimit: [200, 800], diskGb: [20, 200] },
  requirements: {
    memoryGbMin: 6,
    cpuPctMin: 200,
    diskGbMin: 20,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker"],
  },

  /* The whole of the game's data: Server/ (its settings), Saves/, db/
     (accounts and the whitelist) and Logs/. The image fixes this
     directory's ownership for its `steam` user on every start, which is
     why the mount goes here rather than pointing the game elsewhere —
     anywhere else would belong to root on a Linux node, and the server
     could not write its world. */
  dataPath: "/home/steam/Zomboid",

  resourceEnv: {
    /* The image passes MEMORY to the JVM as both -Xms and -Xmx. Unset, the
       launcher asks for 8 GB whatever the container allows. Three
       quarters leaves room for the JVM's own memory and Steam's; a 6 GB
       probe with a 4.5 GB heap booted a new world at 3.5 GB resident. */
    memory: { name: "MEMORY", percent: 75 },
    ports: { game: "PORT", direct: "UDPPORT" },
    /* The image refuses to start a new world without an admin password,
       then prints it on every start ("pzexe: arg: …"). Random, never
       stored, and blanked out of every console the panel shows. Nobody
       logs in as `admin`: make your own character an admin from the
       console with `setaccesslevel <name> admin`. */
    secrets: { ADMINPASSWORD: "gbadmin" },
  },

  install: {
    kind: "image",
    env: {
      /* Names the settings file (Server/geeboard.ini) and the save. Fixed:
         changing it would start a new world beside the old one. */
      SERVERNAME: "geeboard",
      /* Otherwise the image clears Mods and WorkshopItems on every start.
         Mods are not managed by Geeboard yet; this keeps the image from
         managing them either. */
      SELF_MANAGED_MODS: "true",
    },
    /* The game zips its own world into Zomboid/backups on every start —
       inside the directory Geeboard archives, so each Geeboard snapshot
       would carry five of the game's, and the world size would count
       them. Geeboard backs up; the game does not need to. */
    files: [
      {
        file: "Server/geeboard.ini",
        kind: "properties",
        entries: { BackupsOnStart: "false", BackupsOnVersionChange: "false", BackupsPeriod: "0" },
      },
    ],
  },

  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "PublicName" },
      default: "Geeboard",
      maxLength: 60,
      group: "Presentation",
      help: "What the in-game server browser shows.",
      restartRequired: true,
    },
    {
      key: "description",
      label: "Description",
      type: "string",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "PublicDescription" },
      default: "",
      maxLength: 240,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "welcomeMessage",
      label: "Welcome message",
      type: "string",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "ServerWelcomeMessage" },
      default: "Welcome to a Geeboard server.",
      maxLength: 480,
      group: "Presentation",
      help: "Shown in chat when a player joins. <LINE> starts a new line.",
      restartRequired: true,
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "MaxPlayers" },
      default: 16,
      min: 1,
      max: 100,
      group: "Players",
      help: "Each player costs memory. Past about 32 the node matters more than the setting.",
      restartRequired: true,
    },
    {
      key: "password",
      label: "Server password",
      type: "string",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "Password" },
      default: "",
      maxLength: 60,
      group: "Players",
      help: "Left empty, anyone who knows the address can join.",
      restartRequired: true,
    },
    {
      key: "public",
      label: "List in the server browser",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "Public" },
      default: false,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "open",
      label: "Anyone can create an account",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "Open" },
      default: true,
      group: "Players",
      help: "Off, only players already on the server's whitelist can join. Add them from the console with adduser.",
      restartRequired: true,
    },
    {
      key: "pvp",
      label: "PvP",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "PVP" },
      default: false,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "pauseEmpty",
      label: "Pause when empty",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "PauseEmpty" },
      default: true,
      group: "World",
      help: "Time stops when nobody is on, so the world does not rot while you sleep.",
      restartRequired: true,
    },
    {
      key: "autosaveMinutes",
      label: "Save every",
      type: "number",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "SaveWorldEveryMinutes" },
      /* The game's own default is 0: save on shutdown only. A backup of a
         running server is of whatever was last saved, so that default
         made every scheduled backup as old as the last restart. */
      default: 10,
      min: 0,
      max: 120,
      group: "World",
      help: "Minutes between saves. 0 saves only when the server stops — and a backup of a running server is of the last save.",
      restartRequired: true,
    },
    /* ── The world's rules ───────────────────────────────────────────

       Written by Geeboard into Server/geeboard_SandboxVars.lua when the
       server is created, before its first start: the game's own preset
       by `require`, then each choice below as an assignment over it.
       Measured on this PC, September 2026, on both images:

         - A partial file is accepted; the game fills every other option
           from its defaults and rewrites the file in full, with its own
           comments, before "Loading world" (log: "writing …/geeboard_
           SandboxVars.lua"). The rewritten file is the game's own record
           of what it loaded, and is what the settings form reads.
         - `SandboxVars = require "Sandbox/Extinction"` followed by
           assignments loads the preset and the assignments: the rewrite
           held Extinction's FoodLootNew 0.4, Sight 2, Hearing 2 and the
           overridden Zombies 5, PopulationMultiplier 0.15. Build 41 does
           the same with a preset it has; it exits on one it does not
           ("attempted index of non-table"), which is why each build lists
           its own.
         - The file is read on every start, not only the first: a hand
           edit with the server stopped (Zombies 3 → 6) was in the
           rewrite after the restart. So "fixed after creation" is the
           panel's rule, not the game's: the form shows the file, and
           changes are made in Files with the server stopped.
         - Zombies alone does not move PopulationMultiplier on load
           (Zombies 6 over Apocalypse left it at 0.65), so the population
           choice writes both, with the multipliers the game's own comment
           gives for each count.

       Two builds, two shapes: build 42 has six zombie counts, four
       speeds, a respawn option and a 27-step day; build 41 has five,
       three, none and 25 steps that start differently. Each field
       names its line, and the settings form and the wizard show the
       right one. "As the preset sets it" leaves a key unwritten, so the
       preset's own value stands. */
    {
      key: "sandboxPreset",
      label: "World rules",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua-base", file: SANDBOX_FILE, table: "SandboxVars", prefix: "Sandbox/" },
      default: "Apocalypse",
      options: [
        { value: "Apocalypse", label: "Apocalypse" },
        { value: "SixMonthsLater", label: "Six Months Later" },
        { value: "Outbreak", label: "Outbreak" },
        { value: "Rising", label: "Rising" },
        { value: "Extinction", label: "Extinction" },
      ],
      group: "World rules",
      help: "The game's own preset: zombies, loot, power and water. The choices below are written over it when the world is created; afterwards the game keeps them in Server/geeboard_SandboxVars.lua, which it reads on every start — edit it with the server stopped.",
      fixedAfterCreation: true,
    },
    {
      key: "sandboxPreset",
      label: "World rules",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua-base", file: SANDBOX_FILE, table: "SandboxVars", prefix: "Sandbox/" },
      default: "Apocalypse",
      // What 41.78.19 ships in media/lua/shared/Sandbox.
      options: [
        { value: "Apocalypse", label: "Apocalypse" },
        { value: "Survivor", label: "Survivor" },
        { value: "Builder", label: "Builder" },
        { value: "Beginner", label: "Beginner" },
        { value: "FirstWeek", label: "First Week" },
        { value: "SixMonthsLater", label: "Six Months Later" },
        { value: "Survival", label: "Survival" },
      ],
      group: "World rules",
      help: "The game's own preset: zombies, loot, power and water. The choices below are written over it when the world is created; afterwards the game keeps them in Server/geeboard_SandboxVars.lua, which it reads on every start — edit it with the server stopped.",
      fixedAfterCreation: true,
    },
    {
      key: "zombiePopulation",
      label: "Zombie population",
      type: "enum",
      lines: ["b42"],
      target: {
        kind: "lua",
        file: SANDBOX_FILE,
        table: "SandboxVars",
        key: "Zombies",
        /* The multipliers the game's own comment on PopulationMultiplier
           gives for each count. Set alongside, because the count alone
           does not move it on load. */
        also: [
          {
            key: "ZombieConfig.PopulationMultiplier",
            byValue: { "1": "2.5", "2": "1.6", "3": "1.2", "4": "0.65", "5": "0.15", "6": "0.0" },
          },
        ],
      },
      default: "",
      options: presetOr(["Insane", "Very high", "High", "Normal", "Low", "None"]),
      group: "World rules",
      fixedAfterCreation: true,
    },
    {
      key: "zombiePopulation",
      label: "Zombie population",
      type: "enum",
      lines: ["b41"],
      target: {
        kind: "lua",
        file: SANDBOX_FILE,
        table: "SandboxVars",
        key: "Zombies",
        // Build 41's own comment: 4.0 Insane, 3.0 Very High, 2.0 High, 1.0 Normal, 0.35 Low.
        also: [{ key: "ZombieConfig.PopulationMultiplier", byValue: { "1": "4.0", "2": "3.0", "3": "2.0", "4": "1.0", "5": "0.35" } }],
      },
      default: "",
      options: presetOr(["Insane", "Very high", "High", "Normal", "Low"]),
      group: "World rules",
      fixedAfterCreation: true,
    },
    {
      key: "zombieSpeed",
      label: "Zombie speed",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Speed" },
      default: "",
      options: presetOr(["Sprinters", "Fast shamblers", "Shamblers", "Random"]),
      group: "World rules",
      fixedAfterCreation: true,
    },
    {
      key: "zombieSpeed",
      label: "Zombie speed",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Speed" },
      default: "",
      options: presetOr(["Sprinters", "Fast shamblers", "Shamblers"]),
      group: "World rules",
      fixedAfterCreation: true,
    },
    {
      key: "zombieRespawn",
      label: "Zombie respawn",
      type: "enum",
      // Build 41 has no such option; its respawn is ZombieConfig.RespawnHours.
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieRespawn" },
      default: "",
      options: presetOr(["High", "Normal", "Low", "None"]),
      group: "World rules",
      help: "How often new zombies are added to the world.",
      fixedAfterCreation: true,
    },
    {
      key: "dayLength",
      label: "Day length",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "DayLength" },
      default: "",
      options: presetOr([
        "15 minutes",
        "30 minutes",
        "1 hour",
        "1 hour 30 minutes",
        "2 hours",
        ...Array.from({ length: 21 }, (_, i) => `${i + 3} hours`),
        "Real time",
      ]),
      group: "World rules",
      help: "How long a day in the game takes.",
      fixedAfterCreation: true,
    },
    {
      key: "dayLength",
      label: "Day length",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "DayLength" },
      default: "",
      // Build 41 has no 1 hour 30 minutes step and no real-time step.
      options: presetOr(["15 minutes", "30 minutes", "1 hour", ...Array.from({ length: 22 }, (_, i) => `${i + 2} hours`)]),
      group: "World rules",
      help: "How long a day in the game takes.",
      fixedAfterCreation: true,
    },
    {
      key: "startMonth",
      label: "Starting month",
      type: "enum",
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "StartMonth" },
      default: "",
      options: presetOr([
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ]),
      group: "World rules",
      fixedAfterCreation: true,
    },
    {
      key: "waterShutoff",
      label: "Water shutoff",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "WaterShut" },
      default: "",
      options: presetOr(SHUTOFF_B42),
      group: "World rules",
      help: "How long after the start taps stop running.",
      fixedAfterCreation: true,
    },
    {
      key: "waterShutoff",
      label: "Water shutoff",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "WaterShut" },
      default: "",
      options: presetOr(SHUTOFF_B41),
      group: "World rules",
      help: "How long after the start taps stop running.",
      fixedAfterCreation: true,
    },
    {
      key: "powerShutoff",
      label: "Power shutoff",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ElecShut" },
      default: "",
      options: presetOr(SHUTOFF_B42),
      group: "World rules",
      help: "How long after the start the electricity goes out for good.",
      fixedAfterCreation: true,
    },
    {
      key: "powerShutoff",
      label: "Power shutoff",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ElecShut" },
      default: "",
      options: presetOr(SHUTOFF_B41),
      group: "World rules",
      help: "How long after the start the electricity goes out for good.",
      fixedAfterCreation: true,
    },
    {
      key: "xpMultiplier",
      label: "XP multiplier",
      type: "enum",
      lines: ["b42"],
      target: {
        kind: "lua",
        file: SANDBOX_FILE,
        table: "SandboxVars",
        key: "MultiplierConfig.Global",
        /* Build 42 applies the global rate only while the toggle is on,
           and the Outbreak preset ships it off with per-skill rates
           instead — a rate written without the toggle would do nothing. */
        also: [{ key: "MultiplierConfig.GlobalToggle", value: "true" }],
      },
      default: "",
      options: XP_RATES,
      group: "World rules",
      help: "How fast every skill levels. Replaces the preset's per-skill rates.",
      fixedAfterCreation: true,
    },
    {
      key: "xpMultiplier",
      label: "XP multiplier",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "XpMultiplier" },
      default: "",
      options: XP_RATES,
      group: "World rules",
      help: "How fast every skill levels.",
      fixedAfterCreation: true,
    },
    {
      key: "globalChat",
      label: "Global chat",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "GlobalChat" },
      default: true,
      group: "Players",
      advanced: true,
      restartRequired: true,
    },
  ],

  health: {
    probes: [{ kind: "log", pattern: "SERVER STARTED" }, { kind: "process" }],
    /* A new world generates before the server listens: about four minutes
       on this machine. Calling it unhealthy before then would restart a
       server that was working perfectly. */
    bootGraceSeconds: 900,
    readyPattern: "SERVER STARTED",
    crashPattern: "(java\\.lang\\.OutOfMemoryError|Fatal error)",
  },

  console: {
    stopCommand: "quit",
    // Measured at about 45 seconds from `quit` to the process gone.
    stopGraceSeconds: 90,
    saveCommand: "save",
    broadcastCommand: 'servermsg "%s"',
    examples: ["players", "save", "setaccesslevel <name> admin", "servermsg \"<text>\"", "kickuser <name>"],
    /* From the server's own format strings (GameServer, 42.20.4): a
       login ends in `… "<user>" fully connected …` and a departure in
       `Disconnected player "<user>" …`. The names are the account names
       players log in with, quoted, which is what keeps a chat line from
       matching. Not yet seen with a real client connected. */
    players: {
      join: '"(?<name>[^"]{1,50})" fully connected',
      leave: 'Disconnected player "(?<name>[^"]{1,50})"',
    },
  },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 380870 }],

  /* Build 42 went stable with 42.20 on 29 July 2026 and took the public
     branch with it; build 41 moved to `legacy41`. Three lines, because
     none of these open each other's worlds.

     Each version is a pinned image tag with the game already inside it.
     A newer build on Steam is not installed until a version here names
     the tag that carries it — which is the point: a restart must never
     be what moves a world to a build it cannot go back from. */
  versions: [
    {
      id: "b42",
      line: "b42",
      steamBranch: "public",
      label: "Build 42",
      upstream: "42.20.4",
      image: "danixu86/project-zomboid-dedicated-server:42.20.4-release",
      note: "The public branch — what a player's Steam client installs. Build 41 worlds do not open in it.",
      released: "2026-08-26",
      channel: "stable",
      recommended: true,
    },
    {
      id: "b41",
      formerIds: ["b41-stable"],
      line: "b41",
      steamBranch: "legacy41",
      label: "Build 41",
      upstream: "41.78.19",
      image: "danixu86/project-zomboid-dedicated-server:41.78.19-release",
      note: "The legacy41 branch, for worlds and mods that cannot move to build 42. Fixes only.",
      released: "2026-04-20",
      channel: "legacy",
    },
    {
      /* Kept, and refused, rather than deleted: servers created on it
         still need to resolve to something that says what they are. */
      id: "b42-unstable",
      line: "b42-unstable",
      label: "Build 42 · unstable",
      upstream: "42.19.0",
      image: "danixu86/project-zomboid-dedicated-server:42.19.0-unstable",
      note: "The unstable branch is gone. Its worlds open in neither 42.20 nor build 41.",
      released: "2026-05-20",
      channel: "preview",
      supported: false,
    },
  ],

  templates: [
    {
      id: "survival",
      name: "Survival",
      blurb: "The game's standard apocalypse, paused while nobody is playing.",
      summary: "Apocalypse rules, PvE, pause when empty",
      config: { sandboxPreset: "Apocalypse", pvp: false, pauseEmpty: true },
    },
    {
      id: "pvp",
      name: "PvP",
      blurb: "Players can hurt each other, and the world keeps running without them.",
      summary: "Apocalypse rules, PvP on, always running",
      config: { sandboxPreset: "Apocalypse", pvp: true, pauseEmpty: false },
    },
    {
      id: "six-months-later",
      name: "Six Months Later",
      blurb: "No power, no water, picked-over loot — for a group that has survived before.",
      summary: "Six Months Later rules, PvE, 8 players",
      config: { sandboxPreset: "SixMonthsLater", pvp: false, maxPlayers: 8 },
    },
  ],
};
