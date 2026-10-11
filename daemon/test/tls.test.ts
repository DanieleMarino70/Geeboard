import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { connect } from "node:tls";
import WebSocket from "ws";
import { platformReporter } from "../src/capabilities.ts";
import { tlsFilesFor, type Config } from "../src/config.ts";
import type { DockerEngine } from "../src/docker.ts";
import { fingerprintOf } from "../src/panel-ca.ts";
import { Pulls } from "../src/pulls.ts";
import { buildServer } from "../src/server.ts";
import { TerminalSessions } from "../src/terminal.ts";
import { TlsFileError, loadOrCreateTls, selfSignedCertificate, tlsFilesBeside } from "../src/tls.ts";

/* The agent's certificate and the one port that answers https and plain http (src/tls.ts).

   What these hold in place: the certificate is one a TLS client takes and whose fingerprint is what the agent says it is; the files
   are made once and never replaced by the agent itself, because a new certificate is a node the panel stops reaching; and the port
   answers a panel that pinned the certificate over https and a panel that never heard of it (0.10.1, rolled back) over plain http,
   console stream included, both at once. */

const TOKEN = "tls-test-token-that-is-long-enough-xxxx";
let dir: string;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "geeboard-tls-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("the certificate is self-signed, not an authority, and does not expire", () => {
  const made = selfSignedCertificate("fra-node-02");
  const certificate = new X509Certificate(made.cert);
  assert.equal(certificate.subject, "CN=fra-node-02");
  assert.equal(certificate.issuer, certificate.subject);
  assert.ok(certificate.verify(certificate.publicKey), "signed by its own key");
  assert.equal(certificate.ca, false, "a leaf, so it cannot sign anything else somebody would then trust");
  assert.match(certificate.validTo, /9999/);
  assert.ok(new Date(certificate.validFrom).getTime() < Date.now(), "valid already, for a panel whose clock is a little behind");
  assert.notEqual(fingerprintOf(certificate), fingerprintOf(new X509Certificate(selfSignedCertificate("fra-node-02").cert)), "a new key every time");
});

/* The serial is random, and one in 256 of them starts with a zero byte the encoding must drop: CI met one, and OpenSSL refused
   the certificate with "illegal padding". Two thousand certificates meet such a serial all but certainly. */
test("every certificate made is one OpenSSL reads, whatever its random serial", () => {
  for (let i = 0; i < 2000; i++) {
    const made = selfSignedCertificate("fra-node-02");
    assert.doesNotThrow(() => new X509Certificate(made.cert), `certificate ${i} is not readable:\n${made.cert}`);
  }
});

test("the files sit beside the agent file, named after it, and only where there is a place for them", () => {
  assert.deepEqual(tlsFilesBeside(path.join("etc", "geeboard", "agent.json")), {
    keyFile: path.join("etc", "geeboard", "agent.tls.key"),
    certFile: path.join("etc", "geeboard", "agent.tls.crt"),
  });
  assert.equal(tlsFilesBeside("fra-node-02.json").keyFile, "fra-node-02.tls.key", "a second agent on the account has its own");

  assert.equal(tlsFilesFor({}, null), null, "configured from the environment alone: no file to put them beside");
  assert.equal(tlsFilesFor({}, "agent.json")?.certFile, "agent.tls.crt");
  assert.equal(tlsFilesFor({ GEEBOARD_TLS_DIR: dir }, null)?.keyFile, path.join(dir, "agent.tls.key"), "GEEBOARD_TLS_DIR is a place");
  assert.equal(tlsFilesFor({ GEEBOARD_TLS: "off" }, "agent.json"), null, "GEEBOARD_TLS=off is plain http only");
  assert.equal(tlsFilesFor({ GEEBOARD_TLS: "on" }, "agent.json")?.keyFile, "agent.tls.key");
});

test("made once, then read: the same fingerprint at every start", async () => {
  const files = tlsFilesBeside(path.join(dir, "once.json"));
  const first = loadOrCreateTls(files, "once");
  assert.equal(first.created, true);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
  const again = loadOrCreateTls(files, "once");
  assert.equal(again.created, false);
  assert.equal(again.fingerprint, first.fingerprint);
  assert.equal(again.fingerprint, fingerprintOf(new X509Certificate(await readFile(files.certFile, "utf8"))));
});

test("a file that cannot be used is a sentence, and nothing is written over it", async () => {
  const files = tlsFilesBeside(path.join(dir, "broken.json"));
  loadOrCreateTls(files, "broken");
  const key = await readFile(files.keyFile, "utf8");

  await writeFile(files.certFile, "not a certificate");
  assert.throws(() => loadOrCreateTls(files, "broken"), (error: Error) => error instanceof TlsFileError && /is not a certificate/.test(error.message) && /joined again/.test(error.message));
  assert.equal(await readFile(files.certFile, "utf8"), "not a certificate", "left as it was");
  assert.equal(await readFile(files.keyFile, "utf8"), key);

  // Another key's certificate: refused, not paired.
  await writeFile(files.certFile, selfSignedCertificate("other").cert);
  assert.throws(() => loadOrCreateTls(files, "broken"), /is not the certificate of/);

  // Half there: refused, not completed with a new half.
  await rm(files.certFile);
  assert.throws(() => loadOrCreateTls(files, "broken"), /is there and .* is not/);
  await assert.rejects(readFile(files.certFile), "no certificate was made for the key that was left");
});

