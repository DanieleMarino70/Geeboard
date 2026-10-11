import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { X509Certificate } from "node:crypto";
import { after, before, test } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { readFileSync } from "node:fs";
import path from "node:path";
import { plainHttpRisk } from "../src/domain/access/terminal.ts";
import {
  channelWords,
  cleanFingerprint,
  offeredPin,
  pinAtRegistration,
  pinFromHeartbeat,
  pinNeedsApproval,
} from "../src/domain/nodes/tls-pin.ts";
import { classifyFetchFailure, describeReach } from "../src/domain/runtime/reach.ts";
import { PinMismatchError, pinnedAddress, pinnedAgent, pinnedFetch } from "../src/lib/agent-tls.ts";

/* The panel's side of the agent's https (lib/agent-tls.ts, domain/nodes/tls-pin.ts): when a certificate is pinned, and that a pinned call
   goes to that certificate and to no other. The servers here are real TLS servers with certificates made the way the agent makes its own
   (daemon/src/tls.ts), so what is proved is the handshake a node would see, and that a server with another certificate never receives a
   byte of the request — the token is the first thing in it. */

const fingerprintOf = (pem: string) => new X509Certificate(pem).fingerprint256.replace(/:/g, "").toLowerCase();
const A = "a".repeat(64);
const B = "b".repeat(64);

/* ── When a pin is set ─────────────────────────────────────────── */

test("a fingerprint is read in the forms an agent or a person writes it, and nothing else is one", () => {
  assert.equal(cleanFingerprint(A), A);
  assert.equal(cleanFingerprint(`sha256:${A.toUpperCase()}`), A);
  assert.equal(cleanFingerprint(A.match(/../g)!.join(":")), A);
  for (const bad of [undefined, null, 42, "", "sha256:", "a".repeat(63), "g".repeat(64), `${A}00`]) assert.equal(cleanFingerprint(bad), null, String(bad));
});

test("an agent offers a pin with the feature, a fingerprint and a plain http address, and not otherwise", () => {
  assert.equal(offeredPin({ features: ["tls"], tlsFingerprint: A }, "http://10.0.0.5:8080"), A);
  assert.equal(offeredPin({ features: [], tlsFingerprint: A }, "http://10.0.0.5:8080"), null, "the feature is the announcement");
  assert.equal(offeredPin({ tlsFingerprint: A }, "http://10.0.0.5:8080"), null, "an agent before the feature list");
  assert.equal(offeredPin({ features: ["tls"] }, "http://10.0.0.5:8080"), null);
  assert.equal(offeredPin({ features: ["tls"], tlsFingerprint: "nonsense" }, "http://10.0.0.5:8080"), null);
  // An https address is TLS somebody put in front of the agent: the agent's own certificate is not the one shown there.
  assert.equal(offeredPin({ features: ["tls"], tlsFingerprint: A }, "https://node.example.net"), null);
});

test("registration pins a first certificate, keeps the same one, and a new one or none sends the node back to a person", () => {
  assert.deepEqual(pinAtRegistration(null, A), { pin: A, change: "first" });
  assert.deepEqual(pinAtRegistration(null, null), { pin: null, change: "none" });
  assert.deepEqual(pinAtRegistration(A, A), { pin: A, change: "kept" });
  assert.deepEqual(pinAtRegistration(A, B), { pin: B, change: "replaced" });
  assert.deepEqual(pinAtRegistration(A, null), { pin: null, change: "dropped" });
  assert.equal(pinNeedsApproval("first"), false, "a node joined before 0.11 rejoined by a 0.11 agent keeps its approval");
  assert.equal(pinNeedsApproval("kept"), false);
  assert.equal(pinNeedsApproval("replaced"), true);
  assert.equal(pinNeedsApproval("dropped"), true, "an agent that stops offering https would put the token back on the wire");
});

test("a heartbeat pins only where there is no pin, and never replaces one", () => {
  assert.equal(pinFromHeartbeat(null, A), A);
  assert.equal(pinFromHeartbeat(null, null), null);
  assert.equal(pinFromHeartbeat(A, B), null);
  assert.equal(pinFromHeartbeat(A, A), null);
});

test("the channel is said in words, with digits a person can compare with the agent's log", () => {
  assert.equal(channelWords(null), "plain http");
  assert.equal(channelWords(A), `https, pinned sha256:${"a".repeat(12)}…`);
});

test("a pinned node is called at https on its own port, and its stored address keeps the http a rolled-back panel calls", () => {
  assert.equal(pinnedAddress("http://10.0.0.5:8080"), "https://10.0.0.5:8080");
  assert.equal(pinnedAddress("http://[2001:db8::5]:8080"), "https://[2001:db8::5]:8080");
});

test("a pinned node at a public address may carry a terminal: it is not plain http any more", () => {
  assert.ok(plainHttpRisk("http://203.0.113.10:8080"));
  assert.equal(plainHttpRisk("http://203.0.113.10:8080", A), null);
});

test("a certificate that is not the pinned one, and an agent that answers without TLS, are each said for what they are", () => {
  const mismatch = classifyFetchFailure(new TypeError("fetch failed", { cause: new PinMismatchError(A, B) }), { pinned: true });
  assert.deepEqual(mismatch, { fault: "pin-mismatch", code: "AGENT_CERT_MISMATCH" });
  const said = describeReach(mismatch, { node: "fra-node-02", address: "https://203.0.113.10:8080" });
  assert.match(said, /not the one this panel pinned/);
  assert.match(said, /nothing was sent/);
  assert.match(said, /join the node again/);

  const old = Object.assign(new Error("packet length too long"), { code: "ERR_SSL_PACKET_LENGTH_TOO_LONG" });
  assert.equal(classifyFetchFailure(new TypeError("fetch failed", { cause: old }), { pinned: true }).fault, "no-tls");
  assert.notEqual(classifyFetchFailure(new TypeError("fetch failed", { cause: old })).fault, "no-tls", "only a pinned call reads it so");
});

