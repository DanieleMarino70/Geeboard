import type { GameDefinition } from "../types";

/* Terraria.

   Terraria's dedicated server is configured by a file, not by
   environment variables: `serverconfig.txt` is a flat key=value list the
   server reads at boot. So its config fields target that file, which is
   the honest description even though writing config files is a Phase 4
   capability — a definition should say how the game actually works, not
   how much of it the platform has caught up with.

   The version numbers matter here. Re-Logic ships the dedicated server
   as a separate download from the game, and the two are not always at
   the same number on the same day — which is exactly the distinction
   the version resolver exists to keep. */

export const TERRARIA: GameDefinition = {
  id: "terraria",
  name: "Terraria",
  family: "Terraria",
  art: "TERR-\nARIA",
  official: true,
  popularity: "180k servers",
  blurb: "Vanilla and TShock worlds, with journey and master mode support.",

  portBase: 7777,
  portSpan: 200,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "tcp", primary: true },
    {
      id: "rest",
      label: "REST",
      offset: 1,
      protocol: "tcp",
      public: false,
      note: "TShock only",
    },
  ],

  defaults: { memoryGb: 2, cpuLimit: 150, diskGb: 10, playersMax: 16 },
  limits: { memoryGb: [1, 8], cpuLimit: [50, 400], diskGb: [5, 60] },
  requirements: {
    memoryGbMin: 1,
    cpuPctMin: 50,
    diskGbMin: 5,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker"],
  },

  install: { kind: "image" },

  config: [
    {
      key: "worldName",
      label: "World name",
      type: "string",
      target: { kind: "properties", file: "serverconfig.txt", key: "worldname" },
      default: "Geeboard",
      maxLength: 40,
      group: "World",
      restartRequired: true,
    },
    {
      key: "difficulty",
      label: "World difficulty",
      type: "enum",
      target: { kind: "properties", file: "serverconfig.txt", key: "difficulty" },
      default: "0",
      options: [
        { value: "0", label: "Classic" },
        { value: "1", label: "Expert" },
        { value: "2", label: "Master" },
        { value: "3", label: "Journey" },
      ],
      group: "World",
      help: "Only applies when the world is generated. An existing world keeps the difficulty it was made with.",
      restartRequired: true,
    },
    {
      key: "worldSize",
      label: "World size",
      type: "enum",
      target: { kind: "properties", file: "serverconfig.txt", key: "autocreate" },
      default: "2",
      options: [
        { value: "1", label: "Small" },
        { value: "2", label: "Medium" },
        { value: "3", label: "Large" },
      ],
      group: "World",
      restartRequired: true,
    },
    {
      key: "seed",
      label: "World seed",
      type: "string",
      target: { kind: "properties", file: "serverconfig.txt", key: "seed" },
      default: "",
      maxLength: 64,
      group: "World",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "properties", file: "serverconfig.txt", key: "maxplayers" },
      default: 16,
      min: 1,
      max: 255,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "password",
      label: "Server password",
      type: "string",
      target: { kind: "properties", file: "serverconfig.txt", key: "password" },
      default: "",
      maxLength: 60,
      group: "Players",
      help: "Left empty, anyone who knows the address can join.",
      restartRequired: true,
    },
    {
      key: "motd",
      label: "MOTD",
      type: "string",
      target: { kind: "properties", file: "serverconfig.txt", key: "motd" },
      default: "Welcome",
      maxLength: 120,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "secure",
      label: "Anti-cheat",
      type: "boolean",
      target: { kind: "properties", file: "serverconfig.txt", key: "secure" },
      default: true,
      group: "Players",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "npcStream",
      label: "NPC update rate",
      type: "number",
      target: { kind: "properties", file: "serverconfig.txt", key: "npcstream" },
      default: 60,
      min: 10,
      max: 240,
      group: "Performance",
      help: "Lower is smoother for players and heavier on the node.",
      advanced: true,
      restartRequired: true,
    },
  ],

  health: {
    probes: [{ kind: "port", port: "game" }, { kind: "log", pattern: "Server started" }],
    bootGraceSeconds: 300,
    readyPattern: "Server started",
    crashPattern: "(Unhandled exception|Segmentation fault)",
  },

  console: {
    stopCommand: "exit",
    saveCommand: "save",
    broadcastCommand: "say %s",
    examples: ["playing", "save", "time", "kick <player>", "exit"],
  },

  /* Re-Logic publishes the dedicated server as a zip on terraria.org
     with no machine-readable index, so vanilla versions are static and
     stay that way until somebody writes a provider that is not HTML
     scraping. TShock does publish releases, so that half is live. */
  versionSources: [
    { provider: "static" },
    { provider: "github", owner: "Pryaxis", repo: "TShock", match: "^v?\d" },
  ],

  versions: [
    {
      id: "vanilla-1-4-4-9",
      label: "Terraria 1.4.4.9",
      upstream: "1.4.4.9",
      image: "ryshe/terraria:latest",
      env: { WORLD_FILENAME: "geeboard.wld" },
      note: "Re-Logic's dedicated server, unmodified",
      released: "2023-02-14",
      channel: "stable",
      recommended: true,
    },
    {
      id: "tshock-1-4-4-9",
      label: "TShock 1.4.4.9",
      upstream: "1.4.4.9",
      image: "ryshe/terraria:tshock",
      env: { WORLD_FILENAME: "geeboard.wld" },
      note: "Plugins, permissions and a REST API on top of the same world",
      released: "2023-03-05",
      channel: "stable",
    },
    {
      id: "vanilla-1-4-3-6",
      label: "Terraria 1.4.3.6",
      upstream: "1.4.3.6",
      image: "ryshe/terraria:1.4.3.6",
      env: { WORLD_FILENAME: "geeboard.wld" },
      note: "Held back for a world made before Labor of Love",
      released: "2022-06-14",
      channel: "legacy",
    },
  ],

  templates: [
    {
      id: "classic",
      name: "Classic",
      blurb: "A medium world at the difficulty the game opens with.",
      summary: "Classic, medium world, 16 slots",
      whitelist: false,
      config: { difficulty: "0", worldSize: "2", maxPlayers: 16 },
    },
    {
      id: "expert",
      name: "Expert",
      blurb: "Harder enemies and better drops, for a group that has finished it once.",
      summary: "Expert, medium world, password set",
      whitelist: true,
      config: { difficulty: "1", worldSize: "2", maxPlayers: 8 },
    },
    {
      id: "journey",
      name: "Journey",
      blurb: "Creative mode. Research, duplication and full control of the world's rules.",
      summary: "Journey, large world, 8 slots",
      whitelist: true,
      config: { difficulty: "3", worldSize: "3", maxPlayers: 8 },
    },
  ],
};
