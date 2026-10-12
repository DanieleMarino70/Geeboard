import type { GameDefinition } from "../types";
import { presetValuesOf } from "../zomboid-presets";

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

/* WaterShut and ElecShut share a scale; build 42 added the last step.
   Build 41's eighth, 6 to 12 months, was left out here until October
   2026: 41.78.19's SandboxOptions makes both with eight options, and its
   own Beginner preset sets the eighth. */
const SHUTOFF_B41 = ["Instant", "0 to 30 days", "0 to 2 months", "0 to 6 months", "0 to 1 year", "0 to 5 years", "2 to 6 months", "6 to 12 months"];
const SHUTOFF_B42 = [...SHUTOFF_B41, "Never"];

/* The zombie lore options, in the order the game numbers them (its
   Sandbox translations: ZMemory, ZSight, ZHearing). Build 42 added the
   last of each. */
const MEMORY_B41 = ["Long", "Normal", "Short", "None", "Random"];
const SIGHT_B41 = ["Eagle", "Normal", "Poor", "Random"];
const HEARING_B41 = ["Pinpoint", "Normal", "Poor", "Random"];

/* Build 42's loot respawn is a number of in-game hours, 0 for never
   (HoursForLootRespawn; build 41's LootRespawn steps are gone). The form
   offers build 41's steps in hours. */
