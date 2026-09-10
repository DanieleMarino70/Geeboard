/* What Geeboard knows how to run.

   Deliberately not in the database and deliberately not "server-only":
   the wizard renders these cards in the browser and the create
   operation validates against the same table, so there is one source of
   truth for what a version means and no way for the two to disagree.

   A game contributes the container image, the port layout and the
   defaults; a template contributes the environment the server boots
   with. Everything a template sets is editable afterwards, which is why
   the wizard can promise that. */

export type Protocol = "tcp" | "udp" | "both";

export interface PortRole {
  label: string;
  /** Added to the allocated base port. */
  offset: number;
  protocol: Protocol;
  /** Fixed port inside the container, when it differs from the host one. */
  container?: number;
  /** The address players connect to. Exactly one per game. */
  primary?: boolean;
  note?: string;
}

export interface Version {
  id: string;
  label: string;
  image: string;
  note: string;
  released: string;
  recommended?: boolean;
}

export interface Template {
  id: string;
  name: string;
  blurb: string;
  /** The settings line the review step shows. */
  summary: string;
  whitelist: boolean;
  env: Record<string, string>;
}

export interface Game {
  id: string;
  name: string;
  /** Two lines at most; the cover art is a placeholder until real artwork. */
  art: string;
  /** The `game` column, which the rest of the panel groups by. */
  family: string;
  official: boolean;
  popularity: string;
  blurb: string;
  /** First port of the game's range, and how far allocation may walk. */
  portBase: number;
  portSpan: number;
  ports: PortRole[];
  defaults: { memoryGb: number; cpuLimit: number; diskGb: number; playersMax: number };
  limits: { memoryGb: [number, number]; cpuLimit: [number, number]; diskGb: [number, number] };
  versions: Version[];
  templates: Template[];
}

/* Every game reserves a block of consecutive ports, so one allocation
   decision covers the whole layout and two servers can never interleave
   into each other's range. */
export function strideOf(game: Game): number {
  return Math.max(...game.ports.map((p) => p.offset)) + 1;
}

const MINECRAFT_TEMPLATES: Template[] = [
  {
    id: "survival",
    name: "Survival",
    blurb: "The default world, with the guardrails an operator usually wants on day one.",
    summary: "Whitelist on, keep-inventory off, hard difficulty",
    whitelist: true,
    env: { MODE: "survival", DIFFICULTY: "hard", ENABLE_WHITELIST: "true", KEEP_INVENTORY: "false" },
  },
  {
    id: "creative",
    name: "Creative",
    blurb: "Flight and unlimited blocks, for a build server nobody has to survive.",
    summary: "Creative mode, peaceful, whitelist off",
    whitelist: false,
    env: { MODE: "creative", DIFFICULTY: "peaceful", ENABLE_WHITELIST: "false" },
  },
  {
    id: "hardcore",
    name: "Hardcore",
    blurb: "One life each. Death puts a player into spectator rather than removing them.",
    summary: "Hardcore, hard difficulty, whitelist on",
    whitelist: true,
    env: { MODE: "survival", DIFFICULTY: "hard", HARDCORE: "true", ENABLE_WHITELIST: "true" },
  },
  {
    id: "minigames",
    name: "Minigames",
    blurb: "Adventure mode with a fixed spawn, for a hub that hands players off elsewhere.",
    summary: "Adventure mode, spawn protection on, PvP off",
    whitelist: false,
    env: { MODE: "adventure", PVP: "false", SPAWN_PROTECTION: "32" },
  },
];

