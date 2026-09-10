import type { GameDefinition } from "../types";

/* Valheim.

   Steam app 896660. The password is not optional in the way it looks:
   the dedicated server refuses to start without one unless it is
   explicitly made public, and it must not contain the world name. That
   rule belongs here, with the game, not in a validator somewhere that
   has to remember which game it is looking at. */

export const VALHEIM: GameDefinition = {
  id: "valheim",
  name: "Valheim",
  family: "Valheim",
  art: "VALHEIM",
  official: false,
  popularity: "61k servers",
  blurb: "Dedicated worlds with BepInEx mod loading.",

  portBase: 2456,
  portSpan: 120,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "query", label: "Query", offset: 1, protocol: "udp" },
  ],

  defaults: { memoryGb: 4, cpuLimit: 200, diskGb: 30, playersMax: 10 },
  limits: { memoryGb: [2, 16], cpuLimit: [100, 400], diskGb: [5, 100] },
  requirements: {
    memoryGbMin: 2,
    cpuPctMin: 100,
    diskGbMin: 5,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker", "steamcmd"],
  },

  install: { kind: "steamcmd", appId: 896660, anonymous: true },

  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "env", name: "SERVER_NAME" },
      default: "Geeboard",
      maxLength: 60,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "worldName",
      label: "World name",
      type: "string",
      target: { kind: "env", name: "WORLD_NAME" },
      default: "geeboard",
      maxLength: 40,
      group: "World",
      help: "Names the save file. Changing it starts a new world rather than renaming the old one.",
      restartRequired: true,
    },
    {
      key: "password",
      label: "Server password",
      type: "string",
      target: { kind: "env", name: "SERVER_PASS" },
      default: "",
      maxLength: 60,
      group: "Players",
      help: "At least five characters, and it must not contain the world name.",
      restartRequired: true,
    },
    {
      key: "public",
      label: "List publicly",
      type: "boolean",
      target: { kind: "env", name: "SERVER_PUBLIC" },
      default: false,
      group: "Players",
    },
    {
      key: "crossplay",
      label: "Crossplay",
      type: "boolean",
      target: { kind: "env", name: "SERVER_ARGS_CROSSPLAY" },
      default: true,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "preset",
      label: "World modifier",
      type: "enum",
      target: { kind: "env", name: "PRESET" },
      default: "normal",
      options: [
        { value: "casual", label: "Casual" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
        { value: "hardcore", label: "Hardcore" },
      ],
      group: "World",
    },
  ],

  health: {
    probes: [{ kind: "query", protocol: "source-a2s" }, { kind: "log", pattern: "Game server connected" }],
    bootGraceSeconds: 600,
    readyPattern: "Game server connected",
    crashPattern: "(Fatal error|Segmentation fault)",
  },

  console: {
    /* Valheim's dedicated server has no console command language — it is
       driven entirely by signals, so a stop is a stop and there is
       nothing useful to type at it. */
    examples: [],
  },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 896660 }],

  versions: [
    {
      id: "valheim-stable",
      steamBranch: "public",
      label: "Valheim stable",
      image: "lloesche/valheim-server:latest",
      note: "The public branch, with crossplay on",
      released: "2025-07-22",
      channel: "stable",
      recommended: true,
    },
  ],

  templates: [
    {
      id: "normal",
      name: "Normal",
      blurb: "The world as shipped, password protected.",
      summary: "Normal combat, portals on, password set",
      whitelist: true,
      config: { preset: "normal", public: false, worldName: "geeboard" },
    },
    {
      id: "hardmode",
      name: "Hard",
      blurb: "No portals and harder raids, for a group that has done it before.",
      summary: "Portals off, raids hard, password set",
      whitelist: true,
      config: { preset: "hard", public: false, worldName: "geeboard" },
    },
  ],
};
