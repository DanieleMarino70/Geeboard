import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/* A request to an address somebody else chose, made so that the check on
   that address cannot be walked around.

   The usual way to check an address is to look the name up, judge what came
   back, and then call the name — which looks it up again. Whoever runs the
   name's DNS answers the first lookup with a public address and the second
   with 169.254.169.254, and the check has judged one place and called
   another. So here a name is looked up once, every address it gave is handed
   to the caller's `judge`, and the connection goes to one of the addresses
   that were judged, by number. The name stays the name only where it has to:
   the Host header, and the certificate, which is still checked against it.

   Three more things it does not do, on purpose. It never follows a redirect
   — a 302 to somewhere internal is the other well-worn way round — and
   returns it as the answer. It never reads more than `maxBytes` of what comes
   back. And what it says when something goes wrong is a fixed phrase and
   never the text of the error, which carries the address that was tried.

   This has no `server-only` marker because it holds no secret and is
   tested directly; it imports Node's network modules, so it cannot be
   bundled for a browser either way. */

export type AddressJudge = (addresses: string[]) => { ok: true } | { ok: false; reason: string };

export interface GuardedOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** For the whole call, connecting and answering. */
  timeoutMs?: number;
  /** More than this of the answer is not read. */
  maxBytes?: number;
  /** Decides, from every address the host has, whether the call may be made. */
  judge: AddressJudge;
  /** Tests only: how a name becomes addresses. The default is the system's resolver. */
  resolve?: (host: string) => Promise<string[]>;
}

/** The address was judged and refused, before anything was connected to. `message` is for a person. */
export class GuardedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardedRefusal";
  }
}

/** The call was allowed and did not work. `message` is a fixed phrase: no address, no token, no response text. */
export class GuardedFailure extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "GuardedFailure";
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 8 * 1024;
/** How many of a name's addresses are tried before giving up. */
const MAX_ADDRESSES = 3;

async function systemResolve(host: string): Promise<string[]> {
  const found = await dnsLookup(host, { all: true, verbatim: true });
  return found.map((f) => f.address);
}

/** A name's addresses, IPv4 first: a name with a broken IPv6 route should not cost the first attempt. */
function ordered(addresses: string[]): string[] {
  return [...addresses.filter((a) => isIP(a) === 4), ...addresses.filter((a) => isIP(a) === 6)];
}

const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT", "ECONNRESET", "EADDRNOTAVAIL"]);

function describeFailure(error: unknown): GuardedFailure {
  const code = (error as { code?: string } | null)?.code ?? null;
  if (error instanceof GuardedFailure) return error;
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT" || (error as Error | null)?.message === "timeout") {
    return new GuardedFailure("did not answer in time", "timeout");
  }
  if (code === "ECONNREFUSED") return new GuardedFailure("refused the connection", code);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new GuardedFailure("does not resolve", code);
  if (code === "ECONNRESET") return new GuardedFailure("closed the connection", code);
  if (typeof code === "string" && (code.startsWith("CERT_") || code.startsWith("ERR_TLS") || code.includes("SELF_SIGNED") || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "DEPTH_ZERO_SELF_SIGNED_CERT")) {
    return new GuardedFailure("presented a certificate the panel does not trust", code);
  }
  return new GuardedFailure("could not be reached", code);
}

function once(url: URL, address: string, options: GuardedOptions, started: number): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const secure = url.protocol === "https:";
  const family = isIP(address) === 6 ? 6 : 4;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  return new Promise<Response>((resolve, reject) => {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return reject(new GuardedFailure("did not answer in time", "timeout"));

    const req = (secure ? https : http).request(
      {
        hostname,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        // The name stays the name in Host, unless the caller signed one of its own: a signature covers it.
        headers: { host: url.host, ...options.headers },
        // The name is not looked up again: this hands back the address that was judged.
        lookup: (_host, lookupOptions, callback) => {
          if ((lookupOptions as { all?: boolean }).all) {
            (callback as unknown as (err: null, found: Array<{ address: string; family: number }>) => void)(null, [{ address, family }]);
          } else {
            callback(null, address, family);
          }
        },
        // The certificate is checked against the name; an address has none to check, and is not sent as one.
        ...(secure && isIP(hostname) === 0 ? { servername: hostname } : {}),
        // No pooled socket from an earlier call, which may be connected somewhere else.
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= maxBytes) chunks.push(chunk);
          else {
            const room = maxBytes - (size - chunk.length);
            if (room > 0) chunks.push(chunk.subarray(0, room));
            // Enough: what is left is not read, and the connection is dropped.
            res.destroy();
          }
        });
        const finish = () => {
          const status = res.statusCode ?? 0;
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
          }
          const bodiless = status === 204 || status === 205 || status === 304;
          resolve(new Response(bodiless ? null : Buffer.concat(chunks), { status, headers }));
        };
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", () => finish());
      },
    );

    const timer = setTimeout(() => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), remaining);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("close", () => clearTimeout(timer));
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/**
 * The call. Throws `GuardedRefusal` when any address of the host is one the
 * caller's judge does not allow, and `GuardedFailure` when the call was
 * allowed and did not work. Any other answer is a Response, redirects and
 * errors included.
 */
export async function guardedFetch(url: URL, options: GuardedOptions): Promise<Response> {
  const started = Date.now();
  const bare = url.hostname.replace(/^\[|\]$/g, "");

  let addresses: string[];
  if (isIP(bare) !== 0) {
    addresses = [bare];
  } else {
    try {
      addresses = await (options.resolve ?? systemResolve)(bare);
    } catch (error) {
      throw describeFailure(error instanceof Error && !(error as { code?: string }).code ? Object.assign(error, { code: "ENOTFOUND" }) : error);
    }
  }

  const verdict = options.judge(addresses);
  if (!verdict.ok) throw new GuardedRefusal(verdict.reason);

  let last: unknown = null;
  for (const address of ordered(addresses).slice(0, MAX_ADDRESSES)) {
    try {
      return await once(url, address, options, started);
    } catch (error) {
      last = error;
      // Only a connection that did not happen is worth another address; anything else would be the same again.
      const code = (error as { code?: string } | null)?.code;
      if (!(typeof code === "string" && CONNECT_ERRORS.has(code))) break;
    }
  }
  throw describeFailure(last);
}
