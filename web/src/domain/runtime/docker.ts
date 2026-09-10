import "server-only";
import { AgentError, DaemonClient, agentFor, type AgentNode } from "@/lib/daemon-client";
import { PlatformError } from "../errors";
import type {
  IGameRuntime,
  ProvisionPlan,
  RuntimeDescription,
  RuntimeFiles,
  RuntimeLogLine,
  RuntimeRef,
  RuntimeSample,
  RuntimeStatus,
} from "./types";

/* Docker, as one implementation of IGameRuntime.

   This is the only file in the panel that knows a game server is a
   container, and even here it only knows it by name: the Docker API
   itself lives on the node, behind the agent. What this class actually
   does is translate — the domain's vocabulary into the agent protocol on
   the way down, and the agent's failures into platform errors on the way
   back. */

/** The agent addresses a workload by container id, and files by server id. */
function workloadId(ref: RuntimeRef): string {
  if (!ref.runtimeId) {
    throw new PlatformError(
      "RUNTIME_NOT_ATTACHED",
      "This server has no running workload on its node yet.",
      { details: { serverId: ref.serverId } },
    );
  }
  return ref.runtimeId;
}

/* An agent failure carries an HTTP status that already says which kind
   of failure it is. A null status is the network — the node did not
   answer at all — which is a different problem from the node refusing. */
function translate(error: unknown, node: string): PlatformError {
  if (!(error instanceof AgentError)) {
    return new PlatformError("INTERNAL", `${node} failed in an unexpected way.`, { cause: error });
  }

  if (error.status === null) {
    return new PlatformError("RUNTIME_UNREACHABLE", error.message, {
      details: { node },
      cause: error,
    });
  }
  if (error.status === 404) {
    return new PlatformError("NOT_FOUND", error.message, { details: { node }, cause: error });
  }
  if (error.status === 409) {
    return new PlatformError("CONFLICT", error.message, { details: { node }, cause: error });
  }
  if (error.status === 400 || error.status === 403 || error.status === 422) {
    return new PlatformError("RUNTIME_REJECTED", error.message, { details: { node }, cause: error });
  }
  return new PlatformError("RUNTIME_UNREACHABLE", error.message, { details: { node }, cause: error });
}

export class DockerRuntime implements IGameRuntime {
  readonly kind = "DOCKER" as const;

  constructor(
    readonly nodeName: string,
    private agent: DaemonClient,
  ) {}

  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PlatformError) throw error;
      throw translate(error, this.nodeName);
    }
  }

  async ping(): Promise<void> {
    await this.run(() => this.agent.health());
  }

  async describe(): Promise<RuntimeDescription> {
    const version = await this.run(() => this.agent.version());
    return {
      node: version.node,
      kind: this.kind,
      engine: version.docker.engine,
    };
  }

  async provision(plan: ProvisionPlan): Promise<RuntimeStatus> {
    const status = await this.run(() =>
      this.agent.createServer({
        serverId: plan.serverId,
        name: plan.name,
        image: plan.source,
        ports: plan.ports,
        memoryMb: plan.memoryMb,
        cpuLimit: plan.cpuLimit,
        env: plan.env,
        start: plan.start,
      }),
    );
    return toStatus(status);
  }

  /* Destroying takes the server id when there is no workload: a
     provision that rolled back can leave a directory behind, and both
     have to be reachable or one of them leaks. */
  async destroy(ref: RuntimeRef, withData: boolean) {
    const result = await this.run(() =>
      this.agent.destroyServer(ref.runtimeId ?? ref.serverId, withData),
    );
    return { workload: result.container, data: result.data };
  }

  async start(ref: RuntimeRef) {
    return toStatus(await this.run(() => this.agent.start(workloadId(ref))));
  }

  async stop(ref: RuntimeRef, graceSeconds = 30) {
    return toStatus(await this.run(() => this.agent.stop(workloadId(ref), graceSeconds)));
  }

  async restart(ref: RuntimeRef, graceSeconds = 30) {
    return toStatus(await this.run(() => this.agent.restart(workloadId(ref), graceSeconds)));
  }

  async status(ref: RuntimeRef) {
    return toStatus(await this.run(() => this.agent.status(workloadId(ref))));
  }

  async sample(ref: RuntimeRef): Promise<RuntimeSample> {
    return this.run(() => this.agent.stats(workloadId(ref)));
  }

  async logs(ref: RuntimeRef, tail = 200): Promise<RuntimeLogLine[]> {
    return this.run(() => this.agent.logs(workloadId(ref), tail));
  }

  async sendCommand(ref: RuntimeRef, command: string): Promise<void> {
    await this.run(() => this.agent.command(workloadId(ref), command));
  }

  consoleUrl(ref: RuntimeRef): string {
    return this.agent.consoleUrl(workloadId(ref));
  }

  /* Files are addressed by server id, not by workload: a server's
     directory outlives any container, which is what makes it possible to
     look at a crashed server's logs and fix its config. */
  readonly files: RuntimeFiles = {
    list: (ref, at) => this.run(() => this.agent.listFiles(ref.serverId, at)),
    read: (ref, at) => this.run(() => this.agent.readFile(ref.serverId, at)),
    write: (ref, at, content) => this.run(() => this.agent.writeFile(ref.serverId, at, content)),
    makeDirectory: async (ref, at) => {
      await this.run(() => this.agent.makeDirectory(ref.serverId, at));
    },
    remove: async (ref, at) => {
      await this.run(() => this.agent.deleteFile(ref.serverId, at));
    },
    move: async (ref, from, to) => {
      await this.run(() => this.agent.moveFile(ref.serverId, from, to));
    },
  };
}

function toStatus(status: {
  id: string;
  name: string;
  state: RuntimeStatus["state"];
  exitCode: number | null;
  startedAt: string | null;
  image: string;
}): RuntimeStatus {
  return {
    id: status.id,
    name: status.name,
    state: status.state,
    exitCode: status.exitCode,
    startedAt: status.startedAt,
    source: status.image,
  };
}

/* ── Getting hold of one ──────────────────────────────────────────
   Null when the node has no agent attached. The caller decides what
   that means, because it means different things: a lifecycle action
   falls back to the simulator, a file listing simply cannot happen. */
export function runtimeFor(node: AgentNode): DockerRuntime | null {
  const agent = agentFor(node);
  return agent ? new DockerRuntime(node.name, agent) : null;
}

/** Like runtimeFor, but for callers with no sensible "no agent" path. */
export function requireRuntime(node: AgentNode): DockerRuntime {
  const runtime = runtimeFor(node);
  if (!runtime) {
    throw new PlatformError(
      "RUNTIME_NOT_ATTACHED",
      `${node.name} has no agent attached, so nothing there can be reached.`,
      { details: { node: node.name } },
    );
  }
  return runtime;
}
