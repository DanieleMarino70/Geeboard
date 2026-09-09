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
  startedAt: string | null;
  image: string;
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

/** The agent's vocabulary mapped onto the panel's ServerState enum. */
export const AGENT_TO_DB = {
  running: "RUNNING",
  starting: "STARTING",
  stopping: "STOPPING",
  stopped: "STOPPED",
  crashed: "CRASHED",
  unknown: "STOPPED",
} as const;
