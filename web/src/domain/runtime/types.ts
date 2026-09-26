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
  /* Killed for exceeding its memory limit. Distinct from any exit code,
     and the one cause where restarting is actively the wrong answer. */
  oomKilled: boolean;
  startedAt: string | null;
  /** What is being run — an image reference today. */
  source: string;
}

export interface RuntimeExchange {
  /** The port on the node, as allocated to the server. */
  port: number;
  transport: "tcp" | "udp";
  payload: Uint8Array;
  maxBytes: number;
  timeoutMs: number;
}

export interface RuntimeExchangeReply {
  reply: Uint8Array;
  /** Why the node stopped reading: quiet, closed, full, timeout, refused, error. */
  ended: string;
}

export interface RuntimeSample {
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  memPct: number;
  rxBytes: number;
  txBytes: number;
  /* False when the runtime had nothing to measure yet — a workload read
     in its first moments. Absent, from an agent that predates it, means
     measured. */
  measured?: boolean;
}

export interface RuntimeLogLine {
  line: string;
  stderr: boolean;
  /** ISO time the runtime recorded the line; present on a read with `since`. */
  at?: string;
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
  /** `loopback` ports are reachable from the node itself and nowhere else. */
  ports: Array<{ label: string; host: number; container: number; protocol: Protocol; loopback: boolean }>;
  memoryMb: number;
  /** Percent of one core. 300 is three cores. */
  cpuLimit: number;
  env: Record<string, string>;
  /** Where the server's directory is mounted inside the workload. Default /data. */
  dataPath?: string;
  /** Where the source keeps what it fetches for itself: kept across workloads, never archived. */
  cachePaths?: string[];
  /* Arguments the game's process starts with — a version's own and any
     setting whose target is a command-line flag. Empty keeps whatever
     the source starts with by default. */
  args: string[];
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
  /* A file's bytes, as streams: for a program moving a plugin or a map,
     where `read` and `write` are for a person editing text. Capped by the
     runtime, and confined to the server's directory like the rest. */
  readRaw(ref: RuntimeRef, at: string): Promise<{ body: ReadableStream<Uint8Array>; sizeBytes: number }>;
  /** `expectedBytes`, when known, is refused unless it is exactly what arrives. */
  writeRaw(ref: RuntimeRef, at: string, body: ReadableStream<Uint8Array>, expectedBytes?: number): Promise<RuntimeFileEntry>;
}

/** What a stored archive looks like from the panel's side. */
export interface RuntimeArchive {
  /** Opaque: what the node calls this archive. */
  artifact: string;
  sizeBytes: number;
  checksum: string;
  durationMs: number;
}

export interface RuntimeBackups {
  create(ref: RuntimeRef, name: string): Promise<RuntimeArchive>;
  list(ref: RuntimeRef): Promise<Array<{ artifact: string; sizeBytes: number; createdAt: string }>>;
  remove(ref: RuntimeRef, artifact: string): Promise<void>;
  /** What the archive hashes to now, read back from where it lies. */
  verify(ref: RuntimeRef, artifact: string): Promise<{ checksum: string; sizeBytes: number }>;
  /** Replaces the server's directory. The caller stops the server first. */
  restore(ref: RuntimeRef, artifact: string, checksum?: string): Promise<{ files: number }>;
  /* Off-site copies. The node is handed a URL the panel signed — one
     PUT or one GET of one object, for minutes — and moves the bytes
     itself; it never holds the store's credentials. */
  upload(ref: RuntimeRef, artifact: string, url: string): Promise<{ sizeBytes: number; etag: string | null; durationMs: number }>;
  download(
    ref: RuntimeRef,
    artifact: string,
    url: string,
    checksum?: string,
  ): Promise<{ sizeBytes: number; checksum: string; durationMs: number }>;
}

export interface RuntimeDescription {
  node: string;
  kind: RuntimeKind;
  /** The engine's own version string, for the node detail page. */
  engine: string;
  os?: string;
  arch?: string;
}

/* How far a node has got fetching what a workload runs from — an image
   pull, for Docker — in what the node counted and nothing it did not.
   The layers are known at once; the total size only once every layer has
   begun, which is what `totalKnown` says. */
export interface RuntimeDownload {
  phase: "starting" | "downloading" | "unpacking" | "done";
  layers: { total: number; downloaded: number; done: number };
  bytes: { current: number; total: number; totalKnown: boolean };
}

