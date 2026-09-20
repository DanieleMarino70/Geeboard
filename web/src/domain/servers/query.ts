import type { QueryProtocol } from "../games/types";

/* What to say to a game to find out whether it is answering, and how to
   tell that it did.

   This is the game knowledge the node must not have. The node offers one
   exchange — these bytes to a port the server publishes, and whatever
   came back (daemon/src/exchange.ts) — and everything that makes those
   bytes a Minecraft status request rather than noise lives here, where
   it is plain data in and plain data out and can be tested with no
   socket at all.

   Each question is the smallest one the protocol allows, and an answer
   is judged on its shape alone. A health check wants to know that the
   game's network loop took a packet and replied in its own protocol; it
   does not want the player list, and parsing more than the envelope
   would turn every change of a game's status format into a server
   reported unhealthy.

   A protocol goes here only after its bytes have been sent to the real
   image and the server has been seen to survive them — a connection
   Terraria did not like was enough to crash it. What was measured is
   written on each one. */

export interface QueryPlan {
  transport: "tcp" | "udp";
  /** The definition's port id this protocol is asked on, unless the probe names another. */
  defaultPort: string;
  payload: Uint8Array;
  /** Enough of the reply to recognise it; the rest is left unread. */
  maxBytes: number;
  timeoutMs: number;
}

export interface QueryVerdict {
  ok: boolean;
  detail?: string;
}

/** How the node's read ended — see daemon/src/exchange.ts. */
export type ExchangeEnd = "quiet" | "closed" | "full" | "timeout" | "refused" | "error";

/** Null for a protocol Geeboard cannot speak yet; the health report names it as skipped. */
export function queryPlan(protocol: QueryProtocol): QueryPlan | null {
  switch (protocol) {
    case "minecraft-ping":
      return { transport: "tcp", defaultPort: "game", payload: minecraftStatusRequest(), maxBytes: 512, timeoutMs: 3_000 };
    case "source-a2s":
      return { transport: "udp", defaultPort: "query", payload: A2S_INFO, maxBytes: 512, timeoutMs: 3_000 };
    case "terraria-hello":
      return { transport: "tcp", defaultPort: "game", payload: terrariaHello(), maxBytes: 256, timeoutMs: 3_000 };
    case "terraria-rest":
      return null;
  }
}

export function judgeQueryReply(protocol: QueryProtocol, reply: Uint8Array, ended: ExchangeEnd): QueryVerdict {
  if (reply.length === 0) {
    if (ended === "refused") return { ok: false, detail: "nothing is listening where the game answers queries" };
    return { ok: false, detail: "the game took a query and did not answer it" };
  }

  const recognised =
    protocol === "minecraft-ping"
      ? isMinecraftStatus(reply)
      : protocol === "source-a2s"
        ? isA2sReply(reply)
        : protocol === "terraria-hello"
          ? isTerrariaReply(reply)
          : false;

  return recognised ? { ok: true } : { ok: false, detail: "something answered the query, but not as this game does" };
}

/* ── Minecraft: Java Edition ──────────────────────────────────────
   The server list ping: a handshake whose next state is "status", then
   an empty status request, written together. The answer is one packet,
   id 0, holding a JSON string.

   Protocol version -1 is what a pinger sends when it does not know the
   server's; every version answers a status request regardless. Nothing
   is logged for it at the default log level. */

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function readVarint(bytes: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[at + i];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: at + i + 1 };
  }
  return null;
}

export function minecraftStatusRequest(host = "localhost", port = 25565): Uint8Array {
  const name = [...new TextEncoder().encode(host)];
  const handshake = [
    0x00, // packet id: handshake
    ...varint(-1),
    ...varint(name.length),
    ...name,
    (port >> 8) & 0xff,
    port & 0xff,
    0x01, // next state: status
  ];
  const request = [0x00]; // packet id: status request
  return Uint8Array.from([...varint(handshake.length), ...handshake, ...varint(request.length), ...request]);
}

/* A length, packet id 0, a string length, and JSON opening. The reply
   may be cut short — a server icon makes it tens of kilobytes — so only
   the front of it is looked at. */
export function isMinecraftStatus(reply: Uint8Array): boolean {
  const length = readVarint(reply, 0);
  if (!length || length.value < 3) return false;
  const id = readVarint(reply, length.next);
  if (!id || id.value !== 0) return false;
  const text = readVarint(reply, id.next);
  if (!text || text.value < 2) return false;
  return reply[text.next] === 0x7b; // {
}

/* ── Source engine: A2S_INFO ──────────────────────────────────────
   One datagram. A current server answers a bare request with a
   challenge (0x41) rather than the info (0x49), and wants the request
   again with the challenge appended. For health the challenge is
   already the answer: it comes from the game's own query responder, and
   a second round trip would learn a server name nobody asked for. */

export const A2S_INFO: Uint8Array = Uint8Array.from([
  0xff, 0xff, 0xff, 0xff, 0x54,
  ...new TextEncoder().encode("Source Engine Query"),
  0x00,
]);

export function isA2sReply(reply: Uint8Array): boolean {
  if (reply.length < 5) return false;
  // A split response starts FE FF FF FF; it is still the game answering.
  const single = reply[0] === 0xff && reply[1] === 0xff && reply[2] === 0xff && reply[3] === 0xff;
  const split = reply[0] === 0xfe && reply[1] === 0xff && reply[2] === 0xff && reply[3] === 0xff;
  if (split) return true;
  // Info, challenge, or the older GoldSource info.
  return single && (reply[4] === 0x49 || reply[4] === 0x41 || reply[4] === 0x6d);
}

/* ── Terraria ─────────────────────────────────────────────────────
   Terraria has no query protocol, so this is the first packet of its
   own: a connect request carrying a version string, here one no server
   has ("Terraria1"). The server answers with a disconnect packet —
   "you are not using the same version" — and hangs up itself, which is
   the point: vanilla 1.4.5.8 dies when a connection it is still
   accepting goes away first, and this one never does.

   It costs two lines in the server's console per question ("is
   connecting…", "was booted: …"), so Terraria's definition asks every
   few minutes rather than every pass. */

export function terrariaHello(version = "Terraria1"): Uint8Array {
  const text = [...new TextEncoder().encode(version)];
  const body = [0x01, text.length, ...text]; // packet 1, a length-prefixed string
  const length = body.length + 2;
  return Uint8Array.from([length & 0xff, (length >> 8) & 0xff, ...body]);
}

/* A run of framed packets holding one of the kinds a server sends in
   reply to a connect request: 2 is a disconnect with its reason, 3
   accepts the player, 37 asks for the password.

   Not necessarily the first. The server sends a net-module packet (82)
   as well, and on a real server it arrived before the disconnect about
   one time in four — which, judged on the first packet alone, turned a
   healthy server UNHEALTHY the second time it was asked. */
export function isTerrariaReply(reply: Uint8Array): boolean {
  let at = 0;
  let answered = false;
  while (at + 3 <= reply.length) {
    const length = reply[at]! | (reply[at + 1]! << 8);
    if (length < 3 || length > 1024) return false;
    const kind = reply[at + 2]!;
    /* The net-module packet counts on its own as well: it is the game's
       network loop talking, and a read that went quiet between it and
       the disconnect must not cost a working server its verdict. */
    if (kind !== 2 && kind !== 3 && kind !== 37 && kind !== 82) return false;
    answered = true;
    at += length;
  }
  return answered;
}
