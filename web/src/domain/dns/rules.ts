/* DNS records for game servers: the decisions, with nothing that talks
   to a provider or a database. The panel writes a record for a server
   when a provider is configured, the server's host is under the
   provider's zone, and its node has a public address; this file says
   what each of those means, and what to do about a record that is
   already there. lib/dns-ops.ts carries them out. */

export type DnsKind = "cloudflare" | "duckdns";

export const DNS_KINDS: ReadonlyArray<{ id: DnsKind; label: string; zoneFixed: string | null }> = [
  { id: "duckdns", label: "DuckDNS", zoneFixed: "duckdns.org" },
  { id: "cloudflare", label: "Cloudflare", zoneFixed: null },
];

export function isDnsKind(value: unknown): value is DnsKind {
  return value === "cloudflare" || value === "duckdns";
}

/* What DuckDNS's answer says when a subdomain is not the account's. The
   client words its refusal with it and the DNS page looks for it, to offer
   "make it on duckdns.org" where that is the fix and not for every failure. */
export const NOT_IN_ACCOUNT = "not in this account";

/** A record as a provider reports it, in the few fields the decision reads. */
export interface DnsRecord {
  id: string | null;
  type: string;
  name: string;
  content: string;
  /** Cloudflare's free-text comment; the panel marks its own records with it. */
  comment?: string | null;
}

export type AddressFamily = "A" | "AAAA";

/** "A" for an IPv4 literal, "AAAA" for IPv6, null for anything else. */
export function addressFamily(value: string): AddressFamily | null {
  const v = value.trim();
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(v)) return "A";
  // Good enough for a literal somebody typed: hex groups, one "::" at most, no zone index.
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":") && (v.match(/::/g) ?? []).length <= 1 && v.split(":").length <= 8) {
    return "AAAA";
  }
  return null;
}

/* Whether an address is one the Internet can route to. A private,
   loopback or link-local address is what the panel sees a node from
   when both are on one LAN, and is never worth a public record. */
