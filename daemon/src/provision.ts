import type Docker from "dockerode";
import { rootFor } from "./files.ts";

/* Bringing a container into being, and taking one away.

   The rest of the daemon drives containers that already exist. This is
   the one module that creates them, so it is the one that has to be
   unforgiving: every field of a create request becomes part of a real
   container on somebody's machine, and a destroy force-removes
   something that may hold a world nobody backed up.

   Nothing here talks to Docker. It builds the arguments and refuses the
   bad ones, which is the part worth testing without a daemon running. */

export class SpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecError";
  }
}

/** Raised when an id resolves to a container this daemon does not own. */
export class NotManagedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotManagedError";
  }
}

export type Protocol = "tcp" | "udp" | "both";

export interface PortSpec {
  /** Shown in the panel — "Game", "Query", "RCON". */
  label: string;
  /** The port published on the node. */
  host: number;
  /** The port inside the container; usually the same. */
  container: number;
  protocol: Protocol;
}

export interface CreateSpec {
  serverId: string;
  /** Becomes the container name, prefixed. Lowercase, slug-shaped. */
  name: string;
  image: string;
  ports: PortSpec[];
  memoryMb: number;
  /** Percent of one core. 300 is three cores. */
  cpuLimit: number;
  env: Record<string, string>;
  /** Start it as part of creation, so a half-made server never lingers. */
  start: boolean;
}

/* Ceilings, not opinions. Each one is the point past which the request
   is either impossible or dangerous to the node. */
const MIN_MEMORY_MB = 128;
const MAX_MEMORY_MB = 256 * 1024;
const MIN_CPU_PCT = 10;
const MAX_CPU_PCT = 3200;
const MAX_PORTS = 8;
const MAX_ENV = 64;
const MAX_ENV_VALUE = 4096;

/* Ports below 1024 need a privilege the daemon should not be running
   with, and binding one would fail later with a far worse message. */
const MIN_HOST_PORT = 1024;

/* A Docker reference, and nothing that could be mistaken for something
   else. No leading dash — anything that later shells out would read it
   as a flag — and no traversal in the repository part. */
const IMAGE =
  /^[a-z0-9][a-z0-9._-]*(?::[0-9]+)?(?:\/[a-z0-9][a-z0-9._-]*)*(?::[A-Za-z0-9._-]{1,128})?(?:@sha256:[a-f0-9]{64})?$/;

/* The container name a human reads in `docker ps`. Docker allows more
   than this, but a slug keeps the list legible and keeps our containers
   obviously ours. */
const NAME = /^[a-z0-9][a-z0-9-]{0,38}$/;

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SpecError(`${key} is required`);
  }
  return value;
}

function int(body: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SpecError(`${key} must be a whole number`);
  }
  if (value < min || value > max) {
    throw new SpecError(`${key} must be between ${min} and ${max}`);
  }
  return value;
}

function parsePorts(raw: unknown): PortSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new SpecError("at least one port is required");
  if (raw.length > MAX_PORTS) throw new SpecError(`no more than ${MAX_PORTS} ports`);

  const seen = new Set<string>();
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new SpecError("each port must be an object");
    }
    const port = entry as Record<string, unknown>;

    const label = typeof port.label === "string" ? port.label.trim() : "";
    if (!label || label.length > 24) throw new SpecError("each port needs a label");

    const host = int(port, "host", MIN_HOST_PORT, 65535);
    const container = port.container === undefined ? host : int(port, "container", 1, 65535);

    const protocol = port.protocol ?? "tcp";
    if (protocol !== "tcp" && protocol !== "udp" && protocol !== "both") {
      throw new SpecError("protocol must be tcp, udp or both");
    }

    /* The same host port twice would be accepted here and then refused
       by Docker halfway through creating the container. */
    for (const p of protocol === "both" ? ["tcp", "udp"] : [protocol]) {
      const key = `${host}/${p}`;
      if (seen.has(key)) throw new SpecError(`port ${host}/${p} is listed twice`);
      seen.add(key);
    }

    return { label, host, container, protocol };
  });
}

