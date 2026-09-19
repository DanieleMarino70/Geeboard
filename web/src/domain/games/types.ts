/* What Geeboard knows about a game.

   A GameDefinition is the single place a game's knowledge lives:
   how it is installed, how it is configured, which ports it needs, what
   a healthy one looks like, and where its versions come from. Nothing
   outside this directory should ever branch on which game it is holding.

   Adding a game means adding a definition — not touching the wizard, the
   runtime, the poller or the API. That is the whole point of the shape.

   Deliberately not "server-only": the wizard renders these in the
   browser and the create operation validates against the same objects,
   so there is one source of truth and no way for the two to disagree.
   Nothing in a definition is a secret. */

export type Protocol = "tcp" | "udp" | "both";

export type OperatingSystem = "linux" | "windows";
export type Architecture = "x64" | "arm64";

/* ── Node capabilities ─────────────────────────────────────────────
   What a node can offer, and what a game may ask for. Kept as a closed
   union rather than free strings so a typo in a definition is a compile
   error rather than a game that can never be placed. */
export const CAPABILITIES = [
  "docker",
  "steamcmd",
  "java",
  "gpu",
  "ipv6",
  "high-memory",
  "ssd",
  "workshop",
  "backups",
  "snapshots",
] as const;

export type CapabilityId = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  docker: "Docker",
  steamcmd: "SteamCMD",
  java: "Java",
  gpu: "GPU",
  ipv6: "IPv6",
  "high-memory": "High memory",
  ssd: "SSD storage",
  workshop: "Steam Workshop",
  backups: "Backups",
  snapshots: "Snapshots",
};

/* ── Ports ────────────────────────────────────────────────────────
   A game reserves a block of consecutive ports so one allocation
   decision covers the whole layout and two servers can never interleave
   into each other's range. */
export interface PortRole {
  /** Stable within the game: "game", "query", "rcon". */
  id: string;
  label: string;
  /** Added to the allocated base port. */
  offset: number;
  protocol: Protocol;
  /** Fixed port inside the container, when it differs from the host one. */
  container?: number;
  /** The address players connect to. Exactly one per game. */
  primary?: boolean;
  /** False for an administrative port that should not be advertised. */
  public?: boolean;
  note?: string;
}

/* ── Requirements ─────────────────────────────────────────────────
   What a node must be able to offer before this game can be placed on
   it. The compatibility engine reads these; nothing else should. */
export interface GameRequirements {
  memoryGbMin: number;
  /** Percent of one core. 200 is two cores. */
  cpuPctMin: number;
  diskGbMin: number;
  os: OperatingSystem[];
  arch: Architecture[];
  capabilities: CapabilityId[];
}

/* ── Installation ─────────────────────────────────────────────────
   How server files come to exist on a node.

   `image` means the container image installs the server itself, which is
   what every game shipped so far does. The other two describe work an
   installer has to perform, and exist now so a definition can state its
   strategy honestly before the installers that carry them out are
   written. */
export type InstallStrategy =
  | {
      kind: "image";
      /* What the image needs before it will run at all — a licence
         acceptance, a server type. Not user configuration: nothing here
         is offered as a setting, because changing it does not make
         sense, it just breaks the server. */
      env?: Record<string, string>;
      /* Lines the game's own config file has to contain before it will
         run under Geeboard at all — for Terraria, which world file to
         load, without which the server sits at an interactive menu
         waiting for somebody to pick one. The same rule as `env`: not a
         setting, never offered as one. Written beneath the operator's
         settings, so a setting with the same key wins. */
      files?: Array<{ file: string; kind: "properties"; entries: Record<string, string> }>;
    }
  | {
      kind: "steamcmd";
      appId: number;
      branch?: string;
      anonymous: boolean;
      /* Same meaning as the image strategy's: what the workload needs
         before it behaves, never a setting. Valheim's image runs its own
         hourly backup cron into the directory Geeboard backs up, which
         would put copies of the world inside every snapshot of the
         world. */
      env?: Record<string, string>;
    }
  | { kind: "download"; archive: "zip" | "tar.gz"; stripComponents?: number };

/* ── Configuration ────────────────────────────────────────────────
   A game describes its settings; the platform renders them into
   whatever file or variable the game actually reads. This is what lets
   the panel show "Max players" instead of an environment variable
   nobody should have to know the name of. */