export function isPublicAddress(value: string): boolean {
  const family = addressFamily(value);
  if (family === "A") {
    const [a, b] = value.split(".").map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (family === "AAAA") {
    const v = value.toLowerCase();
    if (v === "::1" || v === "::") return false;
    if (/^f[cd]/.test(v)) return false; // fc00::/7, unique local
    if (/^fe[89ab]/.test(v)) return false; // fe80::/10, link local
    if (v.startsWith("::ffff:")) return isPublicAddress(v.slice(7));
    return true;
  }
  return false;
}

/* The peer a request came from, read from X-Forwarded-For as the
   panel's own proxy writes it. Caddy sets the header afresh for a client
   that is not a trusted proxy, appending the peer it accepted the
   connection from: the last address is the one it saw, and the first is
   whatever the client claimed. With no header — no proxy in front, as
   in development — there is no peer to read. */
export function peerOf(forwardedFor: string | null | undefined): string | null {
  if (!forwardedFor) return null;
  const parts = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  // "[2001:db8::1]:1234" or "203.0.113.9:1234", as some proxies write it.
  const bare = last.startsWith("[") ? last.slice(1, last.indexOf("]")) : last.replace(/:\d+$/, (m) => (last.includes(".") ? "" : m));
  return addressFamily(bare) ? bare : null;
}

export interface NodeAddressFacts {
  publicAddress: string | null;
  observedAddress: string | null;
}

export type NodeAddress =
  | { address: string; source: "set" | "seen" }
  | { address: null; reason: "unset" | "private" };

/* The address a node's records point at: the one a person set, else the
   one the panel observed if it is public. A private observed address is
   named, so the node's page can say "the panel sees this node from
   192.168.1.20, which is not a public address". */
export function nodeAddress(node: NodeAddressFacts): NodeAddress {
  const set = node.publicAddress?.trim();
  if (set && addressFamily(set)) return { address: set, source: "set" };
  const seen = node.observedAddress?.trim();
  if (seen && addressFamily(seen)) {
    return isPublicAddress(seen) ? { address: seen, source: "seen" } : { address: null, reason: "private" };
  }
  return { address: null, reason: "unset" };
}

/* Whether a host is the provider's to write: under the zone, for
   Cloudflare; under any subdomain of duckdns.org, at any depth, for
   DuckDNS — see duckBase for why depth does not matter there. */
export function coveredBy(kind: DnsKind, zone: string, host: string): boolean {
  const h = host.trim().toLowerCase();
  const z = zone.trim().toLowerCase();
  if (!h || !z) return false;
  if (kind === "duckdns") return duckBase(h) !== null;
  return h === z || h.endsWith(`.${z}`);
}

/* The DuckDNS subdomain a name belongs to: the last label before
   duckdns.org, or null for a name that is not under it.

   DuckDNS answers for every name under a subdomain of an account with
   that subdomain's address — `aurora.myserver.duckdns.org` and
   `a.b.myserver.duckdns.org` resolve as `myserver.duckdns.org` does, which
   is what makes a subdomain per server unnecessary: one made by hand, per
   node, serves every server on it. So a name's record is its base's, and
   the base is what the panel writes to, and what two servers can share. */
export function duckBase(host: string): string | null {
  const m = /^(?:[a-z0-9-]+\.)*([a-z0-9-]+)\.duckdns\.org$/.exec(host.trim().toLowerCase());
  return m ? m[1]! : null;
}

/** Two names under the same DuckDNS subdomain, which therefore share one address. */
export function sameDuckBase(a: string, b: string): boolean {
  const base = duckBase(a);
  return base !== null && base === duckBase(b);
}

/** What the panel writes into a record's comment to know it as its own. */
export function markerFor(serverId: string): string {
  return `geeboard:${serverId}`;
}

export type DnsDecision =
  | { action: "create" }
  | { action: "adopt"; id: string | null }
  | { action: "update"; id: string | null }
  | { action: "nothing"; id: string | null }
  | { action: "refuse"; reason: string };

/* What to do at a name, given what is already there. The panel creates
   where there is nothing, adopts a record that already says what it
   would have written, updates one it made itself, and refuses to touch
   one it did not make that says something else: a record that pointed
   somewhere on purpose is not overwritten because a server took the
   name. A CNAME or several records at the name are refused for the same
   reason — the panel keeps one address record per host, and no more. */
export function decide(existing: DnsRecord[], wanted: { family: AddressFamily; address: string; marker: string }): DnsDecision {
  const relevant = existing.filter((r) => r.type === "A" || r.type === "AAAA" || r.type === "CNAME");
  if (relevant.length === 0) return { action: "create" };
  if (relevant.length > 1) {
    return { action: "refuse", reason: `${relevant.length} records already exist at that name, and Geeboard keeps one` };
  }
  const only = relevant[0]!;
  if (only.type === "CNAME") return { action: "refuse", reason: `a CNAME to ${only.content} already exists at that name, and Geeboard did not make it` };
  const ours = (only.comment ?? "").trim() === wanted.marker;
  if (only.type === wanted.family && only.content === wanted.address) {
    return ours ? { action: "nothing", id: only.id } : { action: "adopt", id: only.id };
  }
  if (ours) return { action: "update", id: only.id };
  return { action: "refuse", reason: `a record for that name already exists, pointing at ${only.content}, and Geeboard did not make it` };
}

export type DnsState = "none" | "outside" | "no-address" | "set" | "failed";

export interface ServerDnsFacts {
  host: string;
  dnsAddress: string | null;
  dnsError: string | null;
}

/* How a server's record stands, for its page and the API: not the
   panel's to keep (no provider, or a host outside the zone), waiting
   on its node's address, written, or failed with a reason. */
export function dnsStateOf(
  server: ServerDnsFacts,
  provider: { kind: DnsKind; zone: string } | null,
  node: NodeAddressFacts | null,
): { state: DnsState; address: string | null; error: string | null } {
  if (!provider) return { state: "none", address: null, error: null };
  if (!coveredBy(provider.kind, provider.zone, server.host)) return { state: "outside", address: null, error: null };
  if (server.dnsError) return { state: "failed", address: server.dnsAddress, error: server.dnsError };
  if (server.dnsAddress) return { state: "set", address: server.dnsAddress, error: null };
  if (node && nodeAddress(node).address === null) return { state: "no-address", address: null, error: null };
  return { state: "failed", address: null, error: "not written yet" };
}

/* Whether the poller should try a server's record on this pass: it is
   the provider's to keep, its node has an address, and either the
   address has moved or the last try failed long enough ago. */
export const DNS_RETRY_MS = 5 * 60_000;

export function dnsNeedsSync(
  server: ServerDnsFacts & { dnsCheckedAt: Date | null },
  provider: { kind: DnsKind; zone: string },
  node: NodeAddressFacts,
  nowMs: number,
): boolean {
  if (!coveredBy(provider.kind, provider.zone, server.host)) return false;
  const wanted = nodeAddress(node);
  if (wanted.address === null) return false;
  if (server.dnsAddress === wanted.address && !server.dnsError) return false;
  const lastTry = server.dnsCheckedAt?.getTime() ?? 0;
  if (server.dnsError && nowMs - lastTry < DNS_RETRY_MS) return false;
  return true;
}
