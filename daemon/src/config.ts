import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { agentFilePath, readAgentFile, type AgentFile } from "./agent-file.ts";
import { DEFAULT_POLICY } from "./terminal.ts";

/* Configuration comes from the environment, and from the file `npm run
   join` writes (see agent-file.ts). A node agent runs on someone else's
   machine; it never carries a checked-in default for anything that
   grants access.

   An environment that names both the token and the node is a complete
   configuration by itself, and the file is not read at all — which is
   how the verify scripts, and a machine set up before join existed,
   keep working exactly as they did. Otherwise the file supplies what it
   has and any variable that is set overrides its value. */

/* `::` is every address of both families on a machine that has IPv6, and, as Node binds it, IPv4 too. It was `0.0.0.0`, which
   is IPv4 only, while `join` advertises an IPv6 address when that is what the machine has: a panel that could only reach
   this machine over IPv6 was given an address nothing answered at, and was told to open the port in a firewall. A machine
   without IPv6 cannot bind it, and falls back to `0.0.0.0` (index.ts). */
export const DEFAULT_HOST = "::";

/* Whether a listener that failed with `code` should be tried again on IPv4. Only the default address, and only for the two
   codes a machine without IPv6 gives; an address somebody chose is theirs. */
export function fallsBackToIPv4(host: string, explicit: boolean | undefined, code: string | undefined): boolean {
  return host === DEFAULT_HOST && !explicit && (code === "EAFNOSUPPORT" || code === "EADDRNOTAVAIL");
}

export interface Config {
  port: number;
  /** Where it listens. `::` unless GEEBOARD_DAEMON_HOST says otherwise: every address, IPv6 and IPv4 both. */
  host: string;
  /** GEEBOARD_DAEMON_HOST was set, so the address is not the default's to fall back from. */
  hostExplicit?: boolean;
  /** Shared secret the panel presents on every request. Changed in place by a rotation. */
  token: string;
  /** Still accepted, until the panel confirms a rotation — see rotate.ts. */
  previousToken?: string;
  /** Set by GEEBOARD_DAEMON_TOKEN, so it cannot be rotated from the panel. */
  tokenFromEnvironment: boolean;
  /** Identifies this node in the panel, e.g. fra-node-02. */
  nodeName: string;
  /** How often container stats are sampled, in milliseconds. */
  sampleIntervalMs: number;
  /** Only containers carrying this label are considered ours. */
  managedLabel: string;
  /* What a server's container is called on this node, before its slug.
     "geeboard-" unless told; a second agent sharing this machine's Docker
     engine needs its own, or a server moving between the two would find
     its name already taken. */
  containerPrefix: string;
  /** Each server owns a directory under here. */
  dataRoot: string;
  /* How long a pull may go without moving before it is called stalled.
     Not how long it may take: a slow line is not a broken one, and a
     ten-gigabyte image on an ordinary connection takes a while. */
  pullStallMs: number;
  /* GEEBOARD_PULL_TIMEOUT_MS was set. It bounded a whole pull, which is
     what failed every first create of a large image, and it is read no
     more — said at start-up rather than ignored in silence. */
  retiredPullTimeout: boolean;

  /* ── Talking to the panel ───────────────────────────────────────
     All optional. Without a panel URL the agent behaves exactly as it
     always has: it answers, and something else attached it. */

  /** Where the panel is, for registering and heartbeats. */
  panelUrl: string | null;
  /** A single-use token from the panel. Only needed the first time. */
  registrationToken: string | null;
  /** Where the panel can reach *this* node. */
  advertiseUrl: string | null;
  /* Capabilities this node is willing to run, beyond what can be
     measured. Games run in containers, so whether the machine has
     SteamCMD installed says nothing — this is a policy, and it belongs
     somewhere a person signed their name to it. */
  capabilities: string[];
  /** Reported to the panel so an operator can see what is deployed. */
  version: string;
  /** The joined-settings file this came from, when it came from one. */
  agentFile: string | null;

  /* ── The node terminal ──────────────────────────────────────────
     A shell of this machine, opened from the panel — see terminal.ts.
     Off unless GEEBOARD_TERMINAL says otherwise or join was run with
     --terminal: the consent is given on the machine, never from the
     panel, because it is this machine's account that the shell runs as. */

  terminal: boolean;
  /** GEEBOARD_TERMINAL_SHELL: the program, when not the platform's own. */
  terminalShell: string | null;
  terminalLimits: { maxSessions: number; idleMs: number; maxMs: number };
}

/* A number from the environment. A typo is a sentence at start-up, not a
   NaN that makes every comparison false somewhere deep inside: a pull that
   is "stalled" within five seconds, a terminal "idle" the moment it opens. */