/* ── Pinned calls, to real servers ─────────────────────────────── */

// Made by the agent's own selfSignedCertificate (daemon/src/tls.ts), kept as files: see fixtures/agent-tls/README.md for why.
const fixture = (name: string) => ({
  key: readFileSync(path.join(import.meta.dirname, "fixtures", "agent-tls", `${name}.tls.key`), "utf8"),
  cert: readFileSync(path.join(import.meta.dirname, "fixtures", "agent-tls", `${name}.tls.crt`), "utf8"),
});
const mine = fixture("agent");
const other = fixture("other");
const MINE = fingerprintOf(mine.cert);

let secure: Server;
let impostor: Server;
let plain: Server;
const heard: string[] = [];
const impostorHeard: string[] = [];

function answer(log: string[]) {
  return (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    log.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, echo: body }));
    });
  };
}

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
let securePort: number;
let impostorPort: number;
let plainPort: number;

before(async () => {
  secure = createHttpsServer({ key: mine.key, cert: mine.cert }, answer(heard));
  const wss = new WebSocketServer({ server: secure });
  wss.on("connection", (ws, req) => ws.send(`hello ${req.headers.authorization ?? ""}`));
  impostor = createHttpsServer({ key: other.key, cert: other.cert }, answer(impostorHeard));
  impostor.on("upgrade", (req) => impostorHeard.push(`UPGRADE ${req.headers.authorization ?? ""}`));
  plain = createHttpServer(answer([]));
  [securePort, impostorPort, plainPort] = await Promise.all([listen(secure), listen(impostor), listen(plain)]);
});

after(() => {
  for (const server of [secure, impostor, plain]) {
    server.closeAllConnections?.();
    server.close();
  }
});

test("a pinned call reaches the agent whose certificate it pinned, body and headers as fetch sends them", async () => {
  const res = await pinnedFetch(`https://127.0.0.1:${securePort}/servers?x=1`, { method: "POST", body: '{"a":1}', headers: { authorization: "Bearer token-1" } }, MINE);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, echo: '{"a":1}' });
  assert.ok(heard.includes("POST /servers?x=1 Bearer token-1"));
});

test("a stream is sent as a stream", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("part one, "));
      controller.enqueue(new TextEncoder().encode("part two"));
      controller.close();
    },
  });
  const res = await pinnedFetch(`https://127.0.0.1:${securePort}/files/raw`, { method: "PUT", body, duplex: "half" } as RequestInit, MINE);
  assert.equal(((await res.json()) as { echo: string }).echo, "part one, part two");
});

test("another certificate is refused before a byte of the request is written: the token never reaches it", async () => {
  await assert.rejects(
    pinnedFetch(`https://127.0.0.1:${impostorPort}/version`, { headers: { authorization: "Bearer secret-token" } }, MINE),
    (error: Error) => {
      const cause = (error as { cause?: unknown }).cause;
      assert.ok(cause instanceof PinMismatchError, String(cause));
      assert.equal(cause.presented, fingerprintOf(other.cert));
      assert.equal(classifyFetchFailure(error, { pinned: true }).fault, "pin-mismatch");
      return true;
    },
  );
  // Given the time a request written anyway would need to arrive.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(impostorHeard, [], "the impostor heard nothing");
});

test("the WebSocket of a console goes through the same check", async () => {
  const greeting = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${securePort}/servers/x/console`, { headers: { authorization: "Bearer ws-token" }, agent: pinnedAgent(MINE) });
    ws.on("message", (raw) => {
      resolve(String(raw));
      ws.close();
    });
    ws.on("error", reject);
  });
  assert.equal(greeting, "hello Bearer ws-token");

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(`wss://127.0.0.1:${impostorPort}/servers/x/console`, { headers: { authorization: "Bearer ws-secret" }, agent: pinnedAgent(MINE) });
    ws.on("error", (error) => {
      assert.ok(error instanceof PinMismatchError, String(error));
      resolve();
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(impostorHeard, [], "no upgrade, and no token, reached the impostor");
});

test("a pinned call to an agent that answers only plain http fails as that, not as a mystery", async () => {
  await assert.rejects(pinnedFetch(`https://127.0.0.1:${plainPort}/health`, {}, MINE), (error: Error) => {
    assert.equal(classifyFetchFailure(error, { pinned: true }).fault, "no-tls", JSON.stringify(classifyFetchFailure(error, { pinned: true })));
    return true;
  });
});

test("a timeout is the signal's own reason, as fetch gives it", async () => {
  const silent = createHttpsServer({ key: mine.key, cert: mine.cert }, () => {});
  const port = await listen(silent);
  try {
    await assert.rejects(pinnedFetch(`https://127.0.0.1:${port}/slow`, { signal: AbortSignal.timeout(200) }, MINE), (error: Error) => {
      assert.equal(error.name, "TimeoutError");
      assert.equal(classifyFetchFailure(error, { pinned: true }).fault, "timeout");
      return true;
    });
  } finally {
    silent.closeAllConnections();
    silent.close();
  }
});
