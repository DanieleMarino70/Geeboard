import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
/* A committed alpine standing in for a game server image, so create
   finds a real image already on the node. Made and removed by this run. */
const FIXTURE = "geeboard-test/fixture:1";

const docker = new Docker();
let container: Docker.Container;
let daemon: ChildProcess;
let dataRoot: string;

/* Containers the create tests bring into being, so an assertion failing
   halfway still leaves the node clean. */
const created = new Set<string>();

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

  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-integration-"));

  daemon = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: {
      ...process.env,
      GEEBOARD_DAEMON_TOKEN: TOKEN,
      GEEBOARD_DAEMON_PORT: String(PORT),
      GEEBOARD_NODE_NAME: "test-node",
      GEEBOARD_MANAGED_LABEL: LABEL,
      GEEBOARD_DATA_ROOT: dataRoot,
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
  for (const id of created) {
    await docker.getContainer(id).remove({ force: true, v: true }).catch(() => {});
  }
  // The fixture image was made by this run, so it goes with it.
  await docker.getImage(FIXTURE).remove({ force: true }).catch(() => {});
  if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
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

/* ── Creating and destroying ────────────────────────────────────────

   A fixture image standing in for a game server image: alpine with a
   long-running command committed into it, so the daemon finds a real
   image already on the node and the container it creates stays up the
   way a real one would. */

async function buildFixtureImage() {
  const seed = await docker.createContainer({
    Image: IMAGE,
    Cmd: ["sh", "-c", 'echo "fixture ready"; while true; do sleep 1; done'],
  });
  await seed.commit({ repo: "geeboard-test/fixture", tag: "1" });
  await seed.remove({ force: true });
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    serverId: `srv${Date.now()}${Math.floor(Math.random() * 1000)}`,
    name: `test-${Date.now().toString(36)}`,
    image: FIXTURE,
    ports: [{ label: "Game", host: 27000 + Math.floor(Math.random() * 900), protocol: "both" }],
    memoryMb: 256,
    cpuLimit: 150,
    env: { GEEBOARD_TEST: "yes" },
    ...overrides,
  };
}