function numberFrom(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}; it is "${raw}".`);
  }
  return value;
}

/** How a yes is spelled in an environment variable. Anything else is a no. */
function isOn(value: string): boolean {
  return /^(1|true|on|yes)$/i.test(value.trim());
}

/* Where servers live when nobody said. A Unix path on Windows would land
   in C:\var\lib; ProgramData is where a machine-wide service keeps its
   data, and Docker Desktop can mount it. */
export function defaultDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return path.win32.join(env.ProgramData ?? "C:\\ProgramData", "Geeboard", "servers");
  }
  return "/var/lib/geeboard/servers";
}

/* What release this agent is, from package.json and nowhere else.

   It used to be a literal here, which meant two files had to be changed
   together and only one of them ever was. The panel reads this number to
   decide whether the two halves are on the same release line
   (web/src/domain/nodes/agent-version.ts), so a stale literal is not a
   cosmetic mistake — it is a node the panel would trust wrongly.

   Read once, when the module loads. A version that cannot be read is
   "unknown", which the panel treats as not told rather than as wrong. */
export function agentVersion(): string {
  try {
    const { version } = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (file: string) => AgentFile | null = readAgentFile,
): Config {
  const complete = Boolean(env.GEEBOARD_DAEMON_TOKEN && env.GEEBOARD_NODE_NAME);
  const file = complete ? null : agentFilePath(env);
  const joined = file ? readFile(file) : null;

  const token = env.GEEBOARD_DAEMON_TOKEN ?? joined?.token;
  const nodeName = env.GEEBOARD_NODE_NAME ?? joined?.nodeName;
  if (!token || !nodeName) {
    throw new Error(
      "This machine has not joined a panel. In the panel, Nodes → Add a node gives the command " +
        "(npm run join -- <panel address> <token>). See daemon/README.md for configuring it by hand.",
    );
  }
  if (token.length < 32) {
    throw new Error("GEEBOARD_DAEMON_TOKEN must be at least 32 characters.");
  }

  const panelUrl = env.GEEBOARD_PANEL_URL ?? joined?.panelUrl ?? null;
  const advertiseUrl = env.GEEBOARD_ADVERTISE_URL ?? joined?.advertiseUrl ?? null;

  /* Registering without telling the panel where to find this node would
     produce a node the panel can see and cannot reach — worse than not
     registering at all, because it looks like it worked. */
  if (env.GEEBOARD_REGISTRATION_TOKEN && !advertiseUrl) {
    throw new Error(
      "GEEBOARD_ADVERTISE_URL must be set to register: the panel cannot guess how to reach this node.",
    );
  }

  const declared = env.GEEBOARD_CAPABILITIES
    ? env.GEEBOARD_CAPABILITIES.split(",")
    : (joined?.capabilities ?? []);

  return {
    port: numberFrom(env, "GEEBOARD_DAEMON_PORT", joined?.port ?? 8080, 1, 65_535),
    host: env.GEEBOARD_DAEMON_HOST ?? DEFAULT_HOST,
    hostExplicit: env.GEEBOARD_DAEMON_HOST !== undefined,
    token,
    // Only alongside the token it was saved with; an environment token has no history.
    previousToken: env.GEEBOARD_DAEMON_TOKEN ? undefined : joined?.previousToken,
    tokenFromEnvironment: Boolean(env.GEEBOARD_DAEMON_TOKEN),
    nodeName,
    sampleIntervalMs: numberFrom(env, "GEEBOARD_SAMPLE_MS", 15_000, 100),
    managedLabel: env.GEEBOARD_MANAGED_LABEL ?? "gg.geeboard.server",
    containerPrefix: env.GEEBOARD_CONTAINER_PREFIX ?? "geeboard-",
    dataRoot: env.GEEBOARD_DATA_ROOT ?? joined?.dataRoot ?? defaultDataRoot(env),
    pullStallMs: numberFrom(env, "GEEBOARD_PULL_STALL_MS", 120_000, 1_000),
    retiredPullTimeout: env.GEEBOARD_PULL_TIMEOUT_MS !== undefined,

    panelUrl,
    registrationToken: env.GEEBOARD_REGISTRATION_TOKEN ?? null,
    advertiseUrl,
    capabilities: declared.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0),
    version: env.GEEBOARD_VERSION ?? agentVersion(),
    agentFile: joined ? file : null,

    terminal: env.GEEBOARD_TERMINAL !== undefined ? isOn(env.GEEBOARD_TERMINAL) : (joined?.terminal ?? false),
    terminalShell: env.GEEBOARD_TERMINAL_SHELL || null,
    terminalLimits: {
      maxSessions: numberFrom(env, "GEEBOARD_TERMINAL_SESSIONS", DEFAULT_POLICY.maxSessions, 1, 64),
      idleMs: numberFrom(env, "GEEBOARD_TERMINAL_IDLE_MS", DEFAULT_POLICY.idleMs, 1_000),
      maxMs: numberFrom(env, "GEEBOARD_TERMINAL_MAX_MS", DEFAULT_POLICY.maxMs, 1_000),
    },
  };
}
