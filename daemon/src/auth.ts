import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/* The panel presents a bearer token on every request. Comparison is
   constant-time so a wrong token cannot be discovered a byte at a
   time by measuring how long the rejection takes. */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself
  // leak the length, so compare a fixed-size digest of each instead.
  if (a.length !== b.length) {
    // Still do the work, then fail, to keep the timing flat.
    const pad = Buffer.alloc(Math.max(a.length, b.length));
    const other = Buffer.alloc(pad.length);
    a.copy(pad);
    b.copy(other);
    timingSafeEqual(pad, other);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function bearerFrom(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value;
}

/* More than one token is accepted only in the middle of a rotation, when
   the old one still works until the panel has confirmed the new — see
   rotate.ts. Every candidate is compared, match or not, so which of them
   matched is not in the timing either. */
export function anyTokenMatches(presented: string, accepted: string | readonly string[]): boolean {
  let matched = false;
  for (const token of typeof accepted === "string" ? [accepted] : accepted) {
    if (tokenMatches(presented, token)) matched = true;
  }
  return matched;
}

export function isAuthorized(req: IncomingMessage, accepted: string | readonly string[]): boolean {
  const presented = bearerFrom(req);
  return presented !== null && anyTokenMatches(presented, accepted);
}
