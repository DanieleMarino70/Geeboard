import type { GameDefinition } from "../types";

/* Minecraft: Bedrock.

   Bedrock is UDP-only and has no RCON, so the console is stdin and the
   health check cannot lean on a TCP handshake — the log line is the
   signal. Its allow-list is a different feature from Java's whitelist
   under a similar name, which is why the config key is its own.

   Run for real in September 2026 through itzg/minecraft-bedrock-server,
   checked against the bare image first. What that settled:

     - VERSION=LATEST, which this definition used, looks up and installs
       whatever Mojang has released on every start: a restart was an
       upgrade, and a world does not open in an older server than made
       it. Versions now pin the server (1.26.51.1) and the image tag.
       With a pinned version and the server already in /data, a restart
       downloads nothing — logged as "Using given version".
     - The server listens where SERVER_PORT says, not where Docker maps,
       so it is told the ports it was allocated. The second Bedrock
       server on a node used to listen on 19132 inside a container
       published on 19332, reachable by nobody.
     - `save hold` pauses saving until `save resume`. The backup sent the
       first and never the second, so a server stopped saving its world
       after its first backup. It now resumes, and waits for `save
       query` to say the files are ready instead of pausing two seconds.
     - SIGTERM is turned into `stop` by the image's runner; the server
       logs "Quit correctly" and exits 0 within a second. */

export const MINECRAFT_BEDROCK: GameDefinition = {
  id: "minecraft-bedrock",
  name: "Minecraft: Bedrock",
  family: "Minecraft",
  art: "MC\nBEDROCK",
  official: true,
  blurb: "Console and mobile crossplay, with add-on support.",

  portBase: 19132,
  portSpan: 200,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "ipv6", label: "IPv6", offset: 1, protocol: "udp" },
  ],

  defaults: { memoryGb: 4, cpuLimit: 200, diskGb: 40, playersMax: 30 },
  limits: { memoryGb: [1, 16], cpuLimit: [50, 400], diskGb: [5, 150] },
  requirements: {
    memoryGbMin: 1,
    cpuPctMin: 50,
    diskGbMin: 5,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker"],
  },

  /* Worlds in /data/worlds, and the server binary beside them — so a
     restart with the same pinned version has nothing to download, and a
     backup carries the exact server the world was running on. */
  resourceEnv: { ports: { game: "SERVER_PORT", ipv6: "SERVER_PORT_V6" } },

  install: { kind: "image", env: { EULA: "TRUE" } },

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
      key: "mode",
      label: "Game mode",
      type: "enum",
      target: { kind: "env", name: "GAMEMODE" },
      default: "survival",
      options: [
        { value: "survival", label: "Survival" },
        { value: "creative", label: "Creative" },
        { value: "adventure", label: "Adventure" },
      ],
      group: "World",
    },
    {
      key: "difficulty",
      label: "Difficulty",
      type: "enum",
      target: { kind: "env", name: "DIFFICULTY" },
      default: "normal",
      options: [
        { value: "peaceful", label: "Peaceful" },
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
      group: "World",
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "env", name: "MAX_PLAYERS" },
      default: 30,
      min: 1,
      max: 100,
      group: "Players",
    },
    {
      key: "allowList",
      label: "Allow list only",
      type: "boolean",
      target: { kind: "env", name: "ALLOW_LIST" },
      default: false,
      group: "Players",
      help: "An open UDP port is an open door; this is what closes it.",
    },
    {
      key: "viewDistance",
      label: "View distance",
      type: "number",
      target: { kind: "env", name: "VIEW_DISTANCE" },
      default: 10,
      min: 4,
      max: 32,
      group: "Performance",
      restartRequired: true,
      advanced: true,
    },
  ],

  health: {
    probes: [{ kind: "log", pattern: "Server started" }, { kind: "process" }],
    bootGraceSeconds: 120,
    readyPattern: "Server started",
    crashPattern: "(Fatal error|terminate called)",
  },

  console: {
    stopCommand: "stop",
    saveCommand: "save hold",
    // Without this the world stops being saved after the first backup.
    resumeCommand: "save resume",
    saveReady: { command: "save query", pattern: "Files are now ready to be copied" },
    broadcastCommand: "say %s",
    examples: ["list", "allowlist add <player>", "op <player>", "stop"],
    /* The dedicated server logs "Player connected: Steve, xuid: …" and
       "Player disconnected: Steve, xuid: …". Not yet seen with a real
       client connected. */
    players: {
      join: "Player connected: (?<name>[^,]{1,32}), xuid",
      leave: "Player disconnected: (?<name>[^,]{1,32}), xuid",
    },
  },

  versionSources: [{ provider: "static" }],

  /* Pinned, server and image both. The ids name what the version is; the
     old ones ("bedrock-latest", "bedrock-preview") named how it used to
     be distributed, and live on as former ids so servers made on them
     still resolve. Those servers are on VERSION=LATEST until rebuilt. */
  versions: [
    {
      id: "bedrock-1-26-51",
      formerIds: ["bedrock-latest"],
      label: "Bedrock 1.26.51",
      upstream: "1.26.51.1",
      image: "itzg/minecraft-bedrock-server:2026.9.0",
      env: { VERSION: "1.26.51.1" },
      note: "What current consoles, phones and Windows clients join.",
      released: "2026-09-16",
      channel: "stable",
      recommended: true,
    },
    {
      id: "bedrock-preview-1-26-60",
      formerIds: ["bedrock-preview"],
      // A preview world is on a newer format than the release can open.
      line: "preview",
      label: "Bedrock preview 1.26.60",
      upstream: "1.26.60.27",
      image: "itzg/minecraft-bedrock-server:2026.9.0",
      env: { VERSION: "1.26.60.27", PREVIEW: "true" },
      note: "The next release, for testing add-ons before they land. Only preview clients can join.",
      released: "2026-09-17",
      channel: "preview",
    },
  ],

  templates: [
    {
      id: "survival",
      name: "Survival",
      blurb: "The default world, allow-listed so an open UDP port is not an open door.",
      summary: "Allow list on, normal difficulty",
      config: { mode: "survival", difficulty: "normal", allowList: true },
    },
    {
      id: "creative",
      name: "Creative",
      blurb: "A build server for tablets and consoles.",
      summary: "Creative mode, peaceful",
      config: { mode: "creative", difficulty: "peaceful" },
    },
  ],
};
