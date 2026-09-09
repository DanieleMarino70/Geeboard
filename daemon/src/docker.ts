import { PassThrough, type Readable } from "node:stream";
import Docker from "dockerode";

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

  constructor(private managedLabel: string) {
    // dockerode picks the platform default: the named pipe on Windows,
    // /var/run/docker.sock elsewhere.
    this.docker = new Docker();
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
      startedAt: inspect.State.StartedAt === "0001-01-01T00:00:00Z" ? null : inspect.State.StartedAt,
      image: inspect.Config.Image,
    };
  }

  async status(id: string): Promise<ServerStatus> {
    return this.statusFrom(await this.container(id).inspect());
  }

  async start(id: string): Promise<ServerStatus> {
    const c = this.container(id);
    const before = await c.inspect();
    if (!before.State.Running) await c.start();
    return this.statusFrom(await c.inspect());
  }

  /** Graceful stop: SIGTERM, then SIGKILL after the grace period. */
  async stop(id: string, graceSeconds = 30): Promise<ServerStatus> {
    const c = this.container(id);
    const before = await c.inspect();
    if (before.State.Running) await c.stop({ t: graceSeconds });
    return this.statusFrom(await c.inspect());
  }

  async restart(id: string, graceSeconds = 30): Promise<ServerStatus> {
    const c = this.container(id);
    await c.restart({ t: graceSeconds });
    return this.statusFrom(await c.inspect());
  }

  /** A single stats reading, rather than the continuous stream. */
  async sample(id: string): Promise<Sample> {
    const stats = (await this.container(id).stats({ stream: false })) as Docker.ContainerStats;
    return toSample(stats);
  }

  /** The last `tail` lines, already demultiplexed. */
  async logs(id: string, tail = 200): Promise<Array<{ line: string; stderr: boolean }>> {
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

  /* Game servers read commands from stdin, so a command is written to
     the container's attached input rather than run as a new process. */
  async sendCommand(id: string, command: string): Promise<void> {
    const stream = await this.container(id).attach({
      stream: true,
      stdin: true,
      stdout: false,
      stderr: false,
      hijack: true,
    });

    const sink = new PassThrough();
    sink.pipe(stream as unknown as NodeJS.WritableStream);
    sink.end(`${command}\n`);
  }
}