const LOOT_HOURS = [
  { value: "", label: "As the preset sets it" },
  { value: "0", label: "Never" },
  { value: "24", label: "Every day" },
  { value: "168", label: "Every week" },
  { value: "720", label: "Every month" },
  { value: "1440", label: "Every two months" },
];

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
  /* The store page's app id, not the server's (380870): on 2026-10-12 its
     library poster was a JPEG of 600 × 900, 211,882 bytes. Its name is at
     the foot, in white over the crowd: the square mark is cut from the
     bottom (looked at on 2026-10-13). */
  poster: { steam: 108600, focusY: 1 },
  official: false,
  // The one game here whose mods the panel installs, on both builds.
  blurb: "Persistent apocalypse worlds with sandbox rules set when the world begins, and Steam Workshop mods.",

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

  /* Where the game puts what it downloads from the Workshop. Outside the
     mounted directory, so without this every rebuild fetches every mod
     again — and inside it would put them in every backup, which is the
     wrong half of the bargain: a mod is re-downloadable, a world is not. */
  cachePaths: ["/home/steam/pz-dedicated/steamapps/workshop"],

  /* Mods, through the game's own Workshop client.

     `WorkshopItems` is what it downloads and `Mods` is what it loads,
     both in the settings file this definition already writes. The image
     is told SELF_MANAGED_MODS below, so it leaves both keys alone and
     what the panel wrote is what the game reads. Measured, on 41.78.19:
     an id in `WorkshopItems` and nothing else is enough — the server
     asks Steam anonymously and lands the files under `contentPath`,
     `<id>/mods/<ModId>/mod.info`, which is where the mod ids come from.

     Build 42 moved that mod.info into a folder per game version beside a
     `common/`, and stopped reading the one at the top: measured on
     42.20.4, a Build 41 mod is "not found" and the server starts without
     it. Which folder a build reads is in domain/games/mod-builds.ts. */
  mods: {
    provider: "steam-workshop",
    appId: 108600,
    contentPath: "/home/steam/pz-dedicated/steamapps/workshop/content/108600",
    items: { file: "Server/geeboard.ini", key: "WorkshopItems", separator: ";" },
    enabled: { file: "Server/geeboard.ini", key: "Mods", separator: ";" },
    layout: { versionFoldersFrom: "42.0", common: "common" },
    // The Workshop's own tags for the two builds, as Steam returns them.
    buildTags: { "Build 41": 41, "Build 42": 42 },
    /* The item tags of Zomboid's Workshop browse page, read off it on 9 October 2026 (the guide and
       language tags after them are left out: they are not what a mod is). */
    categories: [
      "Animals", "Audio", "Balance", "Building", "Clothing/Armor", "Farming", "Food", "Framework", "Hardmode", "Interface", "Items",
      "Language/Translation", "Literature", "Map", "Military", "Misc", "Models", "Multiplayer", "Pop Culture", "QoL", "Realistic",
      "Silly/Fun", "Skills", "Textures", "Traits", "Vehicles", "Weapons",
    ],
  },

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
       console with `setaccesslevel "<name>" admin`. */
    secrets: { ADMINPASSWORD: "gbadmin" },
  },

  install: {
    kind: "image",
    env: {
      /* Names the settings file (Server/geeboard.ini) and the save. Fixed:
         changing it would start a new world beside the old one. */
      SERVERNAME: "geeboard",
      /* Otherwise the image clears Mods and WorkshopItems on every start.
         The panel writes both, from the server's Mods tab; this keeps the
         image from overwriting them. */
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
      help: "Shown under the name in the server browser.",
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
      secret: true,
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
    /* Server options, not world rules: keys of Server/geeboard.ini that
       the game reads on every start, so they can change at any time. Each
       key and its default is zombie/network/ServerOptions on both images
       (javap, October 2026: SleepAllowed false, SleepNeeded false,
       PlayerSafehouse false, SafehouseAllowRespawn false, Faction true),
       and the help says what the game's own tooltip says. */
    {
      key: "sleepAllowed",
      label: "Players can sleep",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "SleepAllowed" },
      default: false,
      group: "World",
      help: "A tired character can sleep, but does not have to.",
      restartRequired: true,
    },
    {
      key: "sleepNeeded",
      label: "Players need sleep",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "SleepNeeded" },
      default: false,
      group: "World",
      help: "Characters get tired and have to sleep, as in single player. Only when Players can sleep is on.",
      restartRequired: true,
    },
    {
      key: "playerSafehouse",
      label: "Players can claim safehouses",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "PlayerSafehouse" },
      default: false,
      group: "Players",
      help: "Players, not only admins, can claim a building as their safehouse and invite others into it.",
      restartRequired: true,
    },
    {
      key: "safehouseRespawn",
      label: "Respawn in the safehouse",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "SafehouseAllowRespawn" },
      default: false,
      group: "Players",
      help: "A player who dies starts again in the safehouse they belonged to.",
      restartRequired: true,
    },
    {
      key: "factions",
      label: "Factions",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "Faction" },
      default: true,
      group: "Players",
      help: "Players can make factions and wear their tag.",
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

       Two builds, two shapes: build 42 has a respawn option, a 27-step
       day, a ninth shutoff step, loot respawn in hours and a sixth
       memory step; build 41 has no respawn option, 26 steps that start
       differently, loot respawn in five steps. (This said build 41 had
       five zombie counts, three speeds and 25 steps: 41.78.19's own
       SandboxOptions makes six, four and 26, read with javap in October
       2026, and its Beginner preset uses the shutoff step this left out.)
       Each field names its line, and the settings form and the wizard
       show the right one. "As the preset sets it" leaves a key
       unwritten, so the preset's own value stands, and the form says
       what that is from zomboid-presets.ts. */
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
      presetValues: presetValuesOf("b42", "Zombies"),
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
        /* Build 41's own comment: 4.0 Insane, 3.0 Very High, 2.0 High, 1.0
           Normal, 0.35 Low. Its sixth count, None, is in its SandboxOptions
           and its translations and not in that comment: 0.0, as build 42's
           comment gives for the same choice. */
        also: [{ key: "ZombieConfig.PopulationMultiplier", byValue: { "1": "4.0", "2": "3.0", "3": "2.0", "4": "1.0", "5": "0.35", "6": "0.0" } }],
      },
      default: "",
      options: presetOr(["Insane", "Very high", "High", "Normal", "Low", "None"]),
      presetValues: presetValuesOf("b41", "Zombies"),
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
      presetValues: presetValuesOf("b42", "ZombieLore.Speed"),
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
      // Random too: 41.78.19 makes ZombieLore.Speed with four options, as build 42 does.
      options: presetOr(["Sprinters", "Fast shamblers", "Shamblers", "Random"]),
      presetValues: presetValuesOf("b41", "ZombieLore.Speed"),
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
      presetValues: presetValuesOf("b42", "ZombieRespawn"),
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
      presetValues: presetValuesOf("b42", "DayLength"),
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
      /* Build 41 has no 1 hour 30 minutes step. It does have real time, its
         26th: left out here until October 2026, though 41.78.19 makes
         DayLength with 26 options and names the last "Real-time". */
      options: presetOr(["15 minutes", "30 minutes", "1 hour", ...Array.from({ length: 22 }, (_, i) => `${i + 2} hours`), "Real time"]),
      presetValues: presetValuesOf("b41", "DayLength"),
      group: "World rules",
      help: "How long a day in the game takes.",
      fixedAfterCreation: true,
    },
    {
      key: "nightLength",
      label: "Night length",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "NightLength" },
      default: "",
      options: presetOr(["Always night", "Long", "Normal", "Short", "Always day"]),
      presetValues: presetValuesOf("b42", "NightLength"),
      group: "World rules",
      help: "How much of each day is dark, from dusk to dawn.",
      fixedAfterCreation: true,
    },
    {
      /* The same five on build 41, and none of its presets sets it: every
         one is the game's default, Normal. A field per line all the same,
         so each takes its own line's table. */
      key: "nightLength",
      label: "Night length",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "NightLength" },
      default: "",
      options: presetOr(["Always night", "Long", "Normal", "Short", "Always day"]),
      presetValues: presetValuesOf("b41", "NightLength"),
      group: "World rules",
      help: "How much of each day is dark, from dusk to dawn.",
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
      // The same on both builds' presets: July, and December for Six Months Later.
      presetValues: {
        key: "sandboxPreset",
        values: { ...presetValuesOf("b41", "StartMonth").values, ...presetValuesOf("b42", "StartMonth").values },
      },
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
      presetValues: presetValuesOf("b42", "WaterShut"),
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
      presetValues: presetValuesOf("b41", "WaterShut"),
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
      presetValues: presetValuesOf("b42", "ElecShut"),
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
      presetValues: presetValuesOf("b41", "ElecShut"),
      group: "World rules",
      help: "How long after the start the electricity goes out for good.",
      fixedAfterCreation: true,
    },
    {
      key: "lootRespawn",
      label: "Loot respawn",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "HoursForLootRespawn" },
      default: "",
      options: LOOT_HOURS,
      presetValues: presetValuesOf("b42", "HoursForLootRespawn"),
      group: "World rules",
      help: "How often containers in towns that have been looted fill again, in game time. A container a player built or barricaded stays as it is.",
      fixedAfterCreation: true,
    },
    {
      key: "lootRespawn",
      label: "Loot respawn",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "LootRespawn" },
      default: "",
      // Build 41's own steps, its Sandbox_Respawn translations.
      options: presetOr(["Never", "Every day", "Every week", "Every month", "Every two months"]),
      presetValues: presetValuesOf("b41", "LootRespawn"),
      group: "World rules",
      help: "How often containers in towns that have been looted fill again, in game time. A container a player made stays as it is.",
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
      presetValues: presetValuesOf("b42", "MultiplierConfig.Global"),
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
      presetValues: presetValuesOf("b41", "XpMultiplier"),
      group: "World rules",
      help: "How fast every skill levels.",
      fixedAfterCreation: true,
    },
    /* Zombie lore: how long a zombie remembers a player, how far it sees
       and how far it hears. Advanced, as the game's own sandbox screen
       keeps them under Zombie Lore. */
    {
      key: "zombieMemory",
      label: "Zombie memory",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Memory" },
      default: "",
      options: presetOr([...MEMORY_B41, "Random, Normal to None"]),
      presetValues: presetValuesOf("b42", "ZombieLore.Memory"),
      group: "World rules",
      help: "How long a zombie remembers a player it has seen or heard.",
      advanced: true,
      fixedAfterCreation: true,
    },
    {
      key: "zombieMemory",
      label: "Zombie memory",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Memory" },
      default: "",
      options: presetOr(MEMORY_B41),
      presetValues: presetValuesOf("b41", "ZombieLore.Memory"),
      group: "World rules",
      help: "How long a zombie remembers a player it has seen or heard.",
      advanced: true,
      fixedAfterCreation: true,
    },
    {
      key: "zombieSight",
      label: "Zombie sight",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Sight" },
      default: "",
      options: presetOr([...SIGHT_B41, "Random, Normal to Poor"]),
      presetValues: presetValuesOf("b42", "ZombieLore.Sight"),
      group: "World rules",
      help: "How far away a zombie sees a player.",
      advanced: true,
      fixedAfterCreation: true,
    },
    {
      key: "zombieSight",
      label: "Zombie sight",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Sight" },
      default: "",
      options: presetOr(SIGHT_B41),
      presetValues: presetValuesOf("b41", "ZombieLore.Sight"),
      group: "World rules",
      help: "How far away a zombie sees a player.",
      advanced: true,
      fixedAfterCreation: true,
    },
    {
      key: "zombieHearing",
      label: "Zombie hearing",
      type: "enum",
      lines: ["b42"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Hearing" },
      default: "",
      options: presetOr([...HEARING_B41, "Random, Normal to Poor"]),
      presetValues: presetValuesOf("b42", "ZombieLore.Hearing"),
      group: "World rules",
      help: "How far away a zombie hears a noise.",
      advanced: true,
      fixedAfterCreation: true,
    },
    {
      key: "zombieHearing",
      label: "Zombie hearing",
      type: "enum",
      lines: ["b41"],
      target: { kind: "lua", file: SANDBOX_FILE, table: "SandboxVars", key: "ZombieLore.Hearing" },
      default: "",
      options: presetOr(HEARING_B41),
      presetValues: presetValuesOf("b41", "ZombieLore.Hearing"),
      group: "World rules",
      help: "How far away a zombie hears a noise.",
      advanced: true,
      fixedAfterCreation: true,
    },
    {
      key: "globalChat",
      label: "Global chat",
      type: "boolean",
      target: { kind: "properties", file: "Server/geeboard.ini", key: "GlobalChat" },
      default: true,
      group: "Players",
      help: "Lets players write to everyone on the server with /all, not only to those nearby.",
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
    /* Each one typed at 42.20.4 through the panel, October 2026. A name
       or a message with a space in it needs its quotes (`servermsg hello
       there` answers with the command's usage); the levels are banned,
       user, priority, observer, gm, moderator and admin, and `user` is
       how an admin is made an ordinary player again. `setaccesslevel` for
       a name nobody has joined as answers "User … is now admin" all the
       same and creates that account, as an admin, with no password. */
    examples: ["players", "help", 'setaccesslevel "<name>" admin', 'setaccesslevel "<name>" user', 'servermsg "<text>"', 'kickuser "<name>"', "save"],
    // "/setaccesslevel …", as the game's own help writes it, is "Unknown command" here.
    refusesSlash: true,
    hint: 'A name in quotes, spelled as the player logs in — Players shows it. setaccesslevel on a name nobody has joined as makes that account an admin with no password. help lists every command.',
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

  /* The image's maker publishes every release as a tag (`42.21-release`, and
     `42.21-release-2` for a rebuild of it), so a release newer than the versions
     below is found in the registry and offered as a version of its line, without
     a release of Geeboard in between. The `-unstable` tags are not followed: that
     branch is gone, and `latest-*` is a name that moves, not a version. */
  followTags: {
    repository: "danixu86/project-zomboid-dedicated-server",
    lines: [
      { line: "b42", tag: "(?<version>42\\.\\d+(?:\\.\\d+)?)-release(?:-(?<rebuild>\\d+))?" },
      { line: "b41", tag: "(?<version>41\\.\\d+(?:\\.\\d+)?)-release(?:-(?<rebuild>\\d+))?" },
    ],
  },

  /* Build 42 went stable with 42.20 on 29 July 2026 and took the public
     branch with it; build 41 moved to `legacy41`. Three lines, because
     none of these open each other's worlds.

     Each version is a pinned image tag with the game already inside it.
     A newer build on Steam is not installed until a version names the tag
     that carries it — one here, or one the registry lists (followTags
     above) — and an operator chooses it: a restart must never be what
     moves a world to a build it cannot go back from. The versions below
     are the floor: the oldest each line is known to run on. */
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
