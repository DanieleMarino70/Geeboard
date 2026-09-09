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
}

export function loadConfig(): Config {
  const token = required("GEEBOARD_DAEMON_TOKEN");
  if (token.length < 32) {
    throw new Error("GEEBOARD_DAEMON_TOKEN must be at least 32 characters.");
  }

  return {
    port: Number(process.env.GEEBOARD_DAEMON_PORT ?? 8080),
    host: process.env.GEEBOARD_DAEMON_HOST ?? "0.0.0.0",
    token,
    nodeName: required("GEEBOARD_NODE_NAME"),
    sampleIntervalMs: Number(process.env.GEEBOARD_SAMPLE_MS ?? 15_000),
    managedLabel: process.env.GEEBOARD_MANAGED_LABEL ?? "gg.geeboard.server",
    dataRoot: process.env.GEEBOARD_DATA_ROOT ?? "/var/lib/geeboard/servers",
  };
}
