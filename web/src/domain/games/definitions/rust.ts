import type { GameDefinition } from "../types";

/* Rust.

   Steam app 258550, and the one game here whose calendar matters as much
   as its version: Facepunch forces an update on the first Thursday of
   the month and every server wipes with it. That is why the version
   channel is "stable" rather than a number — pinning Rust to a build is
   not a thing an operator can usefully do. */

export const RUST: GameDefinition = {
  id: "rust",
  name: "Rust",
  family: "Rust",
  art: "RUST",
  official: true,
  popularity: "96k servers",
  blurb: "Wipe cycles, Oxide plugins and a scheduler built around them.",

  portBase: 28015,
  portSpan: 200,
  ports: [
    { id: "game", label: "Game", offset: 0, protocol: "udp", primary: true },
    { id: "rcon", label: "RCON", offset: 1, protocol: "tcp", public: false, note: "private" },
    { id: "query", label: "Query", offset: 2, protocol: "udp" },
  ],

  defaults: { memoryGb: 16, cpuLimit: 600, diskGb: 200, playersMax: 120 },
  limits: { memoryGb: [8, 64], cpuLimit: [200, 1600], diskGb: [40, 500] },
  requirements: {
    memoryGbMin: 8,
    cpuPctMin: 200,
    diskGbMin: 40,
    os: ["linux"],
    arch: ["x64"],
    capabilities: ["docker", "steamcmd", "high-memory"],
  },

  install: { kind: "steamcmd", appId: 258550, anonymous: true },

  config: [
    {
      key: "serverName",
      label: "Server name",
      type: "string",
      target: { kind: "env", name: "RUST_SERVER_NAME" },
      default: "Geeboard",
      maxLength: 60,
      group: "Presentation",
      restartRequired: true,
    },
    {
      key: "description",
      label: "Description",
      type: "text",
      target: { kind: "env", name: "RUST_SERVER_DESCRIPTION" },
      default: "",
      maxLength: 240,
      group: "Presentation",
    },
    {
      key: "maxPlayers",
      label: "Max players",
      type: "number",
      target: { kind: "env", name: "RUST_SERVER_MAXPLAYERS" },
      default: 120,
      min: 1,
      max: 500,
      group: "Players",
      restartRequired: true,
    },
    {
      key: "worldSize",
      label: "Map size",
      type: "number",
      target: { kind: "env", name: "RUST_SERVER_WORLDSIZE" },
      default: 3500,
      min: 1000,
      max: 6000,
      group: "World",
      help: "Bigger maps cost disk and take longer to generate on first boot.",
      restartRequired: true,
    },
    {
      key: "seed",
      label: "Map seed",
      type: "string",
      target: { kind: "env", name: "RUST_SERVER_SEED" },
      default: "",
      maxLength: 24,
      group: "World",
      help: "Left empty, a new one is picked at each wipe.",
      restartRequired: true,
    },
    {
      key: "gatherRate",
      label: "Gather rate",
      type: "enum",
      target: { kind: "env", name: "RUST_GATHER_RATE" },
      default: "1",
      options: [
        { value: "1", label: "1× · vanilla" },
        { value: "2", label: "2×" },
        { value: "5", label: "5×" },
        { value: "10", label: "10×" },
      ],
      group: "Rules",
    },
  ],

  health: {
    probes: [{ kind: "query", protocol: "source-a2s" }, { kind: "process" }],
    /* Rust generates the map on first boot, and a 4500-size map on a
       cold node is a long quarter of an hour. */
    bootGraceSeconds: 1200,
    readyPattern: "SteamServerConnect",
    crashPattern: "(Fatal error|Segmentation fault)",
  },

  console: {
    stopCommand: "quit",
    saveCommand: "server.save",
    broadcastCommand: 'say "%s"',
    examples: ["players", "server.save", "server.writecfg", "quit"],
  },

  versionProviders: ["static", "steam"],

  versions: [
    {
      id: "rust-oxide",
      label: "Rust · Oxide",
      image: "didstopia/rust-server:latest",
      env: { RUST_OXIDE_ENABLED: "1" },
      note: "Modded, with the plugin loader most servers run",
      released: "2025-09-04",
      channel: "stable",
      recommended: true,
    },
    {
      id: "rust-vanilla",
      label: "Rust · vanilla",
      image: "didstopia/rust-server:latest",
      env: { RUST_OXIDE_ENABLED: "0" },
      note: "Facepunch's build, unmodified",
      released: "2025-09-04",
      channel: "stable",
    },
  ],

  templates: [
    {
      id: "vanilla-wipe",
      name: "Monthly wipe",
      blurb: "Standard rates, wiped on the first Thursday with the forced update.",
      summary: "1× gather, monthly map wipe, 120 slots",
      whitelist: false,
      config: { gatherRate: "1", maxPlayers: 120 },
    },
    {
      id: "high-rates",
      name: "High rates",
      blurb: "Faster gathering and shorter nights, for a server people drop into.",
      summary: "5× gather, instant craft, weekly wipe",
      whitelist: false,
      config: { gatherRate: "5", maxPlayers: 120 },
    },
  ],
};
