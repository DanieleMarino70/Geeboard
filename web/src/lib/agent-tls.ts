import { Agent as HttpsAgent, request } from "node:https";
import type { ClientRequestArgs, IncomingMessage } from "node:http";
import { Readable, type Duplex } from "node:stream";
import { connect, type ConnectionOptions, type TLSSocket } from "node:tls";
import { cleanFingerprint, shortFingerprint } from "@/domain/nodes/tls-pin";

/* Calling an agent over https, to the one certificate it registered with.

   An agent from 0.11 makes a key and a self-signed certificate the first time it starts and sends the certificate's SHA-256 when it
   registers (daemon/src/tls.ts). The panel keeps it with the node (`tlsFingerprint`) and from then on calls that node only over https
   and only to that certificate: pinning, not a certificate authority, which is how the node already trusts the panel's own authority the
   other way round (daemon/src/panel-ca.ts). No certificate is "trusted" here in the browser's sense; the one question asked of the
   connection is whether the certificate it presented has that SHA-256.

   It is asked before a byte of the request is written. A TLS client writes what it is given as soon as the handshake ends, and the
   request begins with the bearer token, so a check made after the socket was handed over would be a check made after the token had
   gone to whoever answered. Here the socket is handed to the request only once the fingerprint matched (`createConnection`, in its
   asynchronous form, which Node documents for exactly this).

   Node's own fetch cannot be given such a connection without the undici package, which the panel does not carry; so a pinned call is
   made with node:https and answered as a fetch Response, and the WebSockets (console, terminal) take the same agent. */

/* The address a pinned node is called at: its advertised address with https in place of http, the same host and port, because the
   agent answers both on one port. The stored address keeps its http, so a panel rolled back to 0.10.1, which does not know the pin, calls
   what it always called. */
export function pinnedAddress(daemonUrl: string): string {
  const url = new URL(daemonUrl);
  if (url.protocol === "http:") url.protocol = "https:";
  return url.toString().replace(/\/$/, "");
}

/* The certificate an agent presented was not the one pinned for it. Nothing was sent: the connection was closed after the handshake,
   before the request. Either the agent's certificate was replaced (its files removed, the machine rebuilt), which a new join pins, or
   something between the panel and the node answered in its place. */
export class PinMismatchError extends Error {
  readonly code = "AGENT_CERT_MISMATCH";
  constructor(
    readonly pinned: string,
    readonly presented: string | null,
  ) {
    super(`the agent presented certificate ${presented ? shortFingerprint(presented) : "none"}, not the pinned ${shortFingerprint(pinned)}`);
    this.name = "PinMismatchError";
  }
}

/** The SHA-256 of the certificate a TLS socket was shown, as the column keeps it. */
function presentedBy(socket: TLSSocket): string | null {
  const certificate = socket.getPeerCertificate();
  return certificate && typeof certificate.fingerprint256 === "string" ? cleanFingerprint(certificate.fingerprint256) : null;
}

/* An https agent whose every connection is checked against one fingerprint before it is used. The chain is not verified
   (`rejectUnauthorized: false`): the certificate is self-signed, and the fingerprint is a stronger statement than any chain. */
class PinnedAgent extends HttpsAgent {
  constructor(private readonly fingerprint: string) {
    // No TLS session is resumed: every connection makes a full handshake, so every one has a certificate to check.
    super({ keepAlive: true, maxCachedSessions: 0 });
  }

  override createConnection(options: ClientRequestArgs, callback?: (error: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    const socket = connect({ ...(options as ConnectionOptions), rejectUnauthorized: false, session: undefined });
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      callback?.(error, socket);
    };
    socket.once("secureConnect", () => {
      const presented = presentedBy(socket);
      if (presented !== this.fingerprint) {
        socket.destroy();
        settle(new PinMismatchError(this.fingerprint, presented));
        return;
      }
      settle(null);
    });
    socket.once("error", (error) => settle(error));
    // Nothing returned: the request is given the socket by the callback, after the check, and not before.
    return undefined;
  }
}

/* One agent per fingerprint, for the process: its sockets are kept alive between a poll's calls, and a fingerprint is a node's for as
   long as it is pinned. Bounded, because a fleet re-pinned many times over a long uptime would otherwise keep every old one. */
const agents = new Map<string, PinnedAgent>();

export function pinnedAgent(fingerprint: string): HttpsAgent {
  let agent = agents.get(fingerprint);
  if (!agent) {
    if (agents.size >= 256) {
      for (const old of agents.values()) old.destroy();
      agents.clear();
    }
    agent = new PinnedAgent(fingerprint);
    agents.set(fingerprint, agent);
  }
  return agent;
}

/* fetch, for a pinned node: the same request (method, headers, a string or a stream as the body, a signal) and the same Response, made
   over node:https with the pinned agent. Failures are thrown as fetch throws them, a TypeError whose cause carries the code, so the
   sentences of domain/runtime/reach.ts read them the same way; a timeout is the signal's own reason, as with fetch. A redirect is not
   followed, and with `redirect: "error"` it is refused, as the agent never sends one. */
export function pinnedFetch(url: URL | string, init: RequestInit, fingerprint: string): Promise<Response> {
  const target = new URL(url);
  const signal = init.signal ?? undefined;
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const body = init.body;
  if (typeof body === "string") headers["content-length"] = String(Buffer.byteLength(body));

  return new Promise<Response>((resolve, reject) => {
    const failed = (error: unknown) => {
      if (signal?.aborted) reject(signal.reason);
      else reject(new TypeError("fetch failed", { cause: error }));
    };
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const req = request(
      {
        protocol: "https:",
        hostname: target.hostname.replace(/^\[|\]$/g, ""),
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? "GET",
        headers,
        agent: pinnedAgent(fingerprint),
        signal,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && init.redirect === "error") {
          res.destroy();
          failed(new Error("the agent answered with a redirect"));
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const one of Array.isArray(value) ? value : [value]) responseHeaders.append(key, one);
        }
        const empty = status === 204 || status === 205 || status === 304 || init.method === "HEAD";
        if (empty) res.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
            status,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
          }),
        );
      },
    );
    req.on("error", failed);

    if (body === undefined || body === null) {
      req.end();
    } else if (typeof body === "string") {
      req.end(body);
    } else if (body instanceof ReadableStream) {
      const stream = Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
      stream.on("error", (error) => req.destroy(error));
      stream.pipe(req);
    } else {
      req.destroy(new Error("a pinned call takes a string or a stream as its body"));
    }
  });
}
