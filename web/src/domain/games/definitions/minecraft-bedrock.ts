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
  /* From the Microsoft Store, as Java's is and for the same reason
     (definitions/minecraft-java.ts): its "Poster" image of "Minecraft"
     (product 9MVXMVT8ZKWC, the Bedrock game), fetched 2026-10-12: a JPEG,
     720 × 1080, 171,615 bytes, with this sha256. */
  poster: {
    url: "https://store-images.s-microsoft.com/image/apps.53095.13850085746326678.06e2dc5c-7997-46e9-a8e6-0e48b57cb13b.419e3c9d-9dd3-4a28-a9f3-a12350215871",
    sha256: "800d291ddc2096c4cbbd42edb8c86296f6b67eb1da8cb8bf18478fd7af298f8e",
    width: 720,
    height: 1080,
  },
  official: true,
  /* It promised add-ons, which nothing here installs. Consoles are left
     out: they are known to need a workaround to join a server by its
     address, and none has been tried against one here. */
  blurb: "The server Bedrock players join from phones, tablets and Windows. Add-ons are not installed from the panel.",

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

  install: {
    kind: "image",
    env: { EULA: "TRUE" },
    files: [
      {
        /* The lines of the server.properties in the 1.26.51.1 archive that
           are not settings here, as the archive has them. The image unpacks
           the archive with `unzip -n`, which keeps a server.properties that
           is already there, and the panel writes its own before the first
           start: a new server got a file with the settings and nothing else.
           Measured, October 2026: such a server logged "Your current
           connection type is not set to NetherNet. In this release, NetherNet
           is the only supported transport type. Players will not be able to
           connect", and the archive's own file, on an empty volume, has
           transport=nethernet and started without it. Written only when a
           server is made, beneath its settings; after that they are the
           file's, and an operator's to change in Files. */
        file: "server.properties",
        kind: "properties",
        creating: true,
        entries: {
          "force-gamemode": "false",
          transport: "nethernet",
          "enable-lan-visibility": "true",
          "tick-distance": "4",
          "player-idle-timeout": "30",
          "max-threads": "8",
          "content-log-file-enabled": "false",
          "content-log-console-output-enabled": "false",
          "content-log-level": "info",
          "compression-threshold": "1",
          "compression-algorithm": "zlib",
          "server-authoritative-movement-strict": "false",
          "server-authoritative-dismount-strict": "false",
          "server-authoritative-entity-interactions-strict": "false",
          "player-position-acceptance-threshold": "0.5",
          "player-movement-action-direction-threshold": "0.85",
          "server-authoritative-block-breaking-pick-range-scalar": "1.5",
          "chat-restriction": "None",
          "disable-player-interaction": "false",
          "client-side-chunk-generation-enabled": "true",
          "block-network-ids-are-hashes": "true",
          "disable-persona": "false",
          "disable-custom-skins": "false",
          "server-build-radius-ratio": "Disabled",
          "allow-outbound-script-debugging": "false",
          "allow-inbound-script-debugging": "false",
          "script-debugger-auto-attach": "disabled",
        },
      },
    ],
  },

  /* Every setting is a line of server.properties that applies at the next
     restart, as on Java; they were the image's variables, and a rebuild
     each, until 0.11.0.

     Measured on itzg/minecraft-bedrock-server:2026.9.0, October 2026.
     /opt/bedrock-entry.sh runs `set-property --bulk
     /etc/bds-property-definitions.json` over server.properties on every
     start, which maps a variable to each key (SERVER_NAME to server-name,
     GAMEMODE to gamemode, TEXTUREPACK_REQUIRED to texturepack-required)
     and sets a key only when its variable is set; the image itself sets
     SERVER_PORT and SERVER_PORT_V6, which the panel gives it anyway. The
     server's archive is unpacked with `unzip -n`, which leaves a
     server.properties already there alone, so the panel's file, written
     before the first start, is the one the server reads — with the
     archive's other lines put in by the panel (`install.files`). A workload made
     before 0.11.0 still has the old variables: a change to one of them
     rebuilds it once (`formerEnv`). */
  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "properties", file: "server.properties", key: "server-name" },
      formerEnv: "SERVER_NAME",
      default: "Geeboard",
      maxLength: 60,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "mode",
      label: "Game mode",
      type: "enum",
      target: { kind: "properties", file: "server.properties", key: "gamemode" },
      formerEnv: "GAMEMODE",
      default: "survival",
      options: [
        { value: "survival", label: "Survival" },
        { value: "creative", label: "Creative" },
        { value: "adventure", label: "Adventure" },
      ],
      group: "World",
      /* "Sets the game mode for new players", in the server.properties
         the 1.26.51.1 server writes, October 2026. */
      help: "What a player gets the first time they join. Players already in the world keep theirs.",
      restartRequired: true,
    },
    {
      key: "difficulty",
      label: "Difficulty",
      type: "enum",
      target: { kind: "properties", file: "server.properties", key: "difficulty" },
      formerEnv: "DIFFICULTY",
      default: "normal",
      options: [
        { value: "peaceful", label: "Peaceful" },
        { value: "easy", label: "Easy" },
        { value: "normal", label: "Normal" },
        { value: "hard", label: "Hard" },
      ],
      group: "World",
      help: "Peaceful: no monsters, and hunger does no harm. From Easy to Hard, monsters hit harder at each step.",
      restartRequired: true,
    },
    {
      key: "allowCheats",
      label: "Allow cheats",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "allow-cheats" },
      default: false,
      group: "World",
      help: "Lets operators use the commands that change the world, such as give, tp and time set.",
      restartRequired: true,
    },
    {
      key: "levelName",
      label: "World name",
      type: "string",
      /* The folder under worlds/ the server opens. Another name is a new,
         empty world beside the old one, so it is chosen once. */
      target: { kind: "properties", file: "server.properties", key: "level-name" },
      default: "Bedrock level",
      maxLength: 60,
      pattern: { regex: "^[^/\\\\]+$", message: "cannot contain a slash" },
      group: "World",
      help: "The name of the world's folder on the server.",
      fixedAfterCreation: true,
      advanced: true,
    },
    {
      key: "levelSeed",
      label: "World seed",
      type: "string",
      target: { kind: "properties", file: "server.properties", key: "level-seed" },
      default: "",
      maxLength: 64,
      group: "World",
      help: "The world is generated from it on the first start. Empty: a random one.",
      fixedAfterCreation: true,
      advanced: true,
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "max-players" },
      formerEnv: "MAX_PLAYERS",
      default: 30,
      min: 1,
      max: 100,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "allowList",
      label: "Allow list only",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "allow-list" },
      formerEnv: "ALLOW_LIST",
      default: false,
      group: "Players",
      /* `allowlist add Steve` answered "Added Steve to the allowlist" on
         1.26.51.1, October 2026, and the name was in allowlist.json. */
      help: "Only players on the allow list can join. Add them from the console with allowlist add <name>.",
      restartRequired: true,
    },
    {
      key: "defaultPermission",
      label: "New players are",
      type: "enum",
      target: { kind: "properties", file: "server.properties", key: "default-player-permission-level" },
      default: "member",
      options: [
        { value: "visitor", label: "Visitors" },
        { value: "member", label: "Members" },
        { value: "operator", label: "Operators" },
      ],
      group: "Players",
      help: "Visitors can look but not build or fight; members can play; operators can also run commands. Someone already on the server keeps theirs.",
      restartRequired: true,
    },
    {
      key: "texturePackRequired",
      label: "Require the world's packs",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "texturepack-required" },
      default: false,
      group: "Players",
      help: "A player has to accept the world's resource and behavior packs to join, instead of playing without them.",
      restartRequired: true,
    },
    {
      key: "onlineMode",
      label: "Verify accounts",
      type: "boolean",
      target: { kind: "properties", file: "server.properties", key: "online-mode" },
      default: true,
      group: "Players",
      help: "Players sign in with a Microsoft account to join. Off lets anyone in under any name.",
      advanced: true,
      restartRequired: true,
    },
    {
      key: "viewDistance",
      label: "View distance",
      type: "number",
      target: { kind: "properties", file: "server.properties", key: "view-distance" },
      formerEnv: "VIEW_DISTANCE",
      default: 10,
      min: 4,
      max: 32,
      group: "Performance",
      help: "Chunks. Each step costs memory and CPU on every player.",
      restartRequired: true,
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
    // "/list" is "Unknown command: /." on 1.26.51.1, measured October 2026.
    refusesSlash: true,
    hint: "say reaches players and prints nothing here.",
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
