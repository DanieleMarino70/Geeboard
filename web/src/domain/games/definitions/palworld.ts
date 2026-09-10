import type { GameDefinition } from "../types";

/* Palworld.

   Steam app 2394010. The memory floor is real: the dedicated server
   grows steadily with world size and is happiest with headroom it never
   quite uses. Its settings live in an INI file with a genuine section
   header, which is the one place that config target earns its keep. */

export const PALWORLD: GameDefinition = {
  id: "palworld",
  name: "Palworld",
  family: "Palworld",
  art: "PALWORLD",
  official: false,
  popularity: "58k servers",
  blurb: "Up to 32 players with automatic world compaction.",

  portBase: 8211,
  portSpan: 120,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "rcon", label: "RCON", offset: 1, protocol: "tcp", public: false, note: "private" },
  ],

  defaults: { memoryGb: 16, cpuLimit: 400, diskGb: 40, playersMax: 32 },
  limits: { memoryGb: [8, 32], cpuLimit: [200, 800], diskGb: [10, 120] },
  requirements: {
    memoryGbMin: 8,
    cpuPctMin: 200,
    diskGbMin: 10,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker", "steamcmd", "high-memory"],
  },

  install: { kind: "steamcmd", appId: 2394010, anonymous: true },

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
      key: "description",
      label: "Description",
      type: "text",
      target: { kind: "env", name: "SERVER_DESCRIPTION" },
      default: "",
      maxLength: 240,
      group: "Presentation",
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "env", name: "PLAYERS" },
      default: 32,
      min: 1,
      max: 32,
      group: "Players",
      help: "The server refuses more than 32; the game does not support it.",
      restartRequired: true,
    },
    {
      key: "password",
      label: "Server password",
      type: "string",
      target: { kind: "env", name: "SERVER_PASSWORD" },
      default: "",
      maxLength: 60,
      group: "Players",
    },
    {
      key: "pvp",
      label: "PvP",
      type: "boolean",
      target: {
        kind: "ini",
        file: "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini",
        section: "/Script/Pal.PalGameWorldSettings",
        key: "bEnablePlayerToPlayerDamage",
      },
      default: false,
      group: "Rules",
    },
    {
      key: "captureRate",
      label: "Capture rate",
      type: "enum",
      target: {
        kind: "ini",
        file: "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini",
        section: "/Script/Pal.PalGameWorldSettings",
        key: "CaptureRate",
      },
      default: "1.0",
      options: [
        { value: "1.0", label: "1× · vanilla" },
        { value: "2.0", label: "2×" },
        { value: "5.0", label: "5×" },
      ],
      group: "Rules",
    },
  ],

  health: {
    probes: [{ kind: "query", protocol: "source-a2s" }, { kind: "rcon", command: "Info" }],
    bootGraceSeconds: 600,
    readyPattern: "Setting breakpad minidump",
    crashPattern: "(Fatal error|out of memory)",
  },

  console: {
    stopCommand: "DoExit",
    saveCommand: "Save",
    broadcastCommand: "Broadcast %s",
    examples: ["ShowPlayers", "Save", "Broadcast <message>", "DoExit"],
  },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 2394010 }],

  versions: [
    {
      id: "palworld-stable",
      steamBranch: "public",
      label: "Palworld stable",
      image: "thijsvanloef/palworld-server-docker:latest",
      note: "The release branch, with the memory leak fix",
      released: "2025-08-28",
      channel: "stable",
      recommended: true,
    },
  ],

  templates: [
    {
      id: "default",
      name: "Default",
      blurb: "The rates the game ships with.",
      summary: "1× rates, 32 slots, PvP off",
      whitelist: false,
      config: { maxPlayers: 32, captureRate: "1.0", pvp: false },
    },
    {
      id: "coop",
      name: "Co-op",
      blurb: "A smaller world for a group that plays together, with faster capture.",
      summary: "2× capture, 8 slots, PvP off",
      whitelist: true,
      config: { maxPlayers: 8, captureRate: "2.0", pvp: false },
    },
  ],
};
