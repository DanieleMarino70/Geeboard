import type { GameDefinition } from "../types";

/* Project Zomboid.

   The one game shipped so far whose files genuinely come from SteamCMD
   rather than from the image — app 380870, anonymous login. The image
   carries the SteamCMD run, which is why the install strategy still
   names it: a node without SteamCMD cannot host this game even though
   Docker is doing the fetching, and placement has to know that.

   Zomboid is also the memory-hungry one. Eight gigabytes is not a
   suggestion; a smaller server dies during map streaming rather than at
   boot, which is the worst possible time to find out. */

export const PROJECT_ZOMBOID: GameDefinition = {
  id: "project-zomboid",
  name: "Project Zomboid",
  family: "Project Zomboid",
  art: "PROJECT\nZOMBOID",
  official: true,
  blurb: "Persistent apocalypse worlds with Workshop mods and sandbox rules.",

  portBase: 16261,
  portSpan: 200,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "direct", label: "Direct", offset: 1, protocol: "udp", note: "player connections" },
  ],

  defaults: { memoryGb: 8, cpuLimit: 300, diskGb: 30, playersMax: 16 },
  limits: { memoryGb: [6, 32], cpuLimit: [200, 800], diskGb: [20, 200] },
  requirements: {
    memoryGbMin: 8,
    cpuPctMin: 200,
    diskGbMin: 20,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker", "steamcmd"],
  },

  install: { kind: "steamcmd", appId: 380870, anonymous: true },

  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "properties", file: "Server/servertest.ini", key: "PublicName" },
      default: "Geeboard",
      maxLength: 60,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "description",
      label: "Description",
      type: "text",
      target: { kind: "properties", file: "Server/servertest.ini", key: "PublicDescription" },
      default: "",
      maxLength: 240,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "welcomeMessage",
      label: "Welcome message",
      type: "text",
      target: { kind: "properties", file: "Server/servertest.ini", key: "ServerWelcomeMessage" },
      default: "Welcome to a Geeboard server.",
      maxLength: 240,
      group: "Presentation",
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "properties", file: "Server/servertest.ini", key: "MaxPlayers" },
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
      target: { kind: "properties", file: "Server/servertest.ini", key: "Password" },
      default: "",
      maxLength: 60,
      group: "Players",
    },
    {
      key: "pvp",
      label: "PvP",
      type: "boolean",
      target: { kind: "properties", file: "Server/servertest.ini", key: "PVP" },
      default: false,
      group: "Players",
    },
    {
      key: "open",
      label: "Open to the public",
      type: "boolean",
      target: { kind: "properties", file: "Server/servertest.ini", key: "Open" },
      default: true,
      group: "Players",
      help: "Off means only players already on the whitelist can connect.",
    },
    {
      key: "pauseEmpty",
      label: "Pause when empty",
      type: "boolean",
      target: { kind: "properties", file: "Server/servertest.ini", key: "PauseEmpty" },
      default: true,
      group: "World",
      help: "Time stops when nobody is on, so the world does not rot while you sleep.",
    },
    {
      key: "zombiePopulation",
      label: "Zombie population",
      type: "enum",
      target: { kind: "properties", file: "Server/servertest.ini", key: "ZombiePopulationMultiplier" },
      default: "1.0",
      options: [
        { value: "0.6", label: "Low" },
        { value: "1.0", label: "Normal" },
        { value: "2.0", label: "High" },
        { value: "4.0", label: "Insane" },
      ],
      group: "World",
    },
    {
      key: "globalChat",
      label: "Global chat",
      type: "boolean",
      target: { kind: "properties", file: "Server/servertest.ini", key: "GlobalChat" },
      default: true,
      group: "Players",
      advanced: true,
    },
    {
      key: "mods",
      label: "Workshop mods",
      type: "text",
      target: { kind: "properties", file: "Server/servertest.ini", key: "WorkshopItems" },
      default: "",
      maxLength: 2000,
      group: "Mods",
      help: "Semicolon-separated Workshop ids. Managed properly once the mod manager lands.",
      advanced: true,
      restartRequired: true,
    },
  ],

  health: {
    probes: [{ kind: "log", pattern: "SERVER STARTED" }, { kind: "process" }],
    /* The first boot builds the map cache, and on a cold node that is
       minutes, not seconds. Calling it unhealthy before then would
       restart a server that was working perfectly. */
    bootGraceSeconds: 900,
    readyPattern: "SERVER STARTED",
    crashPattern: "(java\\.lang\\.OutOfMemoryError|Fatal error)",
  },

  console: {
    stopCommand: "quit",
    saveCommand: "save",
    broadcastCommand: 'servermsg "%s"',
    examples: ["players", "save", "quit", "kickuser <name>", "checkModsNeedUpdate"],
  },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 380870 }],

  /* Build 42 went stable with 42.20 on 29 July 2026 and took the public
     branch with it; build 41 moved to `legacy41`. Three lines, because
     none of these open each other's worlds — 42.20 added map content the
     42.19 unstable saves do not have.

     The image runs SteamCMD against GAME_VERSION on every start, so the
     branch *is* the pin. A "build 41" server that was pointed at public
     became a build 42 server on its next restart, which is why the old
     "b41-stable" id is now a former id of a version on legacy41. */
  versions: [
    {
      id: "b42",
      line: "b42",
      steamBranch: "public",
      label: "Build 42",
      upstream: "42.20.4",
      image: "renegademaster/zomboid-dedicated-server:latest",
      env: { GAME_VERSION: "public" },
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
      upstream: "41.78.21",
      image: "renegademaster/zomboid-dedicated-server:latest",
      env: { GAME_VERSION: "legacy41" },
      note: "The legacy41 branch, for worlds and mods that cannot move to build 42. Fixes only.",
      released: "2026-08-26",
      channel: "legacy",
    },
    {
      /* Kept, and refused, rather than deleted: servers created on it
         still need to resolve to something that says what they are. Its
         last build lives on as a pinned `42.19` branch, which this image
         cannot select — GAME_VERSION allows no dots. */
      id: "b42-unstable",
      line: "b42-unstable",
      label: "Build 42 · unstable",
      upstream: "42.19.2",
      image: "renegademaster/zomboid-dedicated-server:latest",
      env: { GAME_VERSION: "unstable" },
      note: "The unstable branch is gone. Its worlds open in neither 42.20 nor build 41.",
      released: "2026-08-26",
      channel: "preview",
      supported: false,
    },
  ],

  templates: [
    {
      id: "survival",
      name: "Survival",
      blurb: "The default apocalypse, paused while nobody is playing.",
      summary: "PvE, normal population, pause when empty",
      config: { pvp: false, zombiePopulation: "1.0", pauseEmpty: true },
    },
    {
      id: "pvp",
      name: "PvP",
      blurb: "Players can hurt each other, and the world keeps running without them.",
      summary: "PvP on, normal population, always running",
      config: { pvp: true, zombiePopulation: "1.0", pauseEmpty: false },
    },
    {
      id: "apocalypse",
      name: "Apocalypse",
      blurb: "Four times the zombies, for a group that wants to lose.",
      summary: "PvE, insane population, private",
      config: { pvp: false, zombiePopulation: "4.0", open: false, maxPlayers: 8 },
    },
  ],
};
