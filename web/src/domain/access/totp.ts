import { createHmac, timingSafeEqual } from "node:crypto";

/* Time-based one-time passwords, RFC 6238 over RFC 4226.

   Written against node:crypto rather than pulled in, because the whole
   algorithm is an HMAC and some arithmetic — about as much code as the
   glue for a library would be, and with no dependency to audit. The
   parameters are the ones every authenticator app assumes: SHA-1, six
   digits, thirty-second steps. Verified against the RFC's own vectors
   in test/totp.test.ts.

   Nothing here touches a database or a clock of its own: the caller
   passes the time, so a test can stand at any second it likes. */

export const TOTP_STEP_S = 30;
export const TOTP_DIGITS = 6;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding — the form authenticator apps take a secret in. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("not a base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4226: the HMAC of the counter, dynamically truncated to `digits`. */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  // Counters this large do not occur; the high word stays zero.
  message.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", Buffer.from(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The step a moment falls in — what a code is a function of. */
export function stepOf(atMs: number, stepS = TOTP_STEP_S): number {
  return Math.floor(atMs / 1000 / stepS);
}

export function totp(secret: Uint8Array, atMs: number, digits = TOTP_DIGITS, stepS = TOTP_STEP_S): string {
  return hotp(secret, stepOf(atMs, stepS), digits);
}

/* Checks a typed code against the current step and its neighbours —
   phones drift, and a code typed at the end of a step is still that
   step's — and refuses any step at or before the last one accepted, so
   a code seen once cannot be replayed within its window. Returns the
   step the code matched, to be recorded as the new floor. */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  atMs: number,
  lastStep: number | null,
  window = 1,
): number | null {
  const typed = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const now = stepOf(atMs);
  for (let delta = -window; delta <= window; delta++) {
    const step = now + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = hotp(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return step;
  }
  return null;
}

/** The URI an authenticator app reads, from a QR code or pasted in. */
export function otpauthUri(issuer: string, account: string, secret: Uint8Array): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
