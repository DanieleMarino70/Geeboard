import { rm } from "node:fs/promises";
import type { Readable } from "node:stream";
import Docker from "dockerode";
import { ensureRoot, rootFor } from "./files.ts";
import {
  NotManagedError,
  containerOptions,
  type CreateSpec,
  type EngineSettings,
} from "./provision.ts";

/* Everything that touches the Docker socket lives here, so the HTTP
   layer never has to know how a container is driven. */

export type ContainerState =
  | "running"
  | "starting"
  | "stopping"
  | "stopped"
  | "crashed"
  | "unknown";

export interface ServerStatus {
  id: string;
  name: string;
  state: ContainerState;
  exitCode: number | null;
  /* Out of memory is a crash whatever the exit code, and it is the one
     cause a restart policy must treat differently: restarting a server
     that died because it asked for more memory than it has just kills
     it again, on a loop, until somebody changes the limit. */
  oomKilled: boolean;
  startedAt: string | null;
  image: string;
}

export interface Sample {
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  memPct: number;
  rxBytes: number;
  txBytes: number;
}

/* Exit codes that mean "this was asked to stop", not "this fell over".
   143 is SIGTERM and 130 is SIGINT, but 137 (SIGKILL) belongs here too:
   `docker stop` escalates to SIGKILL after the grace period, and most
   game servers run under a shell that never installs a SIGTERM handler.
   Calling that a crash would flag every ordinary shutdown. */
const CLEAN_EXITS = new Set([0, 130, 137, 143]);

export function mapState(inspect: Docker.ContainerInspectInfo): ContainerState {
  const s = inspect.State;
  if (s.Running) return s.Paused ? "stopping" : "running";
  if (s.Restarting) return "starting";
  if (s.Status === "removing") return "stopping";
  // Running out of memory is a crash however it exited — and it is the
  // one cause an operator most needs told about.
  if (s.OOMKilled) return "crashed";
  if (!CLEAN_EXITS.has(s.ExitCode)) return "crashed";
  return "stopped";
}

/* Docker's stats are cumulative counters; CPU percentage is the delta
   against the system delta, scaled by the number of cores. */
export function cpuPercent(stats: Docker.ContainerStats): number {
  const cpu = stats.cpu_stats;
  const pre = stats.precpu_stats;
  if (!cpu?.cpu_usage || !pre?.cpu_usage) return 0;

  const cpuDelta = cpu.cpu_usage.total_usage - pre.cpu_usage.total_usage;
  const systemDelta = (cpu.system_cpu_usage ?? 0) - (pre.system_cpu_usage ?? 0);
  if (cpuDelta <= 0 || systemDelta <= 0) return 0;

  const cores = cpu.online_cpus || cpu.cpu_usage.percpu_usage?.length || 1;
  return Math.round((cpuDelta / systemDelta) * cores * 100 * 10) / 10;
}

export function toSample(stats: Docker.ContainerStats): Sample {
  const mem = stats.memory_stats ?? {};
  const used = (mem.usage ?? 0) - (mem.stats?.cache ?? 0);
  const limit = mem.limit ?? 0;
  const nets = Object.values(stats.networks ?? {});

  return {
    cpuPct: cpuPercent(stats),
    memUsedMb: Math.round(used / 1024 / 1024),
    memLimitMb: Math.round(limit / 1024 / 1024),
    memPct: limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
    rxBytes: nets.reduce((n, x) => n + (x.rx_bytes ?? 0), 0),
    txBytes: nets.reduce((n, x) => n + (x.tx_bytes ?? 0), 0),
  };
}

/* Docker multiplexes stdout and stderr into a framed stream when the
   container has no TTY: an 8-byte header per chunk, with the payload
   length in bytes 4..8. */
export function demultiplex(chunk: Buffer, onLine: (line: string, stderr: boolean) => void) {
  let offset = 0;
  while (offset + 8 <= chunk.length) {
    const stderr = chunk[offset] === 2;
    const length = chunk.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > chunk.length) break;

    const text = chunk.subarray(start, end).toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) onLine(line, stderr);
    }
    offset = end;
  }
}

export class DockerEngine {
  private docker: Docker;
  private managedLabel: string;
  private dataRoot: string;
  private pullTimeoutMs: number;

  constructor(settings: EngineSettings & { pullTimeoutMs?: number }) {
    // dockerode picks the platform default: the named pipe on Windows,
    // /var/run/docker.sock elsewhere.
    this.docker = new Docker();
    this.managedLabel = settings.managedLabel;
    this.dataRoot = settings.dataRoot;
    this.pullTimeoutMs = settings.pullTimeoutMs ?? 120_000;
  }

  async ping(): Promise<void> {
    await this.docker.ping();
  }

  async version() {
    const v = await this.docker.version();
    return { engine: v.Version, api: v.ApiVersion, os: v.Os, arch: v.Arch };
  }

  private container(id: string) {
    return this.docker.getContainer(id);
  }

