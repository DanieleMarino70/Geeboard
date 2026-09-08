/* Sample data standing in for the API. Everything here is invented —
   replace with real queries when the daemon and database land. */

export type ServerState =
  | "running"
  | "starting"
  | "stopping"
  | "stopped"
  | "crashed"
  | "suspended";

export type Tone = "success" | "warning" | "danger" | "info" | "accent" | "muted";

export const STATE_TONE: Record<ServerState, { tone: Tone; label: string; pulse: boolean }> = {
  running: { tone: "success", label: "Running", pulse: false },
  starting: { tone: "warning", label: "Starting", pulse: true },
  stopping: { tone: "warning", label: "Stopping", pulse: true },
  stopped: { tone: "muted", label: "Stopped", pulse: false },
  crashed: { tone: "danger", label: "Crashed", pulse: false },
  suspended: { tone: "muted", label: "Suspended", pulse: false },
};

export interface GameServer {
  id: string;
  name: string;
  game: string;
  version: string;
  art: string;
  state: ServerState;
  players: { online: number; max: number };
  cpu: number;
  ram: number;
  disk: number;
  address: string;
  node: string;
  uptime: string;
  worldSize: string;
  spark: number[];
}

export const SERVERS: GameServer[] = [
  {
    id: "aurora",
    name: "Aurora SMP",
    game: "Minecraft",
    version: "1.21.4 · Paper",
    art: "MC",
    state: "running",
    players: { online: 23, max: 40 },
    cpu: 34,
    ram: 62,
    disk: 41,
    address: "aurora.ashfold.gg:25565",
    node: "fra-node-02",
    uptime: "6 d 14 h",
    worldSize: "11.2 GB",
    spark: [21, 19, 22, 14, 17, 11, 13, 8, 12, 7, 9],
  },
  {
    id: "nightfall",
    name: "Nightfall PvP",
    game: "Minecraft",
    version: "1.20.6 · Purpur",
    art: "MC",
    state: "starting",
    players: { online: 0, max: 80 },
    cpu: 71,
    ram: 44,
    disk: 28,
    address: "pvp.ashfold.gg:25566",
    node: "fra-node-02",
    uptime: "—",
    worldSize: "6.8 GB",
    spark: [26, 25, 24, 22, 18, 15, 16, 11, 9, 6, 5],
  },
  {
    id: "creative",
    name: "Ashfold Creative",
    game: "Minecraft",
    version: "1.21.4 · Fabric",
    art: "MC",
    state: "running",
    players: { online: 18, max: 60 },
    cpu: 22,
    ram: 48,
    disk: 66,
    address: "build.ashfold.gg:25567",
    node: "ash-node-01",
    uptime: "21 d 2 h",
    worldSize: "18.4 GB",
    spark: [18, 20, 17, 19, 16, 18, 15, 17, 14, 16, 13],
  },
  {
    id: "wipe",
    name: "Wipe Wednesday",
    game: "Rust",
    version: "2024.11",
    art: "RUST",
    state: "stopped",
    players: { online: 0, max: 120 },
    cpu: 0,
    ram: 0,
    disk: 54,
    address: "rust.ashfold.gg:28015",
    node: "fra-node-02",
    uptime: "—",
    worldSize: "9.1 GB",
    spark: [24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24],
  },
];

export const getServer = (id: string) => SERVERS.find((s) => s.id === id);

export const STATS = [
  {
    icon: "server" as const,
    label: "Servers online",
    value: "3",
    unit: "of 4",
    delta: "stable",
    deltaTone: "flat" as const,
    sub: "7 days without an incident",
  },
  {
    icon: "users" as const,
    label: "Players now",
    value: "41",
    unit: "peak 58",
    delta: "+21%",
    deltaTone: "up" as const,
    sub: "vs last Saturday",
  },
  {
    icon: "activity" as const,
    label: "Median TPS",
    value: "19.8",
    unit: "of 20",
    delta: "−0.1",
    deltaTone: "flat" as const,
    sub: "across every running world",
  },
  {
    icon: "drive" as const,
    label: "Storage used",
    value: "412",
    unit: "GB of 750",
    delta: "+18 GB",
    deltaTone: "down" as const,
    sub: "snapshots take 61% of it",
  },
];