async function create(body: Record<string, unknown>) {
  const res = await api("/servers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as { id?: string; state?: string; error?: string };
  if (payload.id) created.add(payload.id);
  return { status: res.status, ...payload };
}

test("creates a real container, starts it, and labels it ours", async () => {
  await buildFixtureImage();

  const body = createBody();
  const made = await create(body);
  assert.equal(made.status, 201, made.error);
  assert.equal(made.state, "running", "creation starts it");

  const inspect = await docker.getContainer(made.id!).inspect();
  assert.equal(inspect.Name, `/geeboard-${body.name}`, "named for a human reading docker ps");
  assert.equal(inspect.Config.Labels[LABEL], body.serverId, "labelled with the server it is");
  assert.equal(inspect.State.Running, true, "Docker agrees it is up");

  // And the daemon now lists it alongside the container from before().
  const listed = (await (await api("/servers")).json()) as { servers: Array<{ id: string }> };
  assert.ok(listed.servers.some((s) => s.id === made.id), "the new container is listed");
});

test("the container carries the limits and ports it was asked for", async () => {
  const body = createBody({ memoryMb: 512, cpuLimit: 250 });
  const made = await create(body);
  assert.equal(made.status, 201, made.error);

  const inspect = await docker.getContainer(made.id!).inspect();
  assert.equal(inspect.HostConfig.Memory, 512 * 1024 * 1024);
  assert.equal(inspect.HostConfig.MemorySwap, 512 * 1024 * 1024, "no swapping past the ceiling");
  assert.equal(inspect.HostConfig.NanoCpus, 2.5e9);
  assert.deepEqual(inspect.HostConfig.RestartPolicy, { Name: "no", MaximumRetryCount: 0 });

  const port = (body.ports as Array<{ host: number }>)[0]!.host;
  assert.equal(inspect.HostConfig.PortBindings[`${port}/tcp`]![0]!.HostPort, String(port));
  assert.equal(inspect.HostConfig.PortBindings[`${port}/udp`]![0]!.HostPort, String(port));
  assert.ok(inspect.Config.Env.includes("GEEBOARD_TEST=yes"));
});

test("creation gives the server its own directory, mounted at /data", async () => {
  const body = createBody();
  const made = await create(body);
  assert.equal(made.status, 201, made.error);

  const root = path.join(dataRoot, body.serverId as string);
  assert.ok((await readdir(dataRoot)).includes(body.serverId as string), "the directory exists");

  const inspect = await docker.getContainer(made.id!).inspect();
  assert.deepEqual(inspect.HostConfig.Binds, [`${root}:/data`], "and nothing else is mounted");

  // A file written on the node is visible to the server, which is the
  // whole point of the file API sharing this directory.
  await writeFile(path.join(root, "server.properties"), "level-name=test\n");
  const listed = (await (
    await api(`/servers/${body.serverId}/files?path=/`)
  ).json()) as { entries: Array<{ name: string }> };
  assert.ok(listed.entries.some((e) => e.name === "server.properties"));
});

test("a bad create request is refused before Docker sees it", async () => {
  const before = await docker.listContainers({ all: true });

  for (const bad of [
    createBody({ serverId: "../escape" }),
    createBody({ image: "-rm" }),
    createBody({ memoryMb: 4 }),
    createBody({ ports: [{ label: "Game", host: 80 }] }),
    createBody({ env: { "BAD NAME": "x" } }),
  ]) {
    const res = await create(bad);
    assert.equal(res.status, 400, `accepted ${JSON.stringify(bad).slice(0, 80)}`);
  }

  const after = await docker.listContainers({ all: true });
  assert.equal(after.length, before.length, "no container was created by a refused request");
});

test("a name already taken is a 409, not a 500", async () => {
  const body = createBody();
  assert.equal((await create(body)).status, 201);

  // Same name, different server: Docker refuses the name outright.
  const clash = await create(createBody({ name: body.name }));
  assert.equal(clash.status, 409, clash.error);
});

test("destroying removes the container, and the world only when asked", async () => {
  const keep = createBody();
  const kept = await create(keep);
  assert.equal(kept.status, 201, kept.error);
  await writeFile(path.join(dataRoot, keep.serverId as string, "world.dat"), "precious");

  const plain = await api(`/servers/${kept.id}`, { method: "DELETE" });
  assert.equal(plain.status, 200);
  assert.deepEqual(await plain.json(), { container: true, data: false });
  await assert.rejects(() => docker.getContainer(kept.id!).inspect(), "the container is gone");
  assert.ok(
    (await readdir(path.join(dataRoot, keep.serverId as string))).includes("world.dat"),
    "the world survives a plain delete",
  );

  const wiped = createBody();
  const gone = await create(wiped);
  assert.equal(gone.status, 201, gone.error);

  const full = await api(`/servers/${gone.id}?data=true`, { method: "DELETE" });
  assert.equal(full.status, 200);
  assert.deepEqual(await full.json(), { container: true, data: true });
  assert.ok(
    !(await readdir(dataRoot)).includes(wiped.serverId as string),
    "asking for the data removes the directory too",
  );
});

test("a directory left behind without a container can still be removed", async () => {
  /* This is the shape a rolled-back create leaves: the panel has a
     server id and no container, and the directory would leak. */
  const serverId = `orphan${Date.now()}`;
  await api(`/servers/${serverId}/files?path=/`);
  assert.ok((await readdir(dataRoot)).includes(serverId), "the directory exists");

  const res = await api(`/servers/${serverId}?data=true`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { container: false, data: true });
  assert.ok(!(await readdir(dataRoot)).includes(serverId));
});

test("a container that is not ours cannot be touched at all", async () => {
  const stranger = await docker.createContainer({
    Image: IMAGE,
    name: `not-geeboards-${Date.now()}`,
    Cmd: ["sh", "-c", "while true; do sleep 1; done"],
  });
  await stranger.start();

  try {
    // Every route that names a container, not just the destructive one.
    for (const [method, path] of [
      ["GET", `/servers/${stranger.id}`],
      ["GET", `/servers/${stranger.id}/stats`],
      ["GET", `/servers/${stranger.id}/logs`],
      ["POST", `/servers/${stranger.id}/stop`],
      ["POST", `/servers/${stranger.id}/restart`],
      ["DELETE", `/servers/${stranger.id}?data=true`],
    ] as const) {
      const res = await api(path, { method });
      assert.equal(res.status, 403, `${method} ${path} was not refused`);
    }

    assert.equal((await stranger.inspect()).State.Running, true, "and it is still running");
  } finally {
    await stranger.remove({ force: true }).catch(() => {});
  }
});