  /* Every operation that names a container goes through here first.

     Listing has always filtered on the label, but an id arriving in a
     URL had not been checked against it — so a caller who knew any
     container id on the node could drive it. That was survivable while
     the daemon could only start and stop things; it is not now that it
     can force-remove one. */
  private async managed(id: string): Promise<Docker.ContainerInspectInfo> {
    const inspect = await this.container(id).inspect();
    if (inspect.Config.Labels?.[this.managedLabel] === undefined) {
      throw new NotManagedError("that container is not managed by this node agent");
    }
    return inspect;
  }

  /** Only containers this daemon is responsible for. */
  async list(): Promise<ServerStatus[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [this.managedLabel] },
    });

    return Promise.all(
      containers.map(async (c) => {
        const inspect = await this.container(c.Id).inspect();
        return this.statusFrom(inspect);
      }),
    );
  }

  private statusFrom(inspect: Docker.ContainerInspectInfo): ServerStatus {
    return {
      id: inspect.Id,
      name: inspect.Name.replace(/^\//, ""),
      state: mapState(inspect),
      exitCode: inspect.State.Running ? null : inspect.State.ExitCode,
      oomKilled: inspect.State.OOMKilled === true,
      startedAt: inspect.State.StartedAt === "0001-01-01T00:00:00Z" ? null : inspect.State.StartedAt,
      image: inspect.Config.Image,
    };
  }

  async status(id: string): Promise<ServerStatus> {
    return this.statusFrom(await this.managed(id));
  }

  async start(id: string): Promise<ServerStatus> {
    const before = await this.managed(id);
    const c = this.container(id);
    if (!before.State.Running) await c.start();
    return this.statusFrom(await c.inspect());
  }

  /** Graceful stop: SIGTERM, then SIGKILL after the grace period. */
  async stop(id: string, graceSeconds = 30): Promise<ServerStatus> {
    const before = await this.managed(id);
    const c = this.container(id);
    if (before.State.Running) await c.stop({ t: graceSeconds });
    return this.statusFrom(await c.inspect());
  }

  async restart(id: string, graceSeconds = 30): Promise<ServerStatus> {
    await this.managed(id);
    const c = this.container(id);
    await c.restart({ t: graceSeconds });
    return this.statusFrom(await c.inspect());
  }

  /** A single stats reading, rather than the continuous stream. */
  async sample(id: string): Promise<Sample> {
    await this.managed(id);
    const stats = (await this.container(id).stats({ stream: false })) as Docker.ContainerStats;
    return toSample(stats);
  }

  /** The last `tail` lines, already demultiplexed. */
  async logs(id: string, tail = 200): Promise<Array<{ line: string; stderr: boolean }>> {
    await this.managed(id);
    const buffer = (await this.container(id).logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
    })) as unknown as Buffer;

    const out: Array<{ line: string; stderr: boolean }> = [];
    demultiplex(Buffer.from(buffer), (line, stderr) => out.push({ line, stderr }));
    return out;
  }

  /** A live log stream. Call the returned function to stop it. */
  async follow(
    id: string,
    onLine: (line: string, stderr: boolean) => void,
    tail = 100,
  ): Promise<() => void> {
    await this.managed(id);
    const stream = (await this.container(id).logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail,
    })) as unknown as Readable;

    const onData = (chunk: Buffer) => demultiplex(chunk, onLine);
    stream.on("data", onData);

    return () => {
      stream.off("data", onData);
      stream.destroy();
    };
  }

  /* ── Creating and destroying ──────────────────────────────────── */

  /** True when the image is already on the node, so a pull can be skipped. */
  async hasImage(reference: string): Promise<boolean> {
    try {
      await this.docker.getImage(reference).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /* Pulling is the one step whose duration is somebody else's network.
     It is bounded so a create either finishes or fails with a sentence
     an operator can act on, rather than holding a request open. */
  async pull(reference: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`pulling ${reference} took longer than ${this.pullTimeoutMs}ms`));
      }, this.pullTimeoutMs);

      this.docker.pull(reference, (error: Error | null, stream: NodeJS.ReadableStream) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        this.docker.modem.followProgress(stream, (done: Error | null) => {
          clearTimeout(timer);
          if (done) reject(done);
          else resolve();
        });
      });
    });
  }

  /* Creates the server's directory, the container, and — unless asked
     not to — starts it.

     Anything that fails partway is undone here rather than reported as
     a half-made server: a container that exists but will not start is
     the worst of both outcomes, because the panel would show a server
     that cannot be fixed from the panel. */
  async create(spec: CreateSpec): Promise<ServerStatus> {
    const root = rootFor(this.dataRoot, spec.serverId);
    await ensureRoot(root);

    if (!(await this.hasImage(spec.image))) await this.pull(spec.image);

    const container = await this.docker.createContainer(
      containerOptions(spec, { managedLabel: this.managedLabel, dataRoot: this.dataRoot }),
    );

    if (spec.start) {
      try {
        await container.start();
      } catch (error) {
        await container.remove({ force: true, v: true }).catch(() => {});
        throw error;
      }
    }

    return this.statusFrom(await container.inspect());
  }

  /* Removes a server's footprint on this node.

     The id is a container id when there is a container, and a server id
     when a create rolled back and left only the directory behind — both
     have to be reachable or a failed create leaks one or the other.
     What was actually removed is reported rather than assumed. */
  async destroy(id: string, withData: boolean): Promise<{ container: boolean; data: boolean }> {
    let serverId: string | null = null;
    let removedContainer = false;

    try {
      // managed() refuses anything that is not ours; a missing container
      // is not an error here, since removing it is the goal either way.
      const inspect = await this.managed(id);
      serverId = inspect.Config.Labels[this.managedLabel] || null;
      await this.container(id).remove({ force: true, v: true });
      removedContainer = true;
    } catch (error) {
      if (!/no such container/i.test((error as Error).message)) throw error;
      // Nothing by that container id — read it as a server id instead.
      serverId = id;
    }

    let removedData = false;
    if (withData && serverId) {
      // rootFor validates the id before it becomes a path, so a crafted
      // one cannot aim this at anything outside the data root.
      await rm(rootFor(this.dataRoot, serverId), { recursive: true, force: true });
      removedData = true;
    }

    return { container: removedContainer, data: removedData };
  }

  /* Opens the container's stdin and hands back the raw socket.

     This does by hand what `container.attach()` would do, for one
     reason: dockerode sends the attach options as a JSON request body,
     and Docker hijacks the connection before it consumes that body — so
     the bytes are delivered to the container as console input. It shows
     up as the options object arriving on stdin, intermittently, because
     it depends on which side wins the race.

     A zero-length body is the way out, and the only route to one
     through the library is `file`, which is written raw. Chunked
     encoding is no good either: its terminating chunk lands on stdin
     the same way. */
  private attachStdin(id: string): Promise<NodeJS.WritableStream> {
    return new Promise((resolve, reject) => {
      this.docker.modem.dial(
        {
          path: `/containers/${id}/attach?`,
          method: "POST",
          isStream: true,
          hijack: true,
          // Leave the request to be ended here rather than held open.
          openStdin: false,
          statusCodes: { 101: true, 200: true, 404: "no such container", 500: "server error" },
          options: { _query: { stream: "1", stdin: "1", stdout: "0", stderr: "0" }, _body: {} },
          file: Buffer.alloc(0),
          headers: { "Content-Type": "text/plain" },
        } as never,
        ((error: Error | null, stream: unknown) => {
          if (error) reject(error);
          else resolve(stream as NodeJS.WritableStream);
        }) as never,
      );
    });
  }

  /* Is something listening on one of this server's ports?

     The narrowest useful primitive, and deliberately narrow. The panel
     decides *which* probes a game needs — that is game knowledge and it
     belongs in the definition — but the connection has to be made from
     here, because the panel may have no route to a game port and the
     node always does.

     The port must be one this container actually publishes. Without
     that check this would be a port scanner with an HTTP interface,
     running on somebody's machine, reachable by anything holding the
     panel's token. */
  async probePort(id: string, port: number): Promise<{ reachable: boolean; ms: number }> {
    const inspect = await this.managed(id);

    const published = new Set<number>();
    for (const bindings of Object.values(inspect.NetworkSettings?.Ports ?? {})) {
      for (const binding of bindings ?? []) {
        const hostPort = Number(binding.HostPort);
        if (Number.isInteger(hostPort)) published.add(hostPort);
      }
    }
    if (!published.has(port)) {
      throw new NotManagedError(`this server does not publish port ${port}`);
    }

    return connect(port);
  }

  /* Game servers read commands from stdin, so a command is written to
     the container's attached input rather than run as a new process. */
  async sendCommand(id: string, command: string): Promise<void> {
    await this.managed(id);
    const stream = await this.attachStdin(id);

    /* Wait for the line to reach the socket before answering. Handing
       back a 202 while the bytes are still in a pipe is how a command
       gets acknowledged and then quietly lost. */
    await new Promise<void>((resolve, reject) => {
      stream.write(`${command}\n`, (error) => (error ? reject(error) : resolve()));
    });

    /* Closing this attachment does not close the container's stdin —
       StdinOnce is false, so the server keeps its console. */
    stream.end();
  }
}

/* A TCP connect, and nothing more.

   Bounded tightly: a health check runs on every poll for every running
   server, and one that can hang for a minute would stall the loop for
   everything behind it. Two seconds is generous for a socket on the
   same machine.

   Connecting is the whole test. Nothing is sent and nothing is read —
   speaking a game's protocol is the definition's business, and writing
   arbitrary bytes to a port on request is not something this agent
   should be able to do. */
async function connect(port: number, timeoutMs = 2_000): Promise<{ reachable: boolean; ms: number }> {
  const { Socket } = await import("node:net");
  const started = Date.now();

  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve({ reachable, ms: Date.now() - started });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    // Loopback: the port is published on this machine's host interface.
    socket.connect(port, "127.0.0.1");
  });
}
