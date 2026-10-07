/* Who a request came from, for the places that limit by it.

   Every limit here used to key on the first X-Forwarded-For entry. That is the one a client chooses: the nginx
   block the documentation gives appends the peer it saw to whatever the client sent, so the first entry is the
   client's claim and the last is the proxy's observation. A script that sent a different first entry with each
   try had a fresh bucket for each, so the per-source limit on sign-in was one nobody had to keep.

   The address to believe is the one the nearest proxy wrote: `hops` entries from the right is the first one a
   proxy of ours did not write, and the default of one is the Caddy the installer sets up and the nginx example,
   both of which append what they accepted the connection from. A panel with no proxy in front reads nothing from
   a header any client can write (hops 0), and says so in the one bucket everybody shares, which is the honest
   shape of "I cannot tell you apart". */

import { addressFamily } from "../dns/rules";

/** The default: one proxy in front, the one that is documented. */
export const DEFAULT_TRUSTED_HOPS = 1;

/** From the environment: a whole number of proxies, 0 for none. Anything else is the default. */
export function trustedHopsFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TRUSTED_HOPS;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 8 ? n : DEFAULT_TRUSTED_HOPS;
}

function bare(entry: string): string | null {
  // "[2001:db8::1]:1234", "203.0.113.9:1234", "2001:db8::1", "::ffff:203.0.113.9"
  let text = entry.trim().toLowerCase();
  if (text.startsWith("[")) {
    const close = text.indexOf("]");
    if (close < 0) return null;
    text = text.slice(1, close);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(text)) {
    text = text.slice(0, text.lastIndexOf(":"));
  }
  if (text.startsWith("::ffff:") && addressFamily(text.slice(7)) === "A") text = text.slice(7);
  return addressFamily(text) ? text : null;
}

/** The client's address as the trusted proxy saw it, or null when there is nothing to believe. */
export function clientAddress(forwardedFor: string | null | undefined, hops = DEFAULT_TRUSTED_HOPS): string | null {
  if (hops <= 0 || !forwardedFor) return null;
  const entries = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  // Fewer entries than proxies: the header was not written by all of them, so the nearest is all there is.
  const at = Math.max(0, entries.length - hops);
  return bare(entries[at]!);
}

/* The key a limit counts against. An IPv4 address is one machine's, and an IPv6 /64 is what one subscriber is
   handed, so a script that walks through the 2^64 addresses of its own prefix is one source, as it is in
   every limiter that means it. */
export function sourceBucket(address: string | null): string {
  if (!address) return "unknown";
  if (addressFamily(address) !== "AAAA") return address;
  const groups = expandV6(address);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : address;
}

function expandV6(address: string): string[] | null {
  const [head, tail, ...rest] = address.split("::");
  if (rest.length > 0) return null;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  if (tail === undefined && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) return null;
  const all = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
  if (all.length !== 8) return null;
  return all.map((g) => (g.length === 0 ? "0" : g.replace(/^0+(?=.)/, "")));
}

/** The one call the limits make: the header as received, the number of proxies, and the bucket that comes of it. */
export function sourceOf(forwardedFor: string | null | undefined, hops = DEFAULT_TRUSTED_HOPS): string {
  return sourceBucket(clientAddress(forwardedFor, hops));
}
