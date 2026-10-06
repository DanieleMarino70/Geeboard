import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { platformReporter } from "../src/capabilities.ts";
import type { Config } from "../src/config.ts";
import { EXIT_CONFIG, EXIT_FATAL, installCrashHandlers } from "../src/crash.ts";
import type { DockerEngine } from "../src/docker.ts";
import { Pulls } from "../src/pulls.ts";
import { buildServer, parseTarget } from "../src/server.ts";
import { TerminalSessions } from "../src/terminal.ts";

/* The agent's listener, run in-process against a fake engine and a real
   socket. What these hold in place is what a stranger on the Internet can
   do to an agent before it has checked who they are: the port of a VPS is
   open to everyone, and for a long time a request of one line killed it. */

const TOKEN = "server-test-token-that-is-long-enough-x";
let dataRoot: string;

const stopped: string[] = [];
/* Only the parts of the engine the routes under test reach. */
const engine = {
  ping: async () => {},
  info: async () => ({ OSType: "linux", Architecture: "x86_64", MemTotal: 1 << 30 }),
  stop: async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    stopped.push(id);
    return { id, state: "STOPPED" };
  },
  follow: async (_id: string, _onLine: unknown, _tail?: number, _onEnd?: () => void) => () => {},
} as unknown as DockerEngine;

function config(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    token: TOKEN,
    tokenFromEnvironment: true,
    nodeName: "test-node",
    sampleIntervalMs: 15_000,
    managedLabel: "gg.geeboard.test",
    containerPrefix: "geeboard-test-",
    dataRoot,
    pullStallMs: 120_000,
    retiredPullTimeout: false,
    panelUrl: null,
    registrationToken: null,
    advertiseUrl: null,
    capabilities: [],
    version: "0.0.0-test",
    agentFile: null,
    terminal: false,
    terminalShell: null,
    terminalLimits: { maxSessions: 1, idleMs: 60_000, maxMs: 60_000 },
    ...overrides,
  };
}

async function start() {
  const agent = buildServer({
    config: config(),
    engine,
    pulls: new Pulls({ open: async () => { throw new Error("no pulls here"); }, present: async () => true }, 120_000),
    platform: platformReporter(() => engine.info()),
    terminal: new TerminalSessions({ enabled: false, shell: null, maxSessions: 1, idleMs: 1000, maxMs: 1000 }, { reason: "not under test" }),
  });
  await new Promise<void>((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
  return { agent, port: (agent.server.address() as AddressInfo).port };
}

/** What comes back for bytes written to a socket, verbatim, until the peer closes or goes quiet. */
function exchange(port: number, payload: string, quietMs = 400): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    let got = "";
    socket.on("data", (chunk) => (got += chunk));
    socket.on("close", () => resolve(got));
    socket.on("error", reject);
    socket.setTimeout(quietMs, () => socket.destroy());
  });
}

const statusOf = (reply: string) => reply.split("\r\n")[0] ?? "";

before(async () => {
  dataRoot = await mkdtemp(path.join(tmpdir(), "geeboard-server-"));
});

after(async () => {
  await rm(dataRoot, { recursive: true, force: true });
});

test("parseTarget accepts a path and refuses what `new URL` would throw on or move a host out of", () => {
  assert.equal(parseTarget("/")?.pathname, "/");
  assert.equal(parseTarget("/servers/a/files?path=%2Fx")?.searchParams.get("path"), "/x");
  for (const bad of [undefined, "", "*", "//[", "//", "//evil.example/servers", "/\\evil.example/servers", "http://x/", "servers", "/%zz", "/servers/%zz/start"]) {
    assert.equal(parseTarget(bad), null, `${JSON.stringify(bad)} is not a request target`);
  }
});

test("a request target nobody could route is a 400, and the agent goes on answering", async () => {
  const { agent, port } = await start();
  try {
    for (const target of ["//[", "//", "//evil.example/servers", "http://x/", "/%zz", "/servers/%zz/start"]) {
      const method = target.endsWith("/start") ? "POST" : "GET";
      const reply = await exchange(port, `${method} ${target} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN}\r\ncontent-length: 0\r\n\r\n`);
      assert.match(statusOf(reply), /^HTTP\/1\.1 400 /, `${method} ${target} → ${statusOf(reply)}`);
    }
    assert.match(statusOf(await exchange(port, "GET /health HTTP/1.1\r\nHost: x\r\n\r\n")), / 200 /);
  } finally {
    await agent.shutdown(500);
  }
});

test("a malformed upgrade is refused and does not stop the agent", async () => {
  const { agent, port } = await start();
  try {
    const handshake = (target: string) =>
      `GET ${target} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`;
    for (const target of ["//[", "/servers/%zz/console", "/terminal/%zz/stream"]) {
      assert.match(statusOf(await exchange(port, handshake(target))), /^HTTP\/1\.1 400 /, target);
    }
    assert.match(statusOf(await exchange(port, "GET /health HTTP/1.1\r\nHost: x\r\n\r\n")), / 200 /);
  } finally {
    await agent.shutdown(500);
  }
});

