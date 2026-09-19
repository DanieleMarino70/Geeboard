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
    {
      key: "sandboxPreset",
      label: "World rules",
      type: "enum",
      /* The image copies the game's own preset into the world's
         SandboxVars.lua on its first start, and never again. */
      target: { kind: "env", name: "SERVERPRESET" },
      default: "Apocalypse",
      options: [
        { value: "Apocalypse", label: "Apocalypse" },
        { value: "SixMonthsLater", label: "Six Months Later" },
        { value: "Outbreak", label: "Outbreak" },
        { value: "Rising", label: "Rising" },
        { value: "Extinction", label: "Extinction" },
      ],
      group: "World",
      help: "The game's own sandbox presets: zombies, loot, power and water. Chosen once, for a new world; tune the rest in Server/geeboard_SandboxVars.lua with the server stopped.",
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