export type ConfigTarget =
  /** An environment variable on the runtime. */
  | { kind: "env"; name: string }
  /** A `key=value` line in a properties file. */
  | { kind: "properties"; file: string; key: string }
  /** A key inside an INI section. */
  | { kind: "ini"; file: string; section: string; key: string }
  /** A JSON pointer into a config file. */
  | { kind: "json"; file: string; pointer: string }
  /** A flag on the server's command line. */
  | { kind: "arg"; flag: string };

export type ConfigValue = string | number | boolean;

export interface ConfigField {
  /** The domain-level name, e.g. "maxPlayers". Stable across versions. */
  key: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "enum";
  /** Where the value has to land for the game to read it. */
  target: ConfigTarget;
  default: ConfigValue;
  help?: string;
  group?: string;
  min?: number;
  max?: number;
  maxLength?: number;
  minLength?: number;
  /* Rules a game has about one setting in terms of another. Declarative
     rather than a function, because the settings form is rendered in the
     browser from these fields and a function cannot cross that boundary
     — and because "Valheim needs a password when the server is public"
     is a fact about Valheim, not a branch in a validator. */
  requiredWhen?: { key: string; equals: ConfigValue };
  /** This value must not contain the value of that field. */
  mustNotContain?: string;
  /* Read once, when the world is created, and never again. Zomboid's
     sandbox preset is copied into the world's rules on its first start;
     changing it afterwards would rebuild the server and change nothing.
     The settings form shows such a field and does not let it be edited,
     and the operation refuses a change to it. */
  fixedAfterCreation?: boolean;
  options?: Array<{ value: string; label: string }>;
  /** The server only picks this up when it next boots. */
  restartRequired?: boolean;
  /** Hidden behind "advanced" in the UI. */
  advanced?: boolean;
}

/* ── Health ───────────────────────────────────────────────────────
   A running container is not a healthy game server. These are the
   checks that tell the difference; each game says which apply to it. */
export type HealthProbe =
  /** The port accepts a TCP connection. */
  | { kind: "port"; port: string; timeoutMs?: number }
  /** A line matching this pattern has appeared in the console. */
  | { kind: "log"; pattern: string }
  /** The game's own query protocol answers. */
  | { kind: "query"; protocol: "minecraft-ping" | "source-a2s" | "terraria-rest" }
  /** RCON accepts a command and answers. */
  | { kind: "rcon"; command: string }
  /** The process is alive — the weakest check, and never the only one. */
  | { kind: "process" };

export interface HealthPolicy {
  /** Ordered; the first failure is the one reported. */
  probes: HealthProbe[];
  /** How long a server may take to become healthy after a start. */
  bootGraceSeconds: number;
  /** A console line matching this means the server is up. */
  readyPattern?: string;
  /** A console line matching this means it fell over on its own. */
  crashPattern?: string;
}

/* ── Console ──────────────────────────────────────────────────────
   Game-aware commands, so "stop the server safely" is one thing the
   platform knows rather than something an operator has to remember.

   Some games have no console language at all: Valheim's dedicated server
   is driven by signals and reads nothing from its input. For those the
   dialect names no commands, and `acceptsCommands` is how the console
   page knows to show the output and no prompt. */
export interface ConsoleDialect {
  /** Written to stdin to shut the game down cleanly. */
  stopCommand?: string;
  /* How long the game needs to exit after being asked, when that is more
     than the panel's usual thirty seconds. Measured, not guessed: see
     each definition's comment for where its number came from. */
  stopGraceSeconds?: number;
  /** Flushes the world to disk before a backup. */
  saveCommand?: string;
  /** Announces to players; `%s` is replaced with the message. */
  broadcastCommand?: string;
  /** Suggested in the console's command hints. */
  examples?: string[];
  /* How the game's console says a player arrived and left, as regular
     expressions with a named group `name`. Absent means the game says
     nothing a panel can read, and players are not counted for it.

     Anchored tightly on purpose: a chat line is also console output, and
     a player typing "Steve joined the game" must not add a Steve. */
  players?: { join: string; leave: string };
}

/* ── Versions ─────────────────────────────────────────────────────
   A version as the definition ships it. Providers may add more at
   runtime — see versions.ts, which is where "latest" gets its several
   different meanings. */
export type VersionChannel = "stable" | "snapshot" | "preview" | "legacy";

