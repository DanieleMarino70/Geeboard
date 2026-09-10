import process from "node:process";

/* Configuration comes from the environment only. A node agent runs on
   someone else's machine; it should never carry a checked-in default
   for anything that grants access. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. See daemon/README.md — the agent refuses to start without it.`,
    );
  }
  return value;
}

export interface Config {
  port: number;
  host: string;
  /** Shared secret the panel presents on every request. */
  token: string;
  /** Identifies this node in the panel, e.g. fra-node-02. */
  nodeName: string;
  /** How often container stats are sampled, in milliseconds. */
  sampleIntervalMs: number;
  /** Only containers carrying this label are considered ours. */
  managedLabel: string;
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
  /** Where the panel can reach *this* node. It cannot guess. */
  advertiseUrl: string | null;
  /* Capabilities this node is willing to run, beyond what can be
     measured. Games run in containers, so whether the machine has
     SteamCMD installed says nothing — this is a policy, and it belongs
     somewhere a person signed their name to it. */
  capabilities: string[];
  /** Reported to the panel so an operator can see what is deployed. */
  version: string;
}

export function loadConfig(): Config {
  const token = required("GEEBOARD_DAEMON_TOKEN");
  if (token.length < 32) {
    throw new Error("GEEBOARD_DAEMON_TOKEN must be at least 32 characters.");
  }

  const panelUrl = process.env.GEEBOARD_PANEL_URL ?? null;
  const advertiseUrl = process.env.GEEBOARD_ADVERTISE_URL ?? null;

  /* Registering without telling the panel where to find this node would
     produce a node the panel can see and cannot reach — worse than not
     registering at all, because it looks like it worked. */
  if (process.env.GEEBOARD_REGISTRATION_TOKEN && !advertiseUrl) {
    throw new Error(
      "GEEBOARD_ADVERTISE_URL must be set to register: the panel cannot guess how to reach this node.",
    );
  }

  return {
    port: Number(process.env.GEEBOARD_DAEMON_PORT ?? 8080),
    host: process.env.GEEBOARD_DAEMON_HOST ?? "0.0.0.0",
    token,
    nodeName: required("GEEBOARD_NODE_NAME"),
    sampleIntervalMs: Number(process.env.GEEBOARD_SAMPLE_MS ?? 15_000),
    managedLabel: process.env.GEEBOARD_MANAGED_LABEL ?? "gg.geeboard.server",
    dataRoot: process.env.GEEBOARD_DATA_ROOT ?? "/var/lib/geeboard/servers",
    pullTimeoutMs: Number(process.env.GEEBOARD_PULL_TIMEOUT_MS ?? 120_000),

    panelUrl,
    registrationToken: process.env.GEEBOARD_REGISTRATION_TOKEN ?? null,
    advertiseUrl,
    capabilities: (process.env.GEEBOARD_CAPABILITIES ?? "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c.length > 0),
    version: process.env.GEEBOARD_VERSION ?? "0.1.0",
  };
}
