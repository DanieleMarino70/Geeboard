import type { GameDefinition } from "../types";

/* Minecraft: Bedrock.

   Bedrock is UDP-only and has no RCON, so the console is stdin and the
   health check cannot lean on a TCP handshake — the log line is the
   signal. Its allow-list is a different feature from Java's whitelist
   under a similar name, which is why the config key is its own. */

export const MINECRAFT_BEDROCK: GameDefinition = {
  id: "minecraft-bedrock",
  name: "Minecraft: Bedrock",
  family: "Minecraft",
  art: "MC\nBEDROCK",
  official: true,
  popularity: "840k servers",
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
    broadcastCommand: "say %s",
    examples: ["list", "allowlist add <player>", "op <player>", "stop"],
  },

  versionProviders: ["static"],

  versions: [
    {
      id: "bedrock-latest",
      label: "Bedrock 1.21",
      upstream: "1.21",
      image: "itzg/minecraft-bedrock-server:latest",
      env: { VERSION: "LATEST" },
      note: "Tracks the release channel Mojang ships to consoles",
      released: "2024-06-13",
      channel: "stable",
      recommended: true,
    },
    {
      id: "bedrock-preview",
      label: "Bedrock preview",
      image: "itzg/minecraft-bedrock-server:latest",
      env: { VERSION: "PREVIEW" },
      note: "Next release, for testing add-ons before they land",
      released: "2025-09-01",
      channel: "preview",
    },
  ],

  templates: [
    {
      id: "survival",
      name: "Survival",
      blurb: "The default world, allow-listed so an open UDP port is not an open door.",
      summary: "Allow list on, normal difficulty",
      whitelist: true,
      config: { mode: "survival", difficulty: "normal", allowList: true },
    },
    {
      id: "creative",
      name: "Creative",
      blurb: "A build server for tablets and consoles.",
      summary: "Creative mode, peaceful",
      whitelist: false,
      config: { mode: "creative", difficulty: "peaceful" },
    },
  ],
};