export interface GameVersion {
  /* Stable within the game: "paper-1-21-4". It is stored on servers, in
     rollback records and in API callers' code, so it names what the
     version *is* and never how it is currently distributed — Zomboid's
     "b41-stable" stopped being true the day build 42 took the public
     branch. */
  id: string;
  /* Ids this version used to go by. Renaming a version has to be a
     rename: a lookup by the old id still finds it, and the catalog sync
     moves the stored row rather than orphaning every server linked to
     it. */
  formerIds?: string[];
  /* Versions in one line are updates of each other. Moving between lines
     is not an update, whatever the numbers say: Paper to Fabric loses
     every plugin, and a Zomboid build 41 world does not open in build 42.
     An update is only ever offered, or performed, within a line. Absent
     means the game's one line. */
  line?: string;
  label: string;
  /** The upstream version string, when the game has one: "1.4.4.9". */
  upstream?: string;
  /** The container image that runs it. */
  image: string;
  note: string;
  /** ISO date, or a human date for versions predating provider lookup. */
  released: string;
  channel: VersionChannel;
  recommended?: boolean;
  /** False for a version Geeboard knows about but will not install. */
  supported?: boolean;
  /* The Steam branch this version tracks, for a game distributed that
     way. It is how a build id coming back from Steam finds the version
     it belongs to — see versions.ts. */
  steamBranch?: string;
  /** Where this version's files come from, when not the image. */
  download?: { url: string; sha256?: string };
  /* What selecting this version contributes to the runtime environment.
     One image usually serves many versions — the difference between
     Paper 1.21.4 and vanilla 1.20.6 is these variables, not the tag. */
  env?: Record<string, string>;
  /* Arguments this version's server has to start with, before any
     setting's own. For an image whose entrypoint passes its arguments
     on — TShock, which only reads Terraria's config file when told
     where it is. */
  args?: string[];
}

/* ── Templates ────────────────────────────────────────────────────
   A starting point for a new server's configuration. Everything a
   template sets is editable afterwards. */
export interface GameTemplate {
  id: string;
  name: string;
  blurb: string;
  /** The settings line the review step shows. */
  summary: string;
  /** Domain config keys, not environment variables. */
  config: Record<string, ConfigValue>;
}

/* ── The definition ───────────────────────────────────────────────── */

export interface GameDefinition {
  id: string;
  name: string;
  /** The family the rest of the panel groups by: "Minecraft". */
  family: string;
  /** Two lines at most; a stand-in until real cover artwork. */
  art: string;
  official: boolean;
  /* No popularity figure: "2.1M servers" was written into the
     definitions, nobody counted it, and next to "3 hosted here" it read
     as something this panel knew. */
  blurb: string;

  /** First port of the game's range, and how far allocation may walk. */
  portBase: number;
  portSpan: number;
  ports: PortRole[];

  defaults: { memoryGb: number; cpuLimit: number; diskGb: number; playersMax: number };
  limits: { memoryGb: [number, number]; cpuLimit: [number, number]; diskGb: [number, number] };
  requirements: GameRequirements;

  /* Where this game keeps the files that have to survive, inside its
     container. Left out means /data, which most images read.

     Not a detail: the node mounts the server's own directory here, and
     an image that keeps its world somewhere else — Valheim's keeps it
     in /config — would write it into the container layer instead. The
     file browser would not see it, no backup would contain it, and a
     rebuild would throw it away. */
  dataPath?: string;

  /* Environment the workload needs from what it was given, rather than
     from any setting: its memory limit and the ports it was allocated.

     A JVM-based game that is not told its heap size picks one of its own
     — Zomboid's launcher asks for 8 GB whatever the container allows —
     and past the container's limit the kernel kills it mid-save. And a
     game that tells clients which second port to use has to be told the
     one it actually got on the node, or the second of two servers on a
     machine sends players to the first one's port. */
  resourceEnv?: {
    /** Set to this percentage of the memory limit, in megabytes: "6144m". */
    memory?: { name: string; percent: number };
    /** A port role's id, and the variable that receives its number on the node. */
    ports?: Record<string, string>;
    /* A variable the image insists on and nobody should need: set to a
       fresh random value, `<prefix>-<32 hex>`, each time a workload is
       made, and stored nowhere. Zomboid's image will not start without an
       admin password and prints it to the console on every start; the
       prefix is what lets the panel blank it out of every console view.
       Operators make their own character an admin from the console. */
    secrets?: Record<string, string>;
  };

  install: InstallStrategy;
  config: ConfigField[];
  health: HealthPolicy;
  console: ConsoleDialect;

  versions: GameVersion[];
  templates: GameTemplate[];

  /** Where this game's versions come from. See versions.ts. */
  versionSources: VersionSourceRef[];
}