function parseEnv(raw: unknown): Record<string, string> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new SpecError("env must be an object");

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_ENV) throw new SpecError(`no more than ${MAX_ENV} environment variables`);

  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!ENV_KEY.test(key)) throw new SpecError(`${key} is not a valid environment variable name`);
    if (typeof value !== "string") throw new SpecError(`${key} must be a string`);
    if (value.length > MAX_ENV_VALUE) throw new SpecError(`${key} is too long`);
    // A NUL would truncate the variable wherever it is finally read.
    if (value.includes("\0")) throw new SpecError(`${key} contains a null byte`);
    out[key] = value;
  }
  return out;
}

/** Turns a request body into a spec, or refuses it. Throws SpecError. */
export function parseCreate(body: Record<string, unknown>): CreateSpec {
  const serverId = str(body, "serverId");
  // Same rule as the file API: this becomes a path segment on the node.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(serverId)) throw new SpecError("invalid server id");

  const name = str(body, "name");
  if (!NAME.test(name)) {
    throw new SpecError("name must be lowercase letters, digits and dashes");
  }

  const image = str(body, "image");
  if (image.length > 255 || image.includes("..") || !IMAGE.test(image)) {
    throw new SpecError("that is not a valid image reference");
  }

  return {
    serverId,
    name,
    image,
    ports: parsePorts(body.ports),
    memoryMb: int(body, "memoryMb", MIN_MEMORY_MB, MAX_MEMORY_MB),
    cpuLimit: int(body, "cpuLimit", MIN_CPU_PCT, MAX_CPU_PCT),
    env: parseEnv(body.env),
    start: body.start !== false,
  };
}

/** The name the container carries on the node. */
export function containerName(name: string): string {
  return `geeboard-${name}`;
}

export interface EngineSettings {
  managedLabel: string;
  dataRoot: string;
}

/* The whole container definition in one place, so what a Geeboard
   server actually is can be read in one screen. */
export function containerOptions(
  spec: CreateSpec,
  { managedLabel, dataRoot }: EngineSettings,
): Docker.ContainerCreateOptions {
  const exposed: Record<string, Record<string, never>> = {};
  const bindings: Record<string, Array<{ HostPort: string }>> = {};

  for (const port of spec.ports) {
    for (const protocol of port.protocol === "both" ? ["tcp", "udp"] : [port.protocol]) {
      exposed[`${port.container}/${protocol}`] = {};
      bindings[`${port.container}/${protocol}`] = [{ HostPort: String(port.host) }];
    }
  }

  return {
    name: containerName(spec.name),
    Image: spec.image,
    /* The label is both the filter that makes this container visible to
       the daemon and the record of which server it belongs to, so a
       container found on the node can always be traced back to one. */
    Labels: { [managedLabel]: spec.serverId },
    Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),

    /* Both of these are load-bearing for the console. Stdin stays open
       because a game server reads its commands from it, and there is no
       TTY because that is what keeps Docker multiplexing stdout and
       stderr into the frames demultiplex() can tell apart. */
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,

    ExposedPorts: exposed,
    HostConfig: {
      PortBindings: bindings,
      // The server's own directory, and nothing else from the node.
      Binds: [`${rootFor(dataRoot, spec.serverId)}:/data`],

      Memory: spec.memoryMb * 1024 * 1024,
      /* Without this the memory limit is advisory: the container would
         swap past its ceiling instead of being held at it. */
      MemorySwap: spec.memoryMb * 1024 * 1024,
      NanoCpus: Math.round((spec.cpuLimit / 100) * 1e9),

      /* Deliberately not "unless-stopped". A crash has to stay crashed
         until something looks at it — Docker restarting the container
         behind the panel's back is precisely the drift the poller
         exists to catch, and restart-after-crash is a policy the panel
         applies, where it can be audited. */
      RestartPolicy: { Name: "no" },

      // A runaway modpack should exhaust its own limit, not the node's.
      PidsLimit: 512,

      /* An unbounded log file fills the node's disk on a server that
         logs a stack trace every tick. The console only ever reads the
         tail of it anyway. */
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
    },
  };
}