export const GAMES: Game[] = [
  {
    id: "minecraft-java",
    name: "Minecraft: Java Edition",
    art: "MC\nJAVA",
    family: "Minecraft",
    official: true,
    popularity: "2.1M servers",
    blurb: "Paper, Purpur, Fabric, Forge and vanilla. The whole modded ecosystem.",
    portBase: 25565,
    portSpan: 400,
    ports: [
      { label: "Game", offset: 0, protocol: "both", primary: true },
      { label: "Query", offset: 1, protocol: "udp" },
      { label: "RCON", offset: 2, protocol: "tcp", container: 25575, note: "private" },
    ],
    defaults: { memoryGb: 8, cpuLimit: 300, diskGb: 60, playersMax: 40 },
    limits: { memoryGb: [1, 32], cpuLimit: [50, 800], diskGb: [5, 250] },
    versions: [
      {
        id: "paper-1-21-4",
        label: "Paper 1.21.4",
        image: "itzg/minecraft-server:java21",
        note: "Build 218 · the plugin server most people mean",
        released: "12 Aug 2025",
        recommended: true,
      },
      {
        id: "purpur-1-21-4",
        label: "Purpur 1.21.4",
        image: "itzg/minecraft-server:java21",
        note: "Paper with more knobs, for a PvP server that needs them",
        released: "18 Aug 2025",
      },
      {
        id: "fabric-1-21-4",
        label: "Fabric 1.21.4",
        image: "itzg/minecraft-server:java21",
        note: "The mod loader, when the modpack asks for it",
        released: "2 Aug 2025",
      },
      {
        id: "vanilla-1-21-4",
        label: "Vanilla 1.21.4",
        image: "itzg/minecraft-server:java21",
        note: "Mojang's own server, with nothing added",
        released: "3 Dec 2024",
      },
      {
        id: "paper-1-20-6",
        label: "Paper 1.20.6",
        image: "itzg/minecraft-server:java21",
        note: "Held back for a plugin that has not caught up yet",
        released: "29 Apr 2024",
      },
    ],
    templates: MINECRAFT_TEMPLATES,
  },
  {
    id: "minecraft-bedrock",
    name: "Minecraft: Bedrock",
    art: "MC\nBEDROCK",
    family: "Minecraft",
    official: true,
    popularity: "840k servers",
    blurb: "Console and mobile crossplay, with add-on support.",
    portBase: 19132,
    portSpan: 200,
    ports: [
      { label: "Game", offset: 0, protocol: "udp", primary: true },
      { label: "IPv6", offset: 1, protocol: "udp" },
    ],
    defaults: { memoryGb: 4, cpuLimit: 200, diskGb: 40, playersMax: 30 },
    limits: { memoryGb: [1, 16], cpuLimit: [50, 400], diskGb: [5, 150] },
    versions: [
      {
        id: "bedrock-latest",
        label: "Bedrock 1.21",
        image: "itzg/minecraft-bedrock-server:latest",
        note: "Tracks the release channel Mojang ships to consoles",
        released: "6 Aug 2025",
        recommended: true,
      },
      {
        id: "bedrock-preview",
        label: "Bedrock preview",
        image: "itzg/minecraft-bedrock-server:latest",
        note: "Next release, for testing add-ons before they land",
        released: "1 Sep 2025",
      },
    ],
    templates: [
      {
        id: "survival",
        name: "Survival",
        blurb: "The default world, whitelisted so an open UDP port is not an open door.",
        summary: "Whitelist on, normal difficulty",
        whitelist: true,
        env: { GAMEMODE: "survival", DIFFICULTY: "normal", ALLOW_LIST: "true" },
      },
      {
        id: "creative",
        name: "Creative",
        blurb: "A build server for tablets and consoles.",
        summary: "Creative mode, peaceful",
        whitelist: false,
        env: { GAMEMODE: "creative", DIFFICULTY: "peaceful" },
      },
    ],
  },
  {
    id: "rust",
    name: "Rust",
    art: "RUST",
    family: "Rust",
    official: true,
    popularity: "96k servers",
    blurb: "Wipe cycles, Oxide plugins and a scheduler built around them.",
    portBase: 28015,
    portSpan: 200,
    ports: [
      { label: "Game", offset: 0, protocol: "udp", primary: true },
      { label: "RCON", offset: 1, protocol: "tcp", note: "private" },
      { label: "Query", offset: 2, protocol: "udp" },
    ],
    defaults: { memoryGb: 16, cpuLimit: 600, diskGb: 200, playersMax: 120 },
    limits: { memoryGb: [8, 64], cpuLimit: [200, 1600], diskGb: [40, 500] },
    versions: [
      {
        id: "rust-oxide",
        label: "Rust · Oxide",
        image: "didstopia/rust-server:latest",
        note: "Modded, with the plugin loader most servers run",
        released: "4 Sep 2025",
        recommended: true,
      },
      {
        id: "rust-vanilla",
        label: "Rust · vanilla",
        image: "didstopia/rust-server:latest",
        note: "Facepunch's build, unmodified",
        released: "4 Sep 2025",
      },
    ],
    templates: [
      {
        id: "vanilla-wipe",
        name: "Monthly wipe",
        blurb: "Standard rates, wiped on the first Thursday with the forced update.",
        summary: "1x gather, monthly map wipe, 120 slots",
        whitelist: false,
        env: { RUST_SERVER_SEED: "random", RUST_GATHER_RATE: "1" },
      },
      {
        id: "high-rates",
        name: "High rates",
        blurb: "Faster gathering and shorter nights, for a server people drop into.",
        summary: "5x gather, instant craft, weekly wipe",
        whitelist: false,
        env: { RUST_SERVER_SEED: "random", RUST_GATHER_RATE: "5" },
      },
    ],
  },
  {
    id: "valheim",
    name: "Valheim",
    art: "VALHEIM",
    family: "Valheim",
    official: false,
    popularity: "61k servers",
    blurb: "Dedicated worlds with BepInEx mod loading.",
    portBase: 2456,
    portSpan: 120,
    ports: [
      { label: "Game", offset: 0, protocol: "udp", primary: true },
      { label: "Query", offset: 1, protocol: "udp" },
    ],
    defaults: { memoryGb: 4, cpuLimit: 200, diskGb: 30, playersMax: 10 },
    limits: { memoryGb: [2, 16], cpuLimit: [100, 400], diskGb: [5, 100] },
    versions: [
      {
        id: "valheim-stable",
        label: "Valheim stable",
        image: "lloesche/valheim-server:latest",
        note: "The public branch, with crossplay on",
        released: "22 Jul 2025",
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
        env: { SERVER_PUBLIC: "false", WORLD_NAME: "geeboard" },
      },
      {
        id: "hardmode",
        name: "Hard",
        blurb: "No portals and harder raids, for a group that has done it before.",
        summary: "Portals off, raids hard, password set",
        whitelist: true,
        env: { SERVER_PUBLIC: "false", WORLD_NAME: "geeboard", PRESET: "hard" },
      },
    ],
  },
  {
    id: "palworld",
    name: "Palworld",
    art: "PALWORLD",
    family: "Palworld",
    official: false,
    popularity: "58k servers",
    blurb: "Up to 32 players with automatic world compaction.",
    portBase: 8211,
    portSpan: 120,
    ports: [
      { label: "Game", offset: 0, protocol: "udp", primary: true },
      { label: "RCON", offset: 1, protocol: "tcp", note: "private" },
    ],
    defaults: { memoryGb: 16, cpuLimit: 400, diskGb: 40, playersMax: 32 },
    limits: { memoryGb: [8, 32], cpuLimit: [200, 800], diskGb: [10, 120] },
    versions: [
      {
        id: "palworld-stable",
        label: "Palworld stable",
        image: "thijsvanloef/palworld-server-docker:latest",
        note: "The release branch, with the memory leak fix",
        released: "28 Aug 2025",
        recommended: true,
      },
    ],
    templates: [
      {
        id: "default",
        name: "Default",
        blurb: "The rates the game ships with.",
        summary: "1x rates, 32 slots, PvP off",
        whitelist: false,
        env: { PLAYERS: "32", PUBLIC_IP: "" },
      },
      {
        id: "coop",
        name: "Co-op",
        blurb: "A smaller world for a group that plays together, with faster capture.",
        summary: "2x capture, 8 slots, PvP off",
        whitelist: true,
        env: { PLAYERS: "8", PUBLIC_IP: "" },
      },
    ],
  },
  {
    id: "satisfactory",
    name: "Satisfactory",
    art: "SATIS-\nFACTORY",
    family: "Satisfactory",
    official: false,
    popularity: "22k servers",
    blurb: "Dedicated factories with blueprint sync.",
    portBase: 7777,
    portSpan: 120,
    ports: [
      { label: "Game", offset: 0, protocol: "both", primary: true },
      { label: "Query", offset: 1, protocol: "udp" },
      { label: "Beacon", offset: 2, protocol: "udp" },
    ],
    defaults: { memoryGb: 12, cpuLimit: 400, diskGb: 40, playersMax: 8 },
    limits: { memoryGb: [6, 32], cpuLimit: [200, 800], diskGb: [10, 120] },
    versions: [
      {
        id: "satisfactory-stable",
        label: "Satisfactory 1.0",
        image: "wolveix/satisfactory-server:latest",
        note: "The 1.0 release branch",
        released: "10 Sep 2025",
        recommended: true,
      },
    ],
    templates: [
      {
        id: "default",
        name: "Default",
        blurb: "A new save on the standard map.",
        summary: "Autosave every 5 minutes, 8 slots",
        whitelist: false,
        env: { MAXPLAYERS: "8", AUTOSAVENUM: "5" },
      },
    ],
  },
];

export function gameById(id: string): Game | undefined {
  return GAMES.find((g) => g.id === id);
}

export function versionById(game: Game, id: string): Version | undefined {
  return game.versions.find((v) => v.id === id);
}

export function templateById(game: Game, id: string): Template | undefined {
  return game.templates.find((t) => t.id === id);
}

/** The concrete ports a base allocation turns into. */
export function portsFor(game: Game, base: number) {
  return game.ports.map((role) => ({
    label: role.label,
    host: base + role.offset,
    container: role.container ?? base + role.offset,
    protocol: role.protocol,
    primary: role.primary === true,
    note: role.note,
  }));
}

/** How a protocol reads in the wizard. */
export function protocolLabel(protocol: Protocol): string {
  return protocol === "both" ? "TCP + UDP" : protocol.toUpperCase();
}

/** A server name turned into the slug that becomes its URL and hostname. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // NFKD split the accents off; this drops the combining marks.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38);
}
