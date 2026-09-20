import assert from "node:assert/strict";
import dgram from "node:dgram";
import net from "node:net";
import { test } from "node:test";
import { ExchangeError, MAX_PAYLOAD_BYTES, exchange, parseExchange } from "../src/exchange.ts";

/* The exchange probe against sockets on this machine — no Docker, no
   game. What is checked here is the node's half: the caps, and that it
   hands back what answered without hanging up first. */

function tcpServer(onData: (socket: net.Socket, data: Buffer) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("error", () => {});
      socket.on("data", (data) => onData(socket, data));
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() });
    });
  });
}

const base = { timeoutMs: 1500, maxBytes: 1024 };

test("a TCP exchange sends the payload and returns the reply", async () => {
  const server = await tcpServer((socket, data) => socket.write(Buffer.concat([Buffer.from("re:"), data])));
  try {
    const result = await exchange({ ...base, transport: "tcp", port: server.port, payload: Buffer.from("hello") });
    assert.equal(Buffer.from(result.reply, "base64").toString(), "re:hello");
    assert.equal(result.ended, "quiet");
  } finally {
    server.close();
  }
});

test("a reply in several segments is one reply", async () => {
  const server = await tcpServer((socket) => {
    socket.write("one,");
    setTimeout(() => socket.write("two"), 60);
  });
  try {
    const result = await exchange({ ...base, transport: "tcp", port: server.port, payload: Buffer.from("x") });
    assert.equal(Buffer.from(result.reply, "base64").toString(), "one,two");
  } finally {
    server.close();
  }
});

/* Terraria answers a hello with a packet and hangs up itself. The
   exchange must report that as an answer, not as a failure. */
test("a server that answers and hangs up is an answer", async () => {
  const server = await tcpServer((socket) => socket.end("bye"));
  try {
    const result = await exchange({ ...base, transport: "tcp", port: server.port, payload: Buffer.from("x") });
    assert.equal(Buffer.from(result.reply, "base64").toString(), "bye");
    assert.equal(result.ended, "closed");
  } finally {
    server.close();
  }
});

/* The rule that keeps vanilla Terraria 1.4.5.8 alive: while an answer may
   still come, the node does not close the connection. */
test("the node never hangs up before the timeout on a server that says nothing", async () => {
  let closedAfterMs = -1;
  const started = Date.now();
  const server = await new Promise<{ port: number; close: () => void }>((resolve) => {
    const s = net.createServer((socket) => {
      socket.on("error", () => {});
      // A paused socket never notices the other end going away.
      socket.resume();
      socket.on("close", () => (closedAfterMs = Date.now() - started));
    });
    s.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as net.AddressInfo).port, close: () => s.close() }));
  });
  try {
    const result = await exchange({ transport: "tcp", port: server.port, payload: Buffer.from("x"), timeoutMs: 400, maxBytes: 64 });
    assert.equal(result.ended, "timeout");
    assert.equal(result.bytes, 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(closedAfterMs >= 350, `closed after ${closedAfterMs}ms`);
  } finally {
    server.close();
  }
});

test("a port nothing listens on is refused, not an error", async () => {
  const server = await tcpServer(() => {});
  const port = server.port;
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  const result = await exchange({ ...base, transport: "tcp", port, payload: Buffer.from("x") });
  assert.equal(result.ended, "refused");
});

test("a reply is cut at the cap", async () => {
  const server = await tcpServer((socket) => socket.write(Buffer.alloc(5000, 65)));
  try {
    const result = await exchange({ transport: "tcp", port: server.port, payload: Buffer.from("x"), timeoutMs: 1500, maxBytes: 100 });
    assert.equal(result.bytes, 100);
    assert.equal(result.ended, "full");
  } finally {
    server.close();
  }
});

test("a UDP exchange returns the first datagram that answers", async () => {
  const server = dgram.createSocket("udp4");
  server.on("message", (message, from) => server.send(Buffer.concat([Buffer.from("A"), message]), from.port, from.address));
  await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
  try {
    const result = await exchange({ ...base, transport: "udp", port: server.address().port, payload: Buffer.from("info") });
    assert.equal(Buffer.from(result.reply, "base64").toString(), "Ainfo");
  } finally {
    server.close();
  }
});

test("UDP silence is a timeout with nothing in it", async () => {
  const server = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => server.bind(0, "127.0.0.1", resolve));
  try {
    const result = await exchange({ transport: "udp", port: server.address().port, payload: Buffer.from("x"), timeoutMs: 300, maxBytes: 64 });
    assert.equal(result.ended, "timeout");
    assert.equal(result.bytes, 0);
  } finally {
    server.close();
  }
});

test("the request is refused outside its caps", () => {
  const ok = { port: 25565, transport: "tcp", payload: Buffer.from("x").toString("base64") };
  assert.equal(parseExchange(ok).payload.toString(), "x");
  assert.equal(parseExchange({ ...ok, timeoutMs: 999_999 }).timeoutMs, 5000);
  assert.equal(parseExchange({ ...ok, maxBytes: 999_999 }).maxBytes, 4096);
  assert.throws(() => parseExchange({ ...ok, port: 0 }), ExchangeError);
  assert.throws(() => parseExchange({ ...ok, transport: "icmp" }), ExchangeError);
  assert.throws(() => parseExchange({ ...ok, payload: "not base64 !" }), ExchangeError);
  assert.throws(() => parseExchange({ ...ok, payload: "" }), ExchangeError);
  assert.throws(
    () => parseExchange({ ...ok, payload: Buffer.alloc(MAX_PAYLOAD_BYTES + 1).toString("base64") }),
    ExchangeError,
  );
});
