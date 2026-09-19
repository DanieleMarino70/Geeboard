import type { GameDefinition } from "../types";

/* Satisfactory.

   PARKED — not in the registry since September 2026.

   Why: never run from its own image. Satisfactory wants 12 GB, and the
   machine Geeboard is developed on gives Docker 7.7 GB. Every game that
   has been run for real found bugs its definition could not show, so
   this one is a guess until it has been booted.

   Before re-enabling (a machine with the memory, then the method in
   docs/games.md "Adding a game"): run the bare image by hand and check
   where the save lands (`dataPath`), which variables the image really
   reads, the ready line ("Server is ready" is from documentation), that
   the port probe does not upset the game the way it did Terraria, what
   SIGTERM does and whether it saves, and what a restart downloads. Then
   create one from the wizard, claim it from a client, and drive it
   through the panel: a backup, a stop, a restore, a start. Fix what that
   shows, write the measurements into these comments, and only then add
   it back to DEFINITIONS in registry.ts.

   Steam app 1690800. Almost everything about a Satisfactory server is
   configured from inside the game rather than from a file — the server
   is claimed by the first client to connect and takes its rules from
   there. So the config surface here is deliberately short: what is
   missing is missing because the game does not offer it, not because
   the definition is unfinished. */

export const SATISFACTORY: GameDefinition = {
  id: "satisfactory",
  name: "Satisfactory",
  family: "Satisfactory",
  art: "SATIS-\nFACTORY",
  official: false,
  blurb: "Dedicated factories with blueprint sync.",

  /* The same base as Terraria, and deliberately so: 7777 is genuinely
     both games' default. Allocation checks the ports actually taken on
     the node rather than the range they came from, so two games sharing
     a range costs a little fragmentation and nothing else. */
  portBase: 7777,
  portSpan: 120,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "both", primary: true },
    { id: "query", label: "Query", offset: 1, protocol: "udp" },
    { id: "beacon", label: "Beacon", offset: 2, protocol: "udp" },
  ],

  defaults: { memoryGb: 12, cpuLimit: 400, diskGb: 40, playersMax: 8 },
  limits: { memoryGb: [6, 32], cpuLimit: [200, 800], diskGb: [10, 120] },
  requirements: {
    memoryGbMin: 6,
    cpuPctMin: 200,
    diskGbMin: 10,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker", "steamcmd", "high-memory"],
  },

  install: { kind: "steamcmd", appId: 1690800, anonymous: true },

  config: [
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "env", name: "MAXPLAYERS" },
      default: 8,
      min: 1,
      max: 16,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "autosaveInterval",
      label: "Autosave interval",
      type: "number",
      target: { kind: "env", name: "AUTOSAVENUM" },
      default: 5,
      min: 1,
      max: 60,
      group: "World",
      help: "Minutes between autosaves.",
    },
    {
      key: "beta",
      label: "Branch",
      type: "enum",
      target: { kind: "env", name: "STEAMBETA" },
      default: "false",
      options: [
        { value: "false", label: "Stable" },
        { value: "true", label: "Experimental" },
      ],
      group: "World",
      advanced: true,
      restartRequired: true,
    },
  ],

  health: {
    probes: [{ kind: "port", port: "game" }, { kind: "process" }],
    bootGraceSeconds: 600,
    readyPattern: "Server is ready",
    crashPattern: "(Fatal error|out of memory)",
  },

  console: { examples: [] },

  versionSources: [{ provider: "static" }, { provider: "steam", appId: 1690800 }],

  versions: [
    {
      id: "satisfactory-stable",
      steamBranch: "public",
      label: "Satisfactory 1.0",
      upstream: "1.0",
      image: "wolveix/satisfactory-server:latest",
      note: "The 1.0 release branch",
      released: "2024-09-10",
      channel: "stable",
      recommended: true,
    },
  ],

  templates: [
    {
      id: "default",
      name: "Default",
      blurb: "A new save on the standard map.",
      summary: "Autosave every 5 minutes, 8 slots",
      config: { maxPlayers: 8, autosaveInterval: 5 },
    },
  ],
};
