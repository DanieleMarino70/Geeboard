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
  /* The container ports are fixed. The server inside always listens on
     7777 whichever block the node allocated, so without these a second
     Terraria server on a node would publish 7779 to a container port
     nothing was listening on. */
  ports: [
    { id: "game", label: "Game", offset: 0, container: 7777, protocol: "tcp", primary: true },
    {
      id: "rest",
      label: "REST",
      offset: 1,
      container: 7878,
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

  /* Where the image looks, pointed at the server's own directory.

     ryshe/terraria keeps its config in /config and its worlds in
     /root/.local/share/Terraria/Worlds, and the node mounts a server's
     directory at /data — so as first shipped, the serverconfig.txt
     Geeboard wrote was never read, and a world would have lived in an
     anonymous volume that Files could not see, a backup did not contain
     and a rebuild threw away. CONFIGPATH is the image's own variable for
     where serverconfig.txt is; `world` in that file is where the world
     is, and `autocreate` makes it on first boot.

     WORLD_FILENAME has to stay unset: when it is set, the image's
     bootstrap looks for that world, finds none on a new server, and
     exits before the server ever reads its config. */
  install: {
    kind: "image",
    env: { CONFIGPATH: "/data" },
    files: [
      {
        file: "serverconfig.txt",
        kind: "properties",
        entries: { world: "/data/geeboard.wld", worldpath: "/data", port: "7777" },
      },
    ],
  },

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

  /* No port probe, deliberately. A TCP connection that closes without
     Terraria's handshake — which is all a port probe is — crashes the
     vanilla 1.4.5.8 server with an ObjectDisposedException in its
     netplay loop. Verified against the bare image with no Geeboard
     involved: three connects, and the process exits. Probed every poll,
     it crash-looped a healthy server. The console saying it started is
     the evidence that does not break the thing it is looking at.

     The crash pattern matches what the server actually prints, in the
     case it prints it. */
  health: {
    probes: [{ kind: "log", pattern: "Server started" }],
    bootGraceSeconds: 300,
    readyPattern: "Server started",
    crashPattern: "(Unhandled [Ee]xception|UNHANDLED EXCEPTION|Segmentation fault)",
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

  /* Every image here is a tag that exists, and runs what its label says.
     As first written, "Terraria 1.4.4.9 — unmodified" ran
     ryshe/terraria:latest, which is TShock; and the TShock and 1.4.3.6
     entries named tags that were never published. Pinned tags rather
     than `latest`, so a version is the same bytes tomorrow. */
  versions: [
    {
      id: "vanilla-1-4-5-8",
      line: "vanilla",
      label: "Terraria 1.4.5.8",
      upstream: "1.4.5.8",
      image: "ryshe/terraria:vanilla-1.4.5.8",
      note: "Re-Logic's dedicated server, unmodified. What a current game client joins",
      // When the image was published: the nearest dated fact there is.
      released: "2026-08-24",
      channel: "stable",
      recommended: true,
    },
    {
      id: "vanilla-1-4-4-9",
      line: "vanilla",
      label: "Terraria 1.4.4.9",
      upstream: "1.4.4.9",
      image: "ryshe/terraria:vanilla-1.4.4.9",
      note: "The last 1.4.4 release, for a world not yet moved to 1.4.5",
      released: "2023-02-14",
      channel: "stable",
    },
    {
      id: "tshock-1-4-4-9",
      /* Same world file, different server: TShock's plugins and
         permissions are not something vanilla can carry. */
      line: "tshock",
      label: "TShock 1.4.4.9",
      upstream: "1.4.4.9",
      image: "ryshe/terraria:tshock-1.4.4.9-5.2.4",
      note: "Not installable yet: TShock's image only creates a world when passed -autocreate, and the node cannot pass start arguments",
      released: "2025-08-02",
      channel: "stable",
      supported: false,
    },
    {
      id: "vanilla-1-4-3-6",
      line: "vanilla",
      label: "Terraria 1.4.3.6",
      upstream: "1.4.3.6",
      image: "ryshe/terraria:vanilla-1.4.3.6-4",
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
