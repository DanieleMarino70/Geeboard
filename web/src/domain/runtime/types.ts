import type { Protocol } from "../games/types";

/* The runtime abstraction.

   A game server has to run as *something* on a node, and today that
   something is a Docker container. It should not follow that the word
   "container" appears in the domain, the API or the UI — the day a node
   runs Podman or a bare process, the only thing that should need writing
   is another implementation of this interface.

   Everything here is phrased in terms of a game server on a node. The
   Docker vocabulary stops at DockerRuntime, and the Docker API itself
   never leaves the node agent. */

export type RuntimeKind = "DOCKER";

/** What the runtime says about a workload, before the domain interprets it. */
export type RuntimeState = "running" | "starting" | "stopping" | "stopped" | "crashed" | "unknown";

/* How a game server is addressed on its node.

   Both halves are needed. `serverId` is the panel's id, which is what
   names the server's data directory and survives a container being
   destroyed and remade; `runtimeId` is whatever the runtime calls the
   thing it is currently running, and is null until one exists. */
export interface RuntimeRef {
  serverId: string;
  runtimeId: string | null;
}

export interface RuntimeStatus {
  /** The runtime's own identifier for the workload. */
  id: string;
  name: string;
  state: RuntimeState;
  exitCode: number | null;
  startedAt: string | null;
  /** What is being run — an image reference today. */
  source: string;
}

export interface RuntimeSample {
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  memPct: number;
  rxBytes: number;
  txBytes: number;
}

export interface RuntimeLogLine {
  line: string;
  stderr: boolean;
}

export interface RuntimeFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedAt: string;
  mode: string;
}

/** What the runtime needs in order to bring a game server into being. */
export interface ProvisionPlan {
  serverId: string;
  /** Slug-shaped; becomes the workload's name on the node. */
  name: string;
  /** The image, archive or binary the runtime should run. */
  source: string;
  ports: Array<{ label: string; host: number; container: number; protocol: Protocol }>;
  memoryMb: number;
  /** Percent of one core. 300 is three cores. */
  cpuLimit: number;
  env: Record<string, string>;
  /** Start it as part of provisioning, so a half-made server never lingers. */
  start: boolean;
}

/** File access inside one game server's own directory. */
export interface RuntimeFiles {
  list(ref: RuntimeRef, at: string): Promise<{ path: string; entries: RuntimeFileEntry[] }>;
  read(ref: RuntimeRef, at: string): Promise<{ content: string; sizeBytes: number; truncated: boolean }>;
  write(ref: RuntimeRef, at: string, content: string): Promise<RuntimeFileEntry>;
  makeDirectory(ref: RuntimeRef, at: string): Promise<void>;
  remove(ref: RuntimeRef, at: string): Promise<void>;
  move(ref: RuntimeRef, from: string, to: string): Promise<void>;
}

export interface RuntimeDescription {
  node: string;
  kind: RuntimeKind;
  /** The engine's own version string, for the node detail page. */
  engine: string;
  os?: string;
  arch?: string;
}

export interface IGameRuntime {
  readonly kind: RuntimeKind;
  /** The node this runtime drives. Used in messages, never for routing. */
  readonly nodeName: string;

  /** Is the node's runtime answering at all? */
  ping(): Promise<void>;
  describe(): Promise<RuntimeDescription>;

  provision(plan: ProvisionPlan): Promise<RuntimeStatus>;
  /** Removes the server's footprint. `withData` is the irreversible half. */
  destroy(ref: RuntimeRef, withData: boolean): Promise<{ workload: boolean; data: boolean }>;

  start(ref: RuntimeRef): Promise<RuntimeStatus>;
  stop(ref: RuntimeRef, graceSeconds?: number): Promise<RuntimeStatus>;
  restart(ref: RuntimeRef, graceSeconds?: number): Promise<RuntimeStatus>;
  status(ref: RuntimeRef): Promise<RuntimeStatus>;

  sample(ref: RuntimeRef): Promise<RuntimeSample>;
  logs(ref: RuntimeRef, tail?: number): Promise<RuntimeLogLine[]>;

  /** One line to the game's console. Not a shell. */
  sendCommand(ref: RuntimeRef, command: string): Promise<void>;
  /** The upstream console stream, for the panel to proxy. Never reaches a browser. */
  consoleUrl(ref: RuntimeRef): string;

  readonly files: RuntimeFiles;
}