test("a body that is not a JSON object is a 400, one over the bound a 413", async () => {
  const { agent, port } = await start();
  try {
    const post = (body: string) =>
      fetch(`http://127.0.0.1:${port}/servers/aurora/stop`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body,
      });
    for (const body of ["{not json", "[1,2]", "null", "7"]) {
      const response = await post(body);
      assert.equal(response.status, 400, body);
      assert.match(((await response.json()) as { error: string }).error, /JSON/);
    }
    assert.equal((await post(JSON.stringify({ filler: "x".repeat(70 * 1024) }))).status, 413);
    assert.equal((await post("{}")).status, 200);
  } finally {
    await agent.shutdown(500);
  }
});

test("a file the editor can open can be saved: the body bound is the editor's, not 64 KiB", async () => {
  const { agent, port } = await start();
  try {
    const content = "line of a long config file\n".repeat(30_000); // about 800 KB
    const response = await fetch(`http://127.0.0.1:${port}/servers/aurora/files/content?path=big.txt`, {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    assert.equal(response.status, 200);
    assert.equal(await readFile(path.join(dataRoot, "aurora", "big.txt"), "utf8"), content);
  } finally {
    await agent.shutdown(500);
  }
});

test("a download whose client goes away costs nothing: no throw from the handler, the agent answers next", async () => {
  const { agent, port } = await start();
  try {
    await mkdir(path.join(dataRoot, "aurora"), { recursive: true });
    await writeFile(path.join(dataRoot, "aurora", "world.bin"), Buffer.alloc(48 * 1024 * 1024, 1));
    const socket = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(`GET /servers/aurora/files/raw?path=world.bin HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`);
    await new Promise<void>((resolve) => socket.once("data", () => resolve()));
    socket.destroy(); // the throttled download is abandoned with most of it unsent
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.match(statusOf(await exchange(port, "GET /health HTTP/1.1\r\nHost: x\r\n\r\n")), / 200 /);
  } finally {
    await agent.shutdown(500);
  }
});

test("stopping ends open consoles at once instead of waiting for the panel to let go", async () => {
  const { agent, port } = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/servers/aurora/console?token=${TOKEN}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  const began = Date.now();
  await agent.shutdown(20_000);
  const code = await closed;
  const took = Date.now() - began;
  assert.equal(code, 1001, "the client is told the agent is going away");
  assert.ok(took < 3_000, `shutdown with a console open took ${took} ms; the old agent waited for the grace period`);
});

test("while stopping, what is in flight finishes and nothing that changes the machine is started", async () => {
  const { agent, port } = await start();
  const post = (id: string) =>
    `POST /servers/${id}/stop HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN}\r\ncontent-type: application/json\r\ncontent-length: 2\r\n\r\n{}`;
  // One connection: the first request is still running when the agent begins to stop, and the second arrives after.
  const socket = net.connect(port, "127.0.0.1");
  let reply = "";
  socket.on("data", (chunk) => (reply += chunk));
  const ended = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write(post("first"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const shutdown = agent.shutdown(5_000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.write(post("second"));
  await Promise.all([ended, shutdown]);
  assert.match(reply, /HTTP\/1\.1 200 /, "the request in flight is answered");
  assert.ok(stopped.includes("first"));
  assert.ok(!stopped.includes("second"), "a request that arrives while stopping starts nothing");
  assert.match(reply, /HTTP\/1\.1 503 /);
});

test("a second agent on a port that is taken says so in one sentence and exits with the code the unit does not restart on", async () => {
  const holder = net.createServer();
  await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
  const port = (holder.address() as AddressInfo).port;
  try {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: {
        ...process.env,
        GEEBOARD_DAEMON_TOKEN: TOKEN,
        GEEBOARD_NODE_NAME: "test-node",
        GEEBOARD_DAEMON_HOST: "127.0.0.1",
        GEEBOARD_DAEMON_PORT: String(port),
        GEEBOARD_DATA_ROOT: dataRoot,
        LOG_FORMAT: "json",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    assert.equal(code, EXIT_CONFIG);
    assert.match(stderr, /already in use/);
    assert.equal(stderr.trim().split("\n").length, 1, "one line, not a stack trace");
  } finally {
    holder.close();
  }
});

test("an error nobody handled is written down once, as a line, and ends the process with a restartable code", () => {
  const proc = new EventEmitter();
  const exits: number[] = [];
  const written: string[] = [];
  const real = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    installCrashHandlers(proc, (code) => exits.push(code));
    proc.emit("uncaughtException", new Error("boom"));
    proc.emit("unhandledRejection", "a second failure while ending");
  } finally {
    process.stderr.write = real;
  }
  assert.deepEqual(exits, [EXIT_FATAL]);
  assert.equal(written.length, 1);
  assert.match(written[0]!, /uncaughtException/);
  assert.match(written[0]!, /boom/);
});
