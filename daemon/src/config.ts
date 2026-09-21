import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { agentFilePath, readAgentFile, type AgentFile } from "./agent-file.ts";

/* Configuration comes from the environment, and from the file `npm run
   join` writes (see agent-file.ts). A node agent runs on someone else's
   machine; it never carries a checked-in default for anything that
   grants access.

   An environment that names both the token and the node is a complete
   configuration by itself, and the file is not read at all — which is
   how the verify scripts, and a machine set up before join existed,
   keep working exactly as they did. Otherwise the file supplies what it
   has and any variable that is set overrides its value. */

export interface Config {
  port: number;
  host: string;
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
  /** How long an image pull may take before a create gives up. */
  pullTimeoutMs: number;

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
function agentVersion(): string {
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
    port: Number(env.GEEBOARD_DAEMON_PORT ?? joined?.port ?? 8080),
    host: env.GEEBOARD_DAEMON_HOST ?? "0.0.0.0",
    token,
    // Only alongside the token it was saved with; an environment token has no history.
    previousToken: env.GEEBOARD_DAEMON_TOKEN ? undefined : joined?.previousToken,
    tokenFromEnvironment: Boolean(env.GEEBOARD_DAEMON_TOKEN),
    nodeName,
    sampleIntervalMs: Number(env.GEEBOARD_SAMPLE_MS ?? 15_000),
    managedLabel: env.GEEBOARD_MANAGED_LABEL ?? "gg.geeboard.server",
    containerPrefix: env.GEEBOARD_CONTAINER_PREFIX ?? "geeboard-",
    dataRoot: env.GEEBOARD_DATA_ROOT ?? joined?.dataRoot ?? defaultDataRoot(env),
    pullTimeoutMs: Number(env.GEEBOARD_PULL_TIMEOUT_MS ?? 120_000),

    panelUrl,
    registrationToken: env.GEEBOARD_REGISTRATION_TOKEN ?? null,
    advertiseUrl,
    capabilities: declared.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0),
    version: env.GEEBOARD_VERSION ?? agentVersion(),
    agentFile: joined ? file : null,
  };
}
