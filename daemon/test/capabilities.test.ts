import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import { test } from "node:test";
import path from "node:path";
import {
  architecture,
  diskBytes,
  normaliseArchitecture,
  normaliseOperatingSystem,
  operatingSystem,
  platformReporter,
  type EngineInfo,
} from "../src/capabilities.ts";
import type { Config } from "../src/config.ts";
import { panelClient } from "../src/panel.ts";

/* What a node says it runs on. The bug these exist for: a Windows machine
   running Docker Desktop reported "windows", and every game in the catalog
   — all of them Linux images — was refused on a node that could run them. */

test("architecture names from Docker, the kernel and Go all map to the games' vocabulary", () => {
  assert.equal(normaliseArchitecture("x86_64"), "x64");
  assert.equal(normaliseArchitecture("amd64"), "x64");
  assert.equal(normaliseArchitecture("x64"), "x64");
  assert.equal(normaliseArchitecture("aarch64"), "arm64");
  assert.equal(normaliseArchitecture("arm64"), "arm64");
  assert.equal(normaliseArchitecture(" X86_64 "), "x64");
});

test("an architecture nothing recognises is passed through, not guessed", () => {
  assert.equal(normaliseArchitecture("riscv64"), "riscv64");
  assert.equal(normaliseArchitecture("s390x"), "s390x");
});

test("operating systems are lowercased, and Node's win32 is windows", () => {
  assert.equal(normaliseOperatingSystem("linux"), "linux");
  assert.equal(normaliseOperatingSystem("Windows"), "windows");
  assert.equal(normaliseOperatingSystem("win32"), "windows");
});

const engine = (info: EngineInfo) => async () => info;
const failing = async (): Promise<EngineInfo> => {
  throw new Error("connect ENOENT //./pipe/docker_engine");
};

test("the engine's platform wins over the host's", async () => {
  // Docker Desktop on Windows, as it actually answers.
  const report = platformReporter(engine({ OSType: "linux", Architecture: "x86_64" }));
  assert.deepEqual(await report(), { os: "linux", arch: "x64" });
});

test("Windows containers mode reports windows", async () => {
  const report = platformReporter(engine({ OSType: "windows", Architecture: "x86_64" }));
  assert.deepEqual(await report(), { os: "windows", arch: "x64" });
});

test("an engine that cannot be reached falls back to the host", async () => {
  const report = platformReporter(failing);
  assert.deepEqual(await report(), { os: operatingSystem(), arch: architecture() });
});

test("an engine that has answered once is not forgotten when it stops answering", async () => {
  let up = true;
  const report = platformReporter(async () => {
    if (!up) throw new Error("Docker Desktop is restarting");
    return { OSType: "linux", Architecture: "aarch64" };
  });

  assert.deepEqual(await report(), { os: "linux", arch: "arm64" });
  up = false;
  // Not the host's values: a restarting engine has not changed platform.
  assert.deepEqual(await report(), { os: "linux", arch: "arm64" });
});

test("a hung engine does not hold the caller past the timeout", async () => {
  const report = platformReporter(() => new Promise<EngineInfo>(() => {}), 50);
  const started = Date.now();
  assert.deepEqual(await report(), { os: operatingSystem(), arch: architecture() });
  assert.ok(Date.now() - started < 2_000, "answered promptly");
});

test("a field the engine leaves out is taken from the host, field by field", async () => {
  const report = platformReporter(engine({ OSType: "linux" }));
  assert.deepEqual(await report(), { os: "linux", arch: architecture() });
});

/* A new node has no data root yet. Measuring nothing reported 0 bytes,
   the panel floored it to 1 GB, and every game was refused for storage. */
test("disk is measured on the filesystem a data root that does not exist yet will live on", async () => {
  const missing = path.join(process.cwd(), "not", "created", "yet", String(Date.now()));
  const measured = await diskBytes(missing);
  const existing = await diskBytes(process.cwd());
  assert.ok(measured.total > 0, "not zero");
  assert.equal(measured.total, existing.total, "the same filesystem as its nearest existing parent");
});

/* The platform has to reach the panel by both routes: registration, and
   every heartbeat after it, which is what corrects a node that registered
   with the wrong answer. */
test("registration and the heartbeat both carry the engine's platform", async () => {
  const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
  let heartbeat!: () => void;
  const beat = new Promise<void>((resolve) => (heartbeat = resolve));

  const panel: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      bodies.push({ path: req.url ?? "", body: JSON.parse(raw) as Record<string, unknown> });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ node: "win-node-01", approved: false, state: "pending" }));
      if (req.url === "/api/v1/nodes/heartbeat") heartbeat();
    });
  });
  await new Promise<void>((resolve) => panel.listen(0, "127.0.0.1", resolve));
  const { port } = panel.address() as AddressInfo;

  const config: Config = {
    port: 0,
    host: "127.0.0.1",
    token: "t".repeat(40),
    nodeName: "win-node-01",
    sampleIntervalMs: 15_000,
    managedLabel: "gg.geeboard.test",
    dataRoot: process.cwd(),
    pullTimeoutMs: 1_000,
    panelUrl: `http://127.0.0.1:${port}`,
    registrationToken: "gbn_0123456789abcdef",
    advertiseUrl: "http://127.0.0.1:8080",
    capabilities: [],
    version: "0.1.0",
  };

  const client = panelClient(config, async () => ({ os: "linux", arch: "x64" }))!;
  const log = console.log;
  console.log = () => {};
  let stop: (() => void) | null = null;
  try {
    await client.register();
    stop = client.startHeartbeat();
    await beat;
  } finally {
    stop?.();
    console.log = log;
    await new Promise<void>((resolve) => panel.close(() => resolve()));
  }

  const registration = bodies.find((b) => b.path === "/api/v1/nodes/register");
  const heartbeatBody = bodies.find((b) => b.path === "/api/v1/nodes/heartbeat");
  assert.equal(registration?.body.os, "linux");
  assert.equal(registration?.body.arch, "x64");
  assert.equal(heartbeatBody?.body.os, "linux");
  assert.equal(heartbeatBody?.body.arch, "x64");
  const size = heartbeatBody?.body.resources as { diskTotalGb?: number } | undefined;
  assert.ok((size?.diskTotalGb ?? 0) >= 1, "the heartbeat carries the node's size");
});
