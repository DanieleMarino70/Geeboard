import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";
import { after, before, test } from "node:test";
import Docker from "dockerode";
import WebSocket from "ws";

/* Exercises the daemon against a real Docker container. Alpine standing
   in for a game server: it prints on a loop and reads stdin, which is
   exactly the shape the console depends on. */

const TOKEN = "integration-token-that-is-long-enough-x";
/* A fresh port per run: a fixed one lets a daemon left behind by an
   interrupted run answer these requests, which fails confusingly. */
const PORT = 8100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const LABEL = "gg.geeboard.test";
const IMAGE = "alpine:3.20";

const docker = new Docker();
let container: Docker.Container;
let daemon: ChildProcess;

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });

async function waitFor(check: () => Promise<boolean>, label: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await check()) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

before(async () => {
  await docker.ping();

  // Pull once; a no-op when the layer is already present.
  await new Promise<void>((resolve, reject) => {
    docker.pull(IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });

  // Remove a container left behind by an interrupted run.
  for (const c of await docker.listContainers({ all: true, filters: { label: [LABEL] } })) {
    await docker.getContainer(c.Id).remove({ force: true });
  }

  container = await docker.createContainer({
    Image: IMAGE,
    name: `geeboard-test-${Date.now()}`,
    Labels: { [LABEL]: "1" },
    OpenStdin: true,
    StdinOnce: false,
    Tty: false,
    HostConfig: { Memory: 128 * 1024 * 1024 },
    // Echo a banner, then mirror stdin — a command sent in comes back out.
    Cmd: ["sh", "-c", 'echo "server ready"; while read line; do echo "recv: $line"; done'],
  });
  await container.start();

  daemon = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "test-node",
      GEEBOARD_MANAGED_LABEL: LABEL,
    },
    stdio: "ignore",
  });

  await waitFor(async () => (await fetch(`${BASE}/health`)).ok, "daemon health");

  // Confirm the process answering is the one just started, not a stray.
  assert.equal(daemon.exitCode, null, "daemon is still running");
  const version = await api("/version");
  assert.equal(((await version.json()) as { node: string }).node, "test-node");
});

after(async () => {
  daemon?.kill();
  if (container) await container.remove({ force: true }).catch(() => {});
});

test("health is reachable without a token", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, node: "test-node" });
});

test("every other route rejects a missing or wrong token", async () => {
  assert.equal((await fetch(`${BASE}/servers`)).status, 401);
  const wrong = await fetch(`${BASE}/servers`, { headers: { authorization: `Bearer ${"x".repeat(38)}` } });
  assert.equal(wrong.status, 401);
  const malformed = await fetch(`${BASE}/servers`, { headers: { authorization: TOKEN } });
  assert.equal(malformed.status, 401, "token without the Bearer scheme is rejected");
});

test("lists only containers carrying the managed label", async () => {
  const res = await api("/servers");
  assert.equal(res.status, 200);
  const { servers } = (await res.json()) as { servers: Array<{ id: string; state: string }> };
  assert.equal(servers.length, 1, "the daemon sees exactly its own container");
  assert.equal(servers[0]!.id, container.id);
  assert.equal(servers[0]!.state, "running");
});

test("reads the container's log output", async () => {
  await waitFor(async () => {
    const res = await api(`/servers/${container.id}/logs?tail=50`);
    const { lines } = (await res.json()) as { lines: Array<{ line: string }> };
    return lines.some((l) => l.line.includes("server ready"));
  }, "banner in logs");
});

test("sends a command to stdin and sees the result in the log", async () => {
  const res = await api(`/servers/${container.id}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "say hello" }),
  });
  assert.equal(res.status, 202);

  await waitFor(async () => {
    const logs = await api(`/servers/${container.id}/logs?tail=50`);
    const { lines } = (await logs.json()) as { lines: Array<{ line: string }> };
    return lines.some((l) => l.line.includes("recv: say hello"));
  }, "command echoed back");
});

test("rejects an empty or multi-line command", async () => {
  const empty = await api(`/servers/${container.id}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "   " }),
  });
  assert.equal(empty.status, 400);

  const multi = await api(`/servers/${container.id}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "stop\nrm -rf /" }),
  });
  assert.equal(multi.status, 400, "a smuggled second line is refused");
});

test("streams console output over a websocket", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/servers/${container.id}/console?token=${TOKEN}`);
  const seen: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no streamed line within 15s")), 15_000);
    ws.on("open", () => {
      void api(`/servers/${container.id}/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "ping over ws" }),
      });
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as { line?: string };
      if (msg.line) seen.push(msg.line);
      if (msg.line?.includes("recv: ping over ws")) {
        clearTimeout(timer);
        resolve();
      }
    });
    ws.on("error", reject);
  });

  ws.close();
  assert.ok(seen.length > 0);
});

test("a websocket without a token is refused", async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/servers/${container.id}/console`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connection was not refused")), 8000);
    ws.on("error", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error("unauthenticated websocket was accepted"));
    });
  });
});

test("reports real CPU and memory for the container", async () => {
  const res = await api(`/servers/${container.id}/stats`);
  assert.equal(res.status, 200);
  const s = (await res.json()) as { cpuPct: number; memLimitMb: number; memUsedMb: number };
  assert.ok(s.cpuPct >= 0, "cpu is a real number");
  // The container was created with a 128 MB limit.
  assert.ok(s.memLimitMb >= 120 && s.memLimitMb <= 136, `memLimitMb was ${s.memLimitMb}`);
  assert.ok(s.memUsedMb >= 0 && s.memUsedMb < s.memLimitMb);
});

test("stops and starts the container for real", async () => {
  const stopped = await api(`/servers/${container.id}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ graceSeconds: 2 }),
  });
  assert.equal(stopped.status, 200);
  assert.equal(((await stopped.json()) as { state: string }).state, "stopped");
  assert.equal((await container.inspect()).State.Running, false, "Docker agrees it is down");

  const started = await api(`/servers/${container.id}/start`, { method: "POST" });
  assert.equal(started.status, 200);
  assert.equal(((await started.json()) as { state: string }).state, "running");
  assert.equal((await container.inspect()).State.Running, true, "Docker agrees it is up");
});

test("an unknown container is a 404, not a 500", async () => {
  const res = await api("/servers/0123456789abcdef/stats");
  assert.equal(res.status, 404);
});