/* ── Where versions come from ─────────────────────────────────────
   A provider needs to be told what to look at, and what it needs
   differs — Steam wants an app id, GitHub wants a repository. A union
   rather than a bag of strings, so a definition naming a provider
   without the arguments it needs is a compile error. */
export type VersionSourceRef =
  /** Everything the definition itself ships. Always available. */
  | { provider: "static" }
  /* Steam does not have version numbers; it has branches and build ids.
     `branches` is the ones worth watching — omitted, it watches every
     branch a static version claims. */
  | { provider: "steam"; appId: number; branches?: string[] }
  /** GitHub releases. `match` filters tag names. */
  | { provider: "github"; owner: string; repo: string; match?: string }
  /** Mojang's version manifest. */
  | { provider: "minecraft-launcher"; types?: Array<"release" | "snapshot"> };

/* ── Derived helpers ──────────────────────────────────────────────── */

/** How many consecutive ports one server of this game occupies. */
export function strideOf(game: Pick<GameDefinition, "ports">): number {
  return Math.max(...game.ports.map((p) => p.offset)) + 1;
}

/* Whether anything can usefully be typed at this game's console.

   A game that names no command — no stop, no save, no broadcast, no
   example — reads nothing from its input, and offering a prompt that
   swallows every line is worse than saying so. */
export function acceptsCommands(dialect: ConsoleDialect): boolean {
  return Boolean(
    dialect.stopCommand ||
      dialect.saveCommand ||
      dialect.broadcastCommand ||
      (dialect.examples?.length ?? 0) > 0,
  );
}

/** The concrete ports a base allocation turns into. */
export function portsFor(game: Pick<GameDefinition, "ports">, base: number) {
  return game.ports.map((role) => ({
    id: role.id,
    label: role.label,
    host: base + role.offset,
    container: role.container ?? base + role.offset,
    protocol: role.protocol,
    primary: role.primary === true,
    public: role.public !== false,
    note: role.note,
  }));
}

/* The ports a workload is created with. One function for every path that
   makes one — creation, an update, a settings rebuild — so a port the
   definition marks private is private whichever of them built the
   server: the node publishes it on its loopback interface only. */
export function provisionPorts(game: Pick<GameDefinition, "ports">, base: number) {
  return portsFor(game, base).map((p) => ({
    label: p.label,
    host: p.host,
    container: p.container,
    protocol: p.protocol,
    loopback: !p.public,
  }));
}

/* The environment a workload gets from its resources. See
   `GameDefinition.resourceEnv`. Rendered wherever a workload is made —
   creation, update, rebuild — so a new memory limit reaches the game the
   same way the limit itself does: when the workload is rebuilt. */
export function resourceEnvFor(
  game: Pick<GameDefinition, "ports" | "resourceEnv">,
  given: { memoryMb: number; portBase: number },
  /** 32 hex characters; injected so tests can see what was generated. */
  randomHex: () => string = defaultRandomHex,
): Record<string, string> {
  const env: Record<string, string> = {};
  const spec = game.resourceEnv;
  if (!spec) return env;

  if (spec.memory) {
    env[spec.memory.name] = `${Math.floor((given.memoryMb * spec.memory.percent) / 100)}m`;
  }
  for (const port of portsFor(game, given.portBase)) {
    const name = spec.ports?.[port.id];
    if (name) env[name] = String(port.host);
  }
  for (const [name, prefix] of Object.entries(spec.secrets ?? {})) {
    env[name] = `${prefix}-${randomHex()}`;
  }
  return env;
}

function defaultRandomHex(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* Blanks the generated secrets out of a line of console output.

   Applied wherever console output leaves the panel's server side: the
   console page's backlog and live stream, the server page's tail, and
   the HTTP API's logs route. Anybody who can read a console is not
   thereby somebody who should hold the game's admin password. */
export function redactSecrets(game: Pick<GameDefinition, "resourceEnv"> | undefined, text: string): string {
  const prefixes = Object.values(game?.resourceEnv?.secrets ?? {});
  let out = text;
  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`${escaped}-[0-9a-f]{32}`, "g"), `${prefix}-[redacted]`);
  }
  return out;
}

/** The port players actually connect to. */
export function primaryPort(game: Pick<GameDefinition, "ports">, base: number): number {
  const role = game.ports.find((p) => p.primary) ?? game.ports[0];
  return base + (role?.offset ?? 0);
}

/** How a protocol reads in the UI. */
export function protocolLabel(protocol: Protocol): string {
  return protocol === "both" ? "TCP + UDP" : protocol.toUpperCase();
}