export const ACTIVITY = [
  { who: "thornfield", what: "joined Aurora SMP", when: "2 min ago", tone: "info" as const },
  { who: "Scheduler", what: "ran the nightly backup", when: "38 min ago", tone: "accent" as const },
  { who: "Mara", what: "raised the heap ceiling to 8 GB", when: "1 h ago", tone: "muted" as const },
];

export const NODES = [
  { id: "fra-node-02", city: "Frankfurt", ping: "14 ms", cpu: 48, ram: 61, healthy: true },
  { id: "ash-node-01", city: "Ashburn", ping: "92 ms", cpu: 33, ram: 40, healthy: true },
  { id: "sgp-node-01", city: "Singapore", ping: "211 ms", cpu: 88, ram: 91, healthy: false },
];

export const ONLINE_PLAYERS = [
  { name: "thornfield", ping: 14 },
  { name: "lumen_verd", ping: 41 },
  { name: "kestrelbay", ping: 8 },
  { name: "oakhollow", ping: 122 },
];

export const BACKUPS = [
  { name: "daily-09-07", size: "3.4 GB", when: "2 h ago", ok: true },
  { name: "daily-09-06", size: "3.3 GB", when: "1 d ago", ok: true },
  { name: "pre-update", size: "3.1 GB", when: "4 d ago", ok: false },
];

export type LogLevel = "INFO" | "WARN" | "ERROR" | "JOIN" | "LEFT" | "CMD" | "CHAT";

export interface LogLine {
  time: string;
  level: LogLevel;
  message: string;
}

/* ANSI severity is mapped onto the semantic palette rather than raw
   terminal colours, so output stays readable in light mode. */
export const LOG_COLOUR: Record<LogLevel, { level: string; message: string }> = {
  INFO: { level: "text-con-dim", message: "text-con-ink" },
  WARN: { level: "text-warning", message: "text-warning" },
  ERROR: { level: "text-danger", message: "text-danger" },
  JOIN: { level: "text-info", message: "text-con-ink" },
  LEFT: { level: "text-info", message: "text-con-dim" },
  CMD: { level: "text-accent", message: "text-accent" },
  CHAT: { level: "text-ink-3", message: "text-con-ink" },
};

export const CONSOLE_LOG: LogLine[] = [
  { time: "14:22:04", level: "INFO", message: "Starting minecraft server version 1.21.4" },
  { time: "14:22:05", level: "INFO", message: "Loading properties · level-name=aurora, view-distance=10" },
  { time: "14:22:09", level: "INFO", message: "Preparing spawn area: 84%" },
  { time: "14:22:16", level: "INFO", message: 'Done (11.482s)! For help, type "help"' },
  { time: "14:23:58", level: "JOIN", message: "kestrelbay joined the game (22 online)" },
  { time: "14:24:31", level: "JOIN", message: "thornfield joined the game (23 online)" },
  { time: "14:24:47", level: "CHAT", message: "<thornfield> anyone got spare netherite" },
  { time: "14:25:02", level: "CMD", message: "/whitelist add lumen_verd" },
  { time: "14:25:03", level: "INFO", message: "Added lumen_verd to the whitelist" },
  { time: "14:25:44", level: "WARN", message: "Can't keep up! Running 2481ms behind — did the system time change?" },
  { time: "14:25:47", level: "ERROR", message: "Chunk file at [-12,41] is missing block state palette" },
  { time: "14:25:48", level: "WARN", message: "Region file r.-1.2.mca will be regenerated on next save" },
  { time: "14:26:03", level: "INFO", message: "Autosave complete · 1.2 GB written in 840ms" },
  { time: "14:26:19", level: "LEFT", message: "mirefen left the game (22 online)" },
  { time: "14:26:40", level: "INFO", message: "Watchdog: tick time back within budget (48.2ms)" },
];

export const COMMAND_SUGGESTIONS = ["/say", "/save-all", "/whitelist add", "/op", "/stop"];
