import dgram from "node:dgram";
import net from "node:net";

/* One exchange with a port: send these bytes, hand back what answered.

   The second primitive the panel's health checks get from a node, beside
   the bare TCP connect, and the one that was refused for a long time: an
   endpoint that writes bytes to a port on request is a port scanner with
   an HTTP interface, and teaching the node Minecraft's handshake instead
   puts game knowledge in the one place it must not go.

   What makes it acceptable is what it cannot do. The caller in docker.ts
   only ever aims it at a port the named server publishes, on this
   machine, over the transport it publishes it on — the same rule the
   connect probe has — and the only caller is the panel, which can
   already type into that game's console and write any file it reads. The
   sizes and the time are capped here. And it knows nothing: which bytes
   mean "are you there" to Minecraft, and whether the answer was one, is
   decided in the panel (web/src/domain/servers/query.ts).

   One rule is not the caller's to break. A TCP exchange never hangs up
   first while it may still be answered: vanilla Terraria 1.4.5.8 dies
   with ObjectDisposedException when a connection it has not finished
   accepting goes away, which is how the connect probe crash-looped it.
   Measured on the real image: connect-and-close killed it within five
   tries; its own hello, held until the server answered and hung up, did
   not in any number. */

export const MAX_PAYLOAD_BYTES = 1024;
export const MAX_REPLY_BYTES = 4096;
export const MAX_TIMEOUT_MS = 5_000;
/* How long a TCP reply may go quiet before it is taken as finished. A
   reply that arrives in several segments is still one reply; the node
   cannot know where it ends, only that it has stopped. */
const QUIET_MS = 250;

export type Transport = "tcp" | "udp";

export interface ExchangeRequest {
  transport: Transport;
  port: number;
  payload: Buffer;
  timeoutMs: number;
  maxBytes: number;
  host?: string;
}

export interface ExchangeResult {
  /** What came back, base64. Empty when nothing did. */
  reply: string;
  bytes: number;
  /* Why reading stopped. `refused` is a TCP port nothing listens on;
     `timeout` with no bytes is a port that took the question and never
     answered, which for a game is the interesting failure. */
  ended: "quiet" | "closed" | "full" | "timeout" | "refused" | "error";
  ms: number;
}

export class ExchangeError extends Error {}

/** Reads the request body's fields, refusing anything outside the caps. */
export function parseExchange(body: Record<string, unknown>): Omit<ExchangeRequest, "host"> {
  const port = Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ExchangeError("port must be a number between 1 and 65535");
  }
  if (body.transport !== "tcp" && body.transport !== "udp") {
    throw new ExchangeError("transport must be tcp or udp");
  }
  if (typeof body.payload !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.payload)) {
    throw new ExchangeError("payload must be base64");
  }
  const payload = Buffer.from(body.payload, "base64");
  if (payload.length === 0 || payload.length > MAX_PAYLOAD_BYTES) {
    throw new ExchangeError(`payload must be 1 to ${MAX_PAYLOAD_BYTES} bytes`);
  }
  return {
    port,
    transport: body.transport,
    payload,
    timeoutMs: clamp(body.timeoutMs, 3_000, 100, MAX_TIMEOUT_MS),
    maxBytes: clamp(body.maxBytes, 1024, 1, MAX_REPLY_BYTES),
  };
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function exchange(request: ExchangeRequest): Promise<ExchangeResult> {
  return request.transport === "tcp" ? overTcp(request) : overUdp(request);
}

function overTcp(request: ExchangeRequest): Promise<ExchangeResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const chunks: Buffer[] = [];
    let size = 0;
    let quiet: NodeJS.Timeout | undefined;
    let settled = false;

    const done = (ended: ExchangeResult["ended"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(quiet);
      socket.destroy();
      const reply = Buffer.concat(chunks).subarray(0, request.maxBytes);
      resolve({ reply: reply.toString("base64"), bytes: reply.length, ended, ms: Date.now() - started });
    };

    socket.setTimeout(request.timeoutMs, () => done("timeout"));
    socket.once("connect", () => socket.write(request.payload));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= request.maxBytes) return done("full");
      clearTimeout(quiet);
      quiet = setTimeout(() => done("quiet"), QUIET_MS);
    });
    socket.once("close", () => done("closed"));
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(error.code === "ECONNREFUSED" ? "refused" : size > 0 ? "closed" : "error"),
    );
    socket.connect(request.port, request.host ?? "127.0.0.1");
  });
}

/* One datagram out, the first one back. UDP has no "refused" worth the
   name through a port forward, so silence is a timeout. */
function overUdp(request: ExchangeRequest): Promise<ExchangeResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let settled = false;

    const done = (ended: ExchangeResult["ended"], reply = Buffer.alloc(0)) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      const kept = reply.subarray(0, request.maxBytes);
      resolve({ reply: kept.toString("base64"), bytes: kept.length, ended, ms: Date.now() - started });
    };

    const timer = setTimeout(() => done("timeout"), request.timeoutMs);
    socket.once("message", (message) => done(message.length >= request.maxBytes ? "full" : "quiet", message));
    socket.once("error", () => done("error"));
    socket.send(request.payload, request.port, request.host ?? "127.0.0.1", (error) => {
      if (error) done("error");
    });
  });
}
