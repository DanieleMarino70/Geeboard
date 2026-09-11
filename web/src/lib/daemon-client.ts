import "server-only";
import { decryptSecret } from "./secrets";

/* The panel's side of the node agent protocol. Mirrors daemon/README.md;
   if that API changes, this is the file that changes with it. */

export type AgentState = "running" | "starting" | "stopping" | "stopped" | "crashed" | "unknown";

export interface AgentStatus {
  id: string;
  name: string;
  state: AgentState;
  exitCode: number | null;
  /** Killed for exceeding its memory limit, whatever the exit code. */
  oomKilled?: boolean;
  startedAt: string | null;
  image: string;
}

export interface AgentArchive {
  artifact: string;
  sizeBytes: number;
  checksum: string;
  durationMs: number;
}

export interface AgentSample {
  cpuPct: number;
  memUsedMb: number;
  memLimitMb: number;
  memPct: number;
  rxBytes: number;
  txBytes: number;
}

export interface AgentLine {
  line: string;
  stderr: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedAt: string;
  mode: string;
}

/** What the agent needs to bring a container into being. Mirrors
    daemon/src/provision.ts, which refuses anything malformed. */
export interface CreateSpec {
  serverId: string;
  name: string;
  image: string;
  ports: Array<{
    label: string;
    host: number;
    container: number;
    protocol: "tcp" | "udp" | "both";
  }>;
  memoryMb: number;
  cpuLimit: number;
  env: Record<string, string>;
  start: boolean;
}

