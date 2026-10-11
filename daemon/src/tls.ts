import { X509Certificate, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { createServer as createTlsServer, type TLSSocket } from "node:tls";

/* The agent's own certificate, and the one port that answers both https and plain http.

   The panel called the agent over plain http with one bearer token, which commands every container on the machine: between two
   machines on a LAN that is a wire nobody else is on, across the internet it is the token, every console line and every file in
   the clear. Now the agent makes a key and a self-signed certificate the first time it starts, keeps them beside its agent file,
   and sends the certificate's SHA-256 in its registration and its heartbeats. The panel keeps that fingerprint with the node and
   from then on calls this agent over https, accepting that certificate and no other (web/src/lib/agent-tls.ts). It is the panel's
   own authority the other way round (panel-ca.ts): a fingerprint that came over a channel somebody already trusts, and no
   certificate authority anybody has to run.

   Plain http goes on being answered on the same port, by looking at the first byte a connection sends: a TLS handshake begins
   with 0x16, a request with a letter. That is the rollback promise: a panel put back to 0.10.1 has never heard of TLS and must
   still reach an agent of 0.11, and a panel that has pinned this certificate never sends anything over plain http again, so
   the token is not on that wire for the plain listener to be a way in. Nothing else changes for whoever opens the port: the
   firewall, agent-port.sh and the container's published port are the ones they were. */

/** The two files, and what the agent read from them. */
export interface AgentTls {
  key: string;
  cert: string;
  /** The certificate's SHA-256, as 64 lowercase hexadecimal digits: what the panel pins. */
  fingerprint: string;
  keyFile: string;
  certFile: string;
  /** Made by this start, as against read from the files: said in the log, with the fingerprint. */
  created: boolean;
}

export class TlsFileError extends Error {}

/* The SHA-256 of a certificate, as the panel keeps it: panel-ca.ts's fingerprintOf, written again here because that file is also a
   command and starts with one, and the panel's tests load this one to make certificates the way an agent does. */
export function fingerprintOf(certificate: X509Certificate): string {
  return certificate.fingerprint256.replace(/:/g, "").toLowerCase();
}

/* Where the files are, beside the agent file and named after it: agent.json has agent.tls.key and agent.tls.crt. Named after it
   because two agents on one account (GEEBOARD_AGENT_FILE) are two nodes, and two nodes should not share a key. */
export function tlsFilesBeside(agentFile: string): { keyFile: string; certFile: string } {
  const base = path.basename(agentFile).replace(/\.json$/i, "");
  const dir = path.dirname(agentFile);
  return { keyFile: path.join(dir, `${base}.tls.key`), certFile: path.join(dir, `${base}.tls.crt`) };
}

/* ── A certificate, without a library ─────────────────────────────
   Node signs and verifies but does not write certificates, and the agent has two dependencies. What a self-signed certificate
   is, in DER, is short: a version, a serial number, the signature's algorithm, the same name as issuer and subject, two dates,
   the public key as Node already exports it, one extension saying it is not an authority, and the signature over all of it. */

function der(tag: number, content: Buffer): Buffer {
  const length = content.length;
  let head: Buffer;
  if (length < 0x80) head = Buffer.from([tag, length]);
  else if (length < 0x100) head = Buffer.from([tag, 0x81, length]);
  else head = Buffer.from([tag, 0x82, length >> 8, length & 0xff]);
  return Buffer.concat([head, content]);
}

const sequence = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [first! * 40 + second!];
  for (const arc of rest) {
    const groups = [arc & 0x7f];
    for (let value = arc >> 7; value > 0; value >>= 7) groups.unshift((value & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return der(0x06, Buffer.from(bytes));
}

/** A positive INTEGER: a leading zero when the first bit would make it negative. */
function integer(bytes: Buffer): Buffer {
  return der(0x02, bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

/* UTCTime until 2049 and GeneralizedTime from 2050, as RFC 5280 says. */
function time(at: Date): Buffer {
  const iso = at.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return at.getUTCFullYear() < 2050 ? der(0x17, Buffer.from(`${iso.slice(2)}Z`)) : der(0x18, Buffer.from(`${iso}Z`));
}

const ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";
const COMMON_NAME = "2.5.4.3";
const BASIC_CONSTRAINTS = "2.5.29.19";

/* A new key (P-256) and a certificate for it, signed by itself. It does not expire: 99991231235959Z is how RFC 5280 spells "no
   well-defined expiration date", and what the panel checks is the fingerprint, not the dates, so an end date would only be a
   day on which every node stopped answering at once. */
export function selfSignedCertificate(commonName: string, now: Date = new Date()): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const algorithm = sequence(oid(ECDSA_WITH_SHA256));
  const name = sequence(der(0x31, sequence(oid(COMMON_NAME), der(0x0c, Buffer.from(commonName.slice(0, 64), "utf8")))));
  const serial = randomBytes(16);
  serial[0] = serial[0]! & 0x7f;
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(serial),
    algorithm,
    name,
    // An hour back, for a panel whose clock is a little behind and a client that reads the dates anyway.
    sequence(time(new Date(now.getTime() - 3600_000)), der(0x18, Buffer.from("99991231235959Z"))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    der(0xa3, sequence(sequence(oid(BASIC_CONSTRAINTS), der(0x01, Buffer.from([0xff])), der(0x04, sequence())))),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certificate = sequence(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const body = certificate.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd();
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`,
  };
}

function readIfThere(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new TlsFileError(`${file} cannot be read: ${(error as Error).message}`);
  }
}

/* The agent's key and certificate: read when both are there, made when neither is, and refused otherwise.

   Never replaced by itself. A new certificate is a new fingerprint, which the panel that pinned the old one refuses until the
   node is joined again: so a file that is unreadable, half there or does not match its key is a sentence at start-up and not a
   new pair written over it. Somebody who wants a new certificate removes both files and joins the node again (docs/nodes.md). */
export function loadOrCreateTls(files: { keyFile: string; certFile: string }, commonName: string): AgentTls {
  const { keyFile, certFile } = files;
  const key = readIfThere(keyFile);
  const cert = readIfThere(certFile);
  const remedy =
    `Put the file back, or remove ${path.basename(keyFile)} and ${path.basename(certFile)} both to make a new certificate: ` +
    "a panel that pinned the old one then needs the node joined again.";

  if (key !== null && cert !== null) {
    let certificate: X509Certificate;
    try {
      certificate = new X509Certificate(cert);
    } catch {
      throw new TlsFileError(`${certFile} is not a certificate. ${remedy}`);
    }
    let matches: boolean;
    try {
      matches = certificate.checkPrivateKey(createPrivateKey(key));
    } catch {
      throw new TlsFileError(`${keyFile} is not a private key. ${remedy}`);
    }
    if (!matches) throw new TlsFileError(`${certFile} is not the certificate of ${keyFile}. ${remedy}`);
    return { key, cert, fingerprint: fingerprintOf(certificate), keyFile, certFile, created: false };
  }
  if (key !== null || cert !== null) {
    const [there, missing] = key !== null ? [keyFile, certFile] : [certFile, keyFile];
    throw new TlsFileError(`${there} is there and ${missing} is not. ${remedy}`);
  }

  const made = selfSignedCertificate(commonName);
  mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  // `wx`: a file that appeared since it was looked for (a join and a start at once) is not written over.
  writeFileSync(keyFile, made.key, { mode: 0o600, flag: "wx" });
  writeFileSync(certFile, made.cert, { mode: 0o644, flag: "wx" });
  return { ...made, fingerprint: fingerprintOf(new X509Certificate(made.cert)), keyFile, certFile, created: true };
}

/* ── One port, both ways ──────────────────────────────────────────
   The http server keeps listening and keeps everything it does with a connection (the limits, the timeouts, the upgrade to a
   WebSocket, closing them at shutdown). What changes is the moment a connection arrives: the handlers it had for one are taken
   off and put behind a look at the first byte. A handshake goes through a TLS server that never listens, and the decrypted
   socket is handed to them; anything else is handed to them as it came. The byte is put back first, and a TLS socket reads
   what is already waiting on the one it wraps, so neither side loses it.

   `waitMs` bounds the time before that: a connection that sends nothing, or begins a handshake and never ends it, is closed,
   as one that sends nothing was before (server.ts, HELLO_MS). */

const HANDSHAKE = 0x16;

export function answerTlsToo(
  server: Server,
  tls: { key: string; cert: string },
  waitMs: number,
  onTlsError: (detail: string) => void = () => {},
): void {
  const handlers = server.listeners("connection") as Array<(socket: Socket) => void>;
  if (handlers.length === 0) throw new Error("the http server has no connection handler to put TLS in front of");
  server.removeAllListeners("connection");
  const deliver = (socket: Socket) => {
    for (const handler of handlers) handler.call(server, socket);
  };

  // The handshake has the same bound as the first byte had: a client that begins one and never ends it holds nothing for long.
  const tlsServer = createTlsServer({ key: tls.key, cert: tls.cert, minVersion: "TLSv1.2", handshakeTimeout: waitMs });
  tlsServer.on("secureConnection", (socket: TLSSocket) => deliver(socket));
  // A handshake that fails (a scanner, a client that does not take the certificate) is that connection's, and only said.
  tlsServer.on("tlsClientError", (error, socket) => {
    onTlsError(error.message);
    socket.destroy();
  });

  server.on("connection", (socket: Socket) => {
    socket.setTimeout(waitMs, () => socket.destroy());
    // A peer that resets is a closed socket, not an error nobody listens for: before it said anything, and under a TLS socket.
    socket.on("error", () => socket.destroy());
    socket.once("readable", function first() {
      const head = socket.read(1) as Buffer | null;
      if (head === null) {
        // Nothing yet, or the end: the next readable, unless the peer is gone.
        if (!socket.destroyed && !socket.readableEnded) socket.once("readable", first);
        return;
      }
      socket.unshift(head);
      socket.setTimeout(0);
      if (head[0] === HANDSHAKE) tlsServer.emit("connection", socket);
      else deliver(socket);
    });
  });
}