/* ── The listener ───────────────────────────────────────────────── */

const engine = {
  ping: async () => {},
  info: async () => ({ OSType: "linux", Architecture: "x86_64", MemTotal: 1 << 30 }),
  follow: async (_id: string, onLine: (line: string, stderr: boolean, at?: string) => void) => {
    setTimeout(() => onLine("a line of the console", false), 20);
    return () => {};
  },
} as unknown as DockerEngine;

function config(): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    token: TOKEN,
    tokenFromEnvironment: true,
    nodeName: "tls-node",
    sampleIntervalMs: 15_000,
    managedLabel: "gg.geeboard.test",
    containerPrefix: "geeboard-test-",
    dataRoot: dir,
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
  };
}

async function start() {
  const tls = loadOrCreateTls(tlsFilesBeside(path.join(dir, "listener.json")), "tls-node");
  const agent = buildServer({
    config: config(),
    engine,
    pulls: new Pulls({ open: async () => { throw new Error("no pulls here"); }, present: async () => true }, 120_000),
    platform: platformReporter(() => engine.info()),
    terminal: new TerminalSessions({ enabled: false, shell: null, maxSessions: 1, idleMs: 1000, maxMs: 1000 }, { reason: "not under test" }),
    tls,
    limits: { helloMs: 2_000 },
  });
  await new Promise<void>((resolve) => agent.server.listen(0, "127.0.0.1", resolve));
  return { agent, tls, port: (agent.server.address() as AddressInfo).port };
}

/** An https GET that trusts nothing and reports what it was shown, as a pinning client sees it before it decides. */
function httpsGet(port: number, target: string): Promise<{ status: number; body: string; presented: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: target, rejectUnauthorized: false, headers: { authorization: `Bearer ${TOKEN}` } }, (res) => {
      const presented = (res.socket as import("node:tls").TLSSocket).getPeerCertificate().fingerprint256.replace(/:/g, "").toLowerCase();
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, presented }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("one port answers https with the agent's certificate, and plain http as before", async () => {
  const { agent, tls, port } = await start();
  try {
    const secure = await httpsGet(port, "/terminal");
    assert.equal(secure.status, 200);
    assert.equal(secure.presented, tls.fingerprint, "the certificate on the wire is the one whose fingerprint the agent sends");

    // What a panel of 0.10.1 does: plain http, the same port, the same token.
    const plain = await fetch(`http://127.0.0.1:${port}/terminal`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(plain.status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
    assert.equal((await httpsGet(port, "/health")).status, 200);

    // Either way, the token is still asked for.
    assert.equal((await fetch(`http://127.0.0.1:${port}/terminal`)).status, 401);
  } finally {
    await agent.shutdown(500);
  }
});

test("the console streams over wss and over ws", async () => {
  const { agent, port } = await start();
  try {
    for (const scheme of ["wss", "ws"]) {
      const first = await new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${scheme}://127.0.0.1:${port}/servers/abc/console`, {
          headers: { authorization: `Bearer ${TOKEN}` },
          rejectUnauthorized: false,
        });
        ws.on("message", (raw) => {
          resolve(String(raw));
          ws.close();
        });
        ws.on("error", reject);
      });
      assert.equal((JSON.parse(first) as { line: string }).line, "a line of the console", scheme);
    }
  } finally {
    await agent.shutdown(500);
  }
});

test("a connection that says nothing, or begins a handshake and stops, is closed, and the agent goes on", async () => {
  const { agent, port } = await start();
  try {
    // How long the agent keeps a connection that sends `first` (or nothing) and then stays quiet. The limit is two seconds here.
    const keptFor = (first: Buffer | null) =>
      new Promise<number>((resolve) => {
        const started = Date.now();
        const raw = net.connect(port, "127.0.0.1", () => {
          if (first) raw.write(first);
        });
        raw.on("error", () => {});
        raw.on("close", () => resolve(Date.now() - started));
      });
    const silent = await keptFor(null);
    assert.ok(silent >= 1_500 && silent < 5_000, `silent: closed after ${silent} ms`);
    // Half a handshake: the one byte that says TLS, then nothing.
    const half = await keptFor(Buffer.from([0x16]));
    assert.ok(half >= 1_500 && half < 5_000, `half a handshake: closed after ${half} ms`);
    // And a pinning client is not affected by either.
    const tlsSocket = connect({ host: "127.0.0.1", port, rejectUnauthorized: false });
    await new Promise<void>((resolve, reject) => {
      tlsSocket.once("secureConnect", () => resolve());
      tlsSocket.once("error", reject);
    });
    tlsSocket.destroy();
    assert.equal((await httpsGet(port, "/health")).status, 200, "still answering");
  } finally {
    await agent.shutdown(500);
  }
});
