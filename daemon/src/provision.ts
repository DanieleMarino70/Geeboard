import path from "node:path";
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
  /* Published on the node's loopback interface only. For an
     administrative port — RCON, TShock's REST API — that something on
     the node may need and nobody on the internet should reach. These
     were published on every interface, so a Minecraft server's RCON,
     with only the image's generated password in front of it, was open
     to anyone who could reach the machine. */
  loopback: boolean;
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
  /* Where the server's own directory is mounted inside the container.
     Most images read /data; some do not, and an image that keeps its
     world somewhere else would otherwise write it into the container
     layer — invisible to the file browser, absent from every backup,
     and gone on the next rebuild. */
  dataPath: string;
  /** Mount points kept across workloads and out of every archive — see parseCachePaths. */
  cachePaths: string[];
  /* Arguments for the image's entrypoint. Empty keeps the image's own
     default command. Each is one argv entry, never a shell string. */
  command: string[];
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
const MAX_ARGS = 32;
const MAX_ARG_LENGTH = 512;

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

    // Anything but a real boolean is refused rather than read as public.
    if (port.loopback !== undefined && typeof port.loopback !== "boolean") {
      throw new SpecError("loopback must be true or false");
    }
    const loopback = port.loopback === true;

    /* The same host port twice would be accepted here and then refused
       by Docker halfway through creating the container. */
    for (const p of protocol === "both" ? ["tcp", "udp"] : [protocol]) {
      const key = `${host}/${p}`;
      if (seen.has(key)) throw new SpecError(`port ${host}/${p} is listed twice`);
      seen.add(key);
    }

    return { label, host, container, protocol, loopback };
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

/* Start arguments, as separate argv entries.

   They go to Docker as `Cmd` in exec form, so no shell ever parses them
   and a value with a space or a semicolon in it is one argument, not
   two commands. What is refused is what could still do damage past
   that: a NUL, which truncates an argument wherever it is read, and a
   newline, which a bootstrap script that echoes its arguments into a
   log or a config file would turn into a line of its own. */
function parseCommand(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new SpecError("command must be a list of arguments");
  if (raw.length > MAX_ARGS) throw new SpecError(`no more than ${MAX_ARGS} arguments`);

  return raw.map((arg, i) => {
    if (typeof arg !== "string") throw new SpecError(`argument ${i + 1} must be a string`);
    if (arg.length > MAX_ARG_LENGTH) throw new SpecError(`argument ${i + 1} is too long`);
    if (/[\x00-\x1f\x7f]/.test(arg)) {
      throw new SpecError(`argument ${i + 1} contains a control character`);
    }
    return arg;
  });
}

/* Where the server's directory lands in the container.

   A mount point is not a file path the caller may choose freely: it is
   the one place the container can write that survives, and pointing it
   at the container's own system directories would either fail at
   creation or bury the image's contents under an empty directory. So it
   is an absolute path, at most four segments deep, and never inside the
   directories a Linux system needs to run.

   Five, not two: Zomboid's image keeps its data in /home/steam/Zomboid
   and fixes that directory's ownership on every start, and its Workshop
   downloads land a level deeper still, in
   /home/steam/pz-dedicated/steamapps/workshop — which is a cache mount,
   because a mod is re-downloadable and a world is not. Mounting either
   of them anywhere else works on Docker Desktop and fails on a Linux
   node, where the directory would belong to root and the server runs as
   `steam`. Deep enough for what images actually do, and still shallow
   enough that no system directory is reachable. */
const DATA_PATH = /^(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,5}$/;
const SYSTEM_ROOTS = new Set(["bin", "boot", "dev", "etc", "lib", "lib64", "proc", "sbin", "sys", "usr"]);

/* Where a server's cache directories live on the node: beside its data
   and its archives, never inside either. One per mount point, named for
   it, so "/opt/valheim" is `.cache/<serverId>/opt-valheim`. */
export function cacheRoot(dataRoot: string, serverId: string): string {
  const server = rootFor(dataRoot, serverId);
  return path.resolve(path.dirname(server), ".cache", path.basename(server));
}

