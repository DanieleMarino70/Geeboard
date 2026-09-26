import type { GameDefinition } from "../types";

/* Palworld.

   PARKED — not in the registry since September 2026.

   Why: never run from its own image. Palworld wants 16 GB, and the
   machine Geeboard is developed on gives Docker 7.7 GB. Every game that
   has been run for real found bugs its definition could not show, so
   this one is a guess until it has been booted.

   Before re-enabling (a machine with the memory, then the method in
   docs/games.md "Adding a game"): run the bare image by hand and check
   where the world lands (`dataPath`), that PalWorldSettings.ini is where
   the file targets say and survives a restart, which variables the
   image really reads, the ready line, whether stdin or RCON reaches
   the game, what SIGTERM does and whether it saves. Then create one
   from the wizard and drive it through the panel: a settings save, a
   backup, a stop, a restore, a start. Fix what that shows, write the
   measurements into these comments, and only then add it back to
   DEFINITIONS in registry.ts. Unit tests still import this file
   directly because it is the only definition with an INI target.

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
      secret: true,
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
      config: { maxPlayers: 32, captureRate: "1.0", pvp: false },
    },
    {
      id: "coop",
      name: "Co-op",
      blurb: "A smaller world for a group that plays together, with faster capture.",
      summary: "2× capture, 8 slots, PvP off",
      config: { maxPlayers: 8, captureRate: "2.0", pvp: false },
    },
  ],
};