/** One mod.info, where it sits inside a mod's directory, and what it declares. */
export interface RuntimeModInfo {
  /** "common", "42.0" — or empty for one at the top of the mod's directory. */
  folder: string;
  id: string;
  name: string;
  poster: string | null;
  versionMin: string | null;
  versionMax: string | null;
  require: string[];
}

/* One mod inside a download, as the node found it on disk. Nothing in
   it says what a build loads: that is decided on the panel, against the
   server's version (domain/games/mod-builds.ts). */
export interface RuntimeMod {
  dir: string;
  folders: string[];
  infos: RuntimeModInfo[];
}

/** One workshop download on a node, and the mods inside it. */
export interface RuntimeModItem {
  workshopId: string;
  mods: RuntimeMod[];
}

export interface IGameRuntime {
  readonly kind: RuntimeKind;
  /** The node this runtime drives. Used in messages, never for routing. */
  readonly nodeName: string;

  /** Is the node's runtime answering at all? */
  ping(): Promise<void>;
  describe(): Promise<RuntimeDescription>;

  /* Puts what a workload runs from on the node, reporting how far it
     has got until it is there — a pull, for Docker. Separate from
     provision because it is the step whose length is somebody else's
     network: it fails when the node says the fetch stopped moving, never
     because it is slow, and nothing exists afterwards that did not
     before. Already there is done at once, and reports nothing: only a
     download that happens is reported. */
  fetchSource(source: string, onProgress?: (download: RuntimeDownload) => void | Promise<void>): Promise<void>;
  provision(plan: ProvisionPlan): Promise<RuntimeStatus>;
  /** Removes the server's footprint. `withData` is the irreversible half. */
  destroy(ref: RuntimeRef, withData: boolean): Promise<{ workload: boolean; data: boolean }>;

  start(ref: RuntimeRef): Promise<RuntimeStatus>;
  stop(ref: RuntimeRef, graceSeconds?: number): Promise<RuntimeStatus>;
  restart(ref: RuntimeRef, graceSeconds?: number): Promise<RuntimeStatus>;
  status(ref: RuntimeRef): Promise<RuntimeStatus>;

  sample(ref: RuntimeRef): Promise<RuntimeSample>;
  /* With `since`, only lines from then on, each carrying `at` — how the
     poller reads a console a little at a time. */
  logs(ref: RuntimeRef, tail?: number, since?: Date): Promise<RuntimeLogLine[]>;
  /** How much the server's directory holds on its node. */
  usage(ref: RuntimeRef): Promise<{ bytes: number; files: number }>;

  /* Is something listening on one of this server's ports?

     The narrowest thing a health check needs from a runtime, and
     deliberately no wider: which ports are worth probing is the game
     definition's business, and speaking a game's protocol is nobody's
     business down here. */
  probePort(ref: RuntimeRef, port: number): Promise<boolean>;

  /* These bytes to one of this server's ports, and what answered.

     The one wider thing a health check may ask for, and still nothing
     about any game: what the bytes say and whether the reply is an
     answer are decided in domain/servers/query.ts. The runtime's part is
     that they go to a port this server publishes and nowhere else. */
  exchange(ref: RuntimeRef, request: RuntimeExchange): Promise<RuntimeExchangeReply>;

  /* What this server downloaded from a mod workshop, and what is inside
     each download.

     Narrow on purpose, and the only mod-shaped thing a runtime knows:
     the panel decides which mods a server has and writes them into the
     game's own settings; the game fetches them on the node; and this
     reads back the one fact neither the panel nor Steam can supply —
     the ids inside each download, which is what the game loads them by.
     Nothing here installs or removes anything. */
  mods(ref: RuntimeRef, mount: string, at: string): Promise<RuntimeModItem[]>;

  /** One line to the game's console. Not a shell. */
  sendCommand(ref: RuntimeRef, command: string): Promise<void>;
  /** The upstream console stream, for the panel to proxy. Never reaches a browser. */
  consoleUrl(ref: RuntimeRef): string;

  /* Archiving a server's world. Separate from `files`, which is for
     text a person edits — this is gigabytes, streamed, and never
     touches the panel's memory or a browser. */
  readonly backups: RuntimeBackups;

  readonly files: RuntimeFiles;
}