export function cacheDirFor(dataRoot: string, serverId: string, mountPoint: string): string {
  return path.join(cacheRoot(dataRoot, serverId), mountPoint.replace(/^\//, "").replace(/\//g, "-"));
}

/* Cache mounts: what an image downloads for itself and would otherwise
   download again for every new workload.

   Valheim's image installs 2.2 GB of game into /opt/valheim on first
   start. Only the server's own directory used to be mounted, so that
   went into the container layer, and every rebuild — which for Valheim
   is every settings change — fetched it again: four minutes, measured.
   Mounting the server's directory there instead would put the game in
   every backup.

   So a second kind of mount, with the opposite promises from the first:
   it is not the world, it is not in any archive, the file browser does
   not show it, and losing it costs a download and nothing else. It
   outlives a workload and goes with the server. Few and narrow on
   purpose — two at most, the same rules as the data mount, and never the
   data mount's own path or one inside another. */
const MAX_CACHE_PATHS = 2;

function parseCachePaths(value: unknown, dataPath: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SpecError("cachePaths must be a list");
  if (value.length > MAX_CACHE_PATHS) throw new SpecError(`no more than ${MAX_CACHE_PATHS} cache mounts`);

  const paths = value.map((entry) => parseDataPath(entry));
  const all = [dataPath, ...paths];
  for (let i = 0; i < all.length; i++) {
    for (let j = 0; j < all.length; j++) {
      if (i !== j && (all[i] === all[j] || all[i]!.startsWith(`${all[j]}/`))) {
        throw new SpecError(`${all[i]} overlaps another mount point`);
      }
    }
  }
  return paths;
}

function parseDataPath(value: unknown): string {
  if (value === undefined || value === null) return "/data";
  if (typeof value !== "string") throw new SpecError("dataPath must be a string");
  const path = value.trim();
  if (!DATA_PATH.test(path) || path.includes("..")) throw new SpecError("that is not a valid mount point");
  const root = path.split("/")[1]!;
  if (SYSTEM_ROOTS.has(root) || path === "/var" || path === "/root") {
    throw new SpecError(`${path} cannot be used as a mount point`);
  }
  return path;
}

/** Turns a request body into a spec, or refuses it. Throws SpecError. */
/* An image reference a request may name, or a refusal. The one rule for
   a create and for a pull, which is the same image asked for twice. */
export function imageReference(value: unknown): string {
  const image = typeof value === "string" ? value : "";
  if (image.length === 0 || image.length > 255 || image.includes("..") || !IMAGE.test(image)) {
    throw new SpecError("that is not a valid image reference");
  }
  return image;
}

export function parseCreate(body: Record<string, unknown>): CreateSpec {
  const serverId = str(body, "serverId");
  // Same rule as the file API: this becomes a path segment on the node.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(serverId)) throw new SpecError("invalid server id");

  const name = str(body, "name");
  if (!NAME.test(name)) {
    throw new SpecError("name must be lowercase letters, digits and dashes");
  }

  const image = imageReference(str(body, "image"));

  return {
    serverId,
    name,
    image,
    ports: parsePorts(body.ports),
    memoryMb: int(body, "memoryMb", MIN_MEMORY_MB, MAX_MEMORY_MB),
    cpuLimit: int(body, "cpuLimit", MIN_CPU_PCT, MAX_CPU_PCT),
    env: parseEnv(body.env),
    dataPath: parseDataPath(body.dataPath),
    cachePaths: parseCachePaths(body.cachePaths, parseDataPath(body.dataPath)),
    command: parseCommand(body.command),
    start: body.start !== false,
  };
}

/* The name the container carries on the node: a prefix and the server's
   slug. The prefix is one per agent, so two agents sharing one Docker
   engine — a second node on a development PC — do not fight over
   `geeboard-<slug>` when a server moves from one to the other. */
export const DEFAULT_CONTAINER_PREFIX = "geeboard-";

export function containerName(name: string, prefix = DEFAULT_CONTAINER_PREFIX): string {
  return `${prefix}${name}`;
}

export interface EngineSettings {
  managedLabel: string;
  dataRoot: string;
  containerPrefix?: string;
}

/* The whole container definition in one place, so what a Geeboard
   server actually is can be read in one screen. */
export function containerOptions(
  spec: CreateSpec,
  { managedLabel, dataRoot, containerPrefix }: EngineSettings,
): Docker.ContainerCreateOptions {
  const exposed: Record<string, Record<string, never>> = {};
  const bindings: Record<string, Array<{ HostPort: string; HostIp?: string }>> = {};

  for (const port of spec.ports) {
    for (const protocol of port.protocol === "both" ? ["tcp", "udp"] : [port.protocol]) {
      exposed[`${port.container}/${protocol}`] = {};
      bindings[`${port.container}/${protocol}`] = [
        { HostPort: String(port.host), ...(port.loopback ? { HostIp: "127.0.0.1" } : {}) },
      ];
    }
  }

  return {
    name: containerName(spec.name, containerPrefix),
    Image: spec.image,
    /* The label is both the filter that makes this container visible to
       the daemon and the record of which server it belongs to, so a
       container found on the node can always be traced back to one. */
    Labels: { [managedLabel]: spec.serverId },
    Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
    /* Given to the image's entrypoint as its arguments. Left out when
       empty, because an empty Cmd replaces the image's default command
       with nothing rather than keeping it. */
    ...(spec.command.length > 0 ? { Cmd: spec.command } : {}),

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
      /* The server's own directory, its cache directories if the game
         asked for any, and nothing else from the node. */
      Binds: [
        `${rootFor(dataRoot, spec.serverId)}:${spec.dataPath}`,
        ...spec.cachePaths.map((mountPoint) => `${cacheDirFor(dataRoot, spec.serverId, mountPoint)}:${mountPoint}`),
      ],

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

      /* Docker lets root in a container make a device node by default. A game has no use for one, and one made in its own folder is a file the
         agent later opens as root for a backup or a listing: an open on a device can block for ever or read the node's own disk. The audit of
         0.9.5 found the folder trusted to hold only files; this is the half of the answer that does not depend on every reader being careful. */
      CapDrop: ["MKNOD"],

      /* An unbounded log file fills the node's disk on a server that
         logs a stack trace every tick. The console only ever reads the
         tail of it anyway. */
      LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "3" } },
    },
  };
}