/** A node with an agent attached. */
export interface AgentNode {
  name: string;
  daemonUrl: string | null;
  daemonToken: string | null;
}

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly node: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/** Null when the node has no agent configured — the caller decides what that means. */
export function agentFor(node: AgentNode): DaemonClient | null {
  if (!node.daemonUrl || !node.daemonToken) return null;
  return new DaemonClient(node.name, node.daemonUrl, decryptSecret(node.daemonToken));
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class DaemonClient {
  constructor(
    private nodeName: string,
    private baseUrl: string,
    private token: string,
  ) {}

  private async call<T>(
    path: string,
    init: RequestInit = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    /* A node that has fallen over must not hold a page render open, so
       every call is bounded. */
    const abort = AbortSignal.timeout(timeoutMs);

    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        ...init,
        signal: abort,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        cache: "no-store",
      });
    } catch (cause) {
      const reason = cause instanceof Error && cause.name === "TimeoutError" ? "timed out" : "unreachable";
      throw new AgentError(`${this.nodeName} is ${reason}`, null, this.nodeName);
    }

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* not JSON; the status text will do */
      }
      throw new AgentError(detail, res.status, this.nodeName);
    }

    return (await res.json()) as T;
  }

  health() {
    return this.call<{ ok: boolean; node: string }>("/health");
  }

  version() {
    return this.call<{ node: string; docker: { engine: string; api: string } }>("/version");
  }

  list() {
    return this.call<{ servers: AgentStatus[] }>("/servers").then((r) => r.servers);
  }

  status(containerId: string) {
    return this.call<AgentStatus>(`/servers/${encodeURIComponent(containerId)}`);
  }

  /* ── Creating and destroying ────────────────────────────────────
     Creation may have to pull an image over somebody else's network,
     so it gets a far longer leash than any other call — but a bounded
     one, and one that always outlives the agent's own pull timeout so
     the failure comes back with the agent's reason attached. */

  createServer(spec: CreateSpec) {
    return this.call<AgentStatus>(
      "/servers",
      { method: "POST", body: JSON.stringify(spec) },
      180_000,
    );
  }

  /* `id` is the container id when there is one, and the server id when
     a create rolled back and left only the directory. Removing the data
     is opt-in on purpose: it is the irreversible half. */
  destroyServer(id: string, withData: boolean) {
    return this.call<{ container: boolean; data: boolean }>(
      `/servers/${encodeURIComponent(id)}?data=${withData}`,
      { method: "DELETE" },
      60_000,
    );
  }

  start(containerId: string) {
    return this.call<AgentStatus>(`/servers/${encodeURIComponent(containerId)}/start`, {
      method: "POST",
    });
  }

  /* Stopping a busy world can take a while, so it gets more headroom
     than the grace period it is given. */
  stop(containerId: string, graceSeconds = 30) {
    return this.call<AgentStatus>(
      `/servers/${encodeURIComponent(containerId)}/stop`,
      { method: "POST", body: JSON.stringify({ graceSeconds }) },
      (graceSeconds + 15) * 1000,
    );
  }

  restart(containerId: string, graceSeconds = 30) {
    return this.call<AgentStatus>(
      `/servers/${encodeURIComponent(containerId)}/restart`,
      { method: "POST", body: JSON.stringify({ graceSeconds }) },
      (graceSeconds + 30) * 1000,
    );
  }

  stats(containerId: string) {
    return this.call<AgentSample>(`/servers/${encodeURIComponent(containerId)}/stats`);
  }

  /* Is something listening on one of this server's ports? The agent
     refuses any port the container does not publish. */
  probe(containerId: string, port: number) {
    return this.call<{ reachable: boolean; ms: number }>(
      `/servers/${encodeURIComponent(containerId)}/probe?port=${port}`,
      {},
      5_000,
    );
  }

  logs(containerId: string, tail = 200) {
    return this.call<{ lines: AgentLine[] }>(
      `/servers/${encodeURIComponent(containerId)}/logs?tail=${tail}`,
    ).then((r) => r.lines);
  }

  /* ── Files ──────────────────────────────────────────────────────
     The agent resolves every path inside the server's own directory;
     the panel never sends an absolute one. */

  listFiles(serverId: string, at = "/") {
    return this.call<{ path: string; entries: FileEntry[] }>(
      `/servers/${encodeURIComponent(serverId)}/files?path=${encodeURIComponent(at)}`,
    );
  }

  readFile(serverId: string, at: string) {
    return this.call<{ content: string; sizeBytes: number; truncated: boolean }>(
      `/servers/${encodeURIComponent(serverId)}/files/content?path=${encodeURIComponent(at)}`,
    );
  }

  writeFile(serverId: string, at: string, content: string) {
    return this.call<FileEntry>(
      `/servers/${encodeURIComponent(serverId)}/files/content?path=${encodeURIComponent(at)}`,
      { method: "PUT", body: JSON.stringify({ content }) },
      30_000,
    );
  }

  makeDirectory(serverId: string, at: string) {
    return this.call<{ created: string }>(
      `/servers/${encodeURIComponent(serverId)}/files/directory?path=${encodeURIComponent(at)}`,
      { method: "POST" },
    );
  }

  deleteFile(serverId: string, at: string) {
    return this.call<{ deleted: string }>(
      `/servers/${encodeURIComponent(serverId)}/files?path=${encodeURIComponent(at)}`,
      { method: "DELETE" },
    );
  }

  moveFile(serverId: string, from: string, to: string) {
    return this.call<{ from: string; to: string }>(
      `/servers/${encodeURIComponent(serverId)}/files/move`,
      { method: "POST", body: JSON.stringify({ from, to }) },
    );
  }

  /* ── Backups ────────────────────────────────────────────────────
     Archiving is gigabytes of world data and can take minutes, so these
     get a long leash — but a bounded one, because a node that has
     wandered off must not hold a request open forever. */

  createBackup(serverId: string, name: string) {
    return this.call<AgentArchive>(
      `/servers/${encodeURIComponent(serverId)}/backups`,
      { method: "POST", body: JSON.stringify({ name }) },
      15 * 60_000,
    );
  }

  listBackups(serverId: string) {
    return this.call<{ backups: Array<{ artifact: string; sizeBytes: number; createdAt: string }> }>(
      `/servers/${encodeURIComponent(serverId)}/backups`,
    ).then((r) => r.backups);
  }

  deleteBackup(serverId: string, artifact: string) {
    return this.call<{ deleted: string }>(
      `/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(artifact)}`,
      { method: "DELETE" },
      60_000,
    );
  }

  /* The checksum is passed so the node can refuse an archive whose bytes
     have changed since it was written. A restore is destructive; it
     should not proceed on something we cannot recognise. */
  restoreBackup(serverId: string, artifact: string, checksum?: string) {
    return this.call<{ files: number }>(
      `/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(artifact)}/restore`,
      { method: "POST", body: JSON.stringify({ checksum }) },
      15 * 60_000,
    );
  }

  /** ws:// URL for this container's console, token included. */
  consoleUrl(containerId: string): string {
    const url = new URL(`/servers/${encodeURIComponent(containerId)}/console`, this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", this.token);
    return url.toString();
  }

  command(containerId: string, command: string) {
    return this.call<{ sent: string }>(`/servers/${encodeURIComponent(containerId)}/command`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
  }
}

/* The agent's vocabulary is mapped onto the panel's ServerState by
   mapRuntimeState() in src/domain/servers/state.ts, alongside the rest
   of the lifecycle it belongs to. It does not live here, because what a
   state *means* is a domain question and this file is a wire client. */
