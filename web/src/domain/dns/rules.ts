import type { GameDefinition } from "../games/types";

/* DNS records for game servers: the decisions, with nothing that talks
   to a provider or a database. The panel writes records for a server
   when a provider is configured, the server's host is under the
   provider's zone, and its node has a public address; this file says
   what each of those means, which records a server wants, and what to do
   about a record that is already there. lib/dns-ops.ts carries them out.

   A server wants up to three records. An A record, and an AAAA record,
   point its host at its node — one for each family the node has an address
   in. And an SRV record, for a game whose client looks one up, says which
   port that host's game is on, so that players type the name and nothing
   else, whatever port the server holds. */

export type DnsKind = "cloudflare" | "duckdns" | "webhook";

/* What each provider is and what it can do, in one place, so that a third
   one is an entry here and not a new branch in a dozen files. Everything
   that used to read "Cloudflare, or else DuckDNS" reads this table, and a
   kind that is not in it is an error and not a default.

     srv   it can hold an SRV record. DuckDNS gives a subdomain one IPv4 and
           one IPv6 address and nothing else; a game that wants SRV there has
           players type the port, as they always did, and the page says so.
     read  it can answer "what is at this name". Without it the panel writes
           blind: it cannot tell a record somebody else made from its own, and
           the protection that rests on that — refusing to overwrite a record
           it did not make — is the provider's to keep, or the receiver's.
     took  what the panel may say of a record the provider took. Cloudflare
           and DuckDNS answered a write, so it is written; a webhook's
           receiver answered 2xx, which says it will act and not that DNS
           changed, so it is accepted. */
export interface DnsProviderFacts {
  id: DnsKind;
  label: string;
  zoneFixed: string | null;
  srv: boolean;
  read: boolean;
  took: "written" | "accepted";
}

export const DNS_PROVIDERS: Record<DnsKind, DnsProviderFacts> = {
  duckdns: { id: "duckdns", label: "DuckDNS", zoneFixed: "duckdns.org", srv: false, read: false, took: "written" },
  cloudflare: { id: "cloudflare", label: "Cloudflare", zoneFixed: null, srv: true, read: true, took: "written" },
  webhook: { id: "webhook", label: "Webhook", zoneFixed: null, srv: true, read: false, took: "accepted" },
};

/** The providers in the order the DNS page offers them. */
export const DNS_KINDS: ReadonlyArray<DnsProviderFacts> = [DNS_PROVIDERS.duckdns, DNS_PROVIDERS.cloudflare, DNS_PROVIDERS.webhook];

export function isDnsKind(value: unknown): value is DnsKind {
  return typeof value === "string" && Object.hasOwn(DNS_PROVIDERS, value);
}

/** The facts of a kind; throws for one that is not known, so a stored kind nobody wrote code for is loud. */
export function providerFacts(kind: string): DnsProviderFacts {
  if (!isDnsKind(kind)) throw new Error(`unknown DNS provider kind: ${kind}`);
  return DNS_PROVIDERS[kind];
}

export function providerHoldsSrv(kind: DnsKind): boolean {
  return DNS_PROVIDERS[kind].srv;
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

/** The kinds of record the panel writes for a server. */
export type RecordKind = "A" | "AAAA" | "SRV";

/* SRV's priority and weight. One target per name, so neither chooses between
   anything; these are the values a client reads as "use it". */
export const SRV_PRIORITY = 0;
export const SRV_WEIGHT = 5;

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
  /** Set by hand. Either family, as it always was; an IPv4 address is the usual one. */
  publicAddress: string | null;
  /** Set by hand: the node's IPv6 address, when it has one the Internet can reach. */
  publicAddress6?: string | null;
  observedAddress: string | null;
}

export type NodeAddress =
  | { address: string; source: "set" | "seen" }
  | { address: null; reason: "unset" | "private" };

/* The addresses a node's records point at, one for each family.

   What a person set wins, and wins entirely: with either address set by
   hand, the one the panel observed is not looked at. So a node never gets a
   record the operator did not ask for — in particular no AAAA for an IPv6
   address the panel happened to see a heartbeat from, which may not be one
   the Internet can reach. Nothing set: the observed address, when it is a
   public one, in the family it is. A private observed address is named, so
   the node's page can say "the panel sees this node from 192.168.1.20,
   which is not a public address". */
export type NodeAddresses =
  | { v4: string | null; v6: string | null; source: "set" | "seen" }
  | { v4: null; v6: null; source: null; reason: "unset" | "private" };

export function nodeAddresses(node: NodeAddressFacts): NodeAddresses {
  const hand = node.publicAddress?.trim() || null;
  const hand6 = node.publicAddress6?.trim() || null;
  const v4 = hand && addressFamily(hand) === "A" ? hand : null;
  const v6 = hand6 && addressFamily(hand6) === "AAAA" ? hand6 : hand && addressFamily(hand) === "AAAA" ? hand : null;
  if (v4 || v6) return { v4, v6, source: "set" };
  const seen = node.observedAddress?.trim();
  if (seen && addressFamily(seen)) {
    if (!isPublicAddress(seen)) return { v4: null, v6: null, source: null, reason: "private" };
    return addressFamily(seen) === "A" ? { v4: seen, v6: null, source: "seen" } : { v4: null, v6: seen, source: "seen" };
  }
  return { v4: null, v6: null, source: null, reason: "unset" };
}

/* The one address a page names when it names one: the IPv4 address if there
   is one, else the IPv6. The records use nodeAddresses; this is for a line
   of text and for the wizard's check, which compares what a name resolves to. */
export function nodeAddress(node: NodeAddressFacts): NodeAddress {
  const all = nodeAddresses(node);
  if (all.source === null) return { address: null, reason: all.reason };
  return { address: (all.v4 ?? all.v6)!, source: all.source };
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

/* What a server's game asks for as an SRV record, with the port resolved
   against the block the server holds: the record carries that port, which
   is what changes when the server moves. Null for a game that does not ask. */
export interface SrvFacts {
  service: string;
  protocol: "tcp" | "udp";
  port: number;
}

export function srvOf(game: Pick<GameDefinition, "ports" | "srv"> | null | undefined, base: number): SrvFacts | null {
  const plan = game?.srv;
  if (!plan) return null;
  const role = game!.ports.find((p) => p.id === plan.port);
  return role ? { service: plan.service, protocol: plan.protocol, port: base + role.offset } : null;
}

export const srvName = (srv: Pick<SrvFacts, "service" | "protocol">, host: string) => `_${srv.service}._${srv.protocol}.${host.trim().toLowerCase()}`;
export const srvContent = (port: number, target: string) => `${SRV_PRIORITY} ${SRV_WEIGHT} ${port} ${target.trim().toLowerCase()}`;

/** An SRV record's text with the spacing, the case and a trailing dot on the target taken out, to compare two. */
export function normaliseSrv(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** An address in the form two of them can be compared in: IPv6 in its compressed lower-case form. */
export function canonicalAddress(value: string): string {
  const v = value.trim();
  if (addressFamily(v) !== "AAAA") return v;
  try {
    return new URL(`http://[${v}]/`).hostname.slice(1, -1);
  } catch {
    return v.toLowerCase();
  }
}

/** A record the panel wants at a name: what to write, and what it should say. */
export interface WantedRecord {
  kind: RecordKind;
  /** The host, or `_minecraft._tcp.<host>` for the SRV. */
  name: string;
  /** An address, or for SRV `priority weight port target`. */
  content: string;
}

export type Wanted = { records: WantedRecord[]; reason: null } | { records: []; reason: "unset" | "private" };

/* Every record a server wants, and nothing that depends on a provider's
   answer: an A for the node's IPv4 address, an AAAA for its IPv6 one, and the
   SRV its game asks for where the provider can hold one — and only when there
   is an address for it to name, since a target with none is a record that
   points at nothing. With no address at all, the reason is given. */
export function wantedRecords(input: { host: string; node: NodeAddressFacts; provider: { kind: DnsKind }; srv: SrvFacts | null }): Wanted {
  const addresses = nodeAddresses(input.node);
  if (addresses.source === null) return { records: [], reason: addresses.reason };
  const host = input.host.trim().toLowerCase();
  const records: WantedRecord[] = [];
  if (addresses.v4) records.push({ kind: "A", name: host, content: addresses.v4 });
  if (addresses.v6) records.push({ kind: "AAAA", name: host, content: addresses.v6 });
  if (input.srv && providerHoldsSrv(input.provider.kind)) {
    records.push({ kind: "SRV", name: srvName(input.srv, host), content: srvContent(input.srv.port, host) });
  }
  return { records, reason: null };
}

export type DnsDecision =
  | { action: "create" }
  | { action: "adopt"; id: string | null }
  | { action: "update"; id: string | null }
  | { action: "nothing"; id: string | null }
  | { action: "refuse"; reason: string };

/* What to do at a name for one record, given what is already there. The
   panel creates where there is nothing of that kind, adopts a record that
   already says what it would have written, updates one it made itself, and
   refuses to touch one it did not make that says something else: a record
   that pointed somewhere on purpose is not overwritten because a server took
   the name. A CNAME, or several records of the kind, are refused for the same
   reason — a name is the panel's for one record of each kind, and no more.
   An A and an AAAA at one name are not in each other's way. */
export function decide(existing: DnsRecord[], wanted: WantedRecord, marker: string): DnsDecision {
  const cname = existing.find((r) => r.type === "CNAME");
  if (cname) return { action: "refuse", reason: `a CNAME to ${cname.content} already exists at that name, and Geeboard did not make it` };
  const same = existing.filter((r) => r.type === wanted.kind);
  if (same.length === 0) return { action: "create" };
  if (same.length > 1) {
    return { action: "refuse", reason: `${same.length} ${wanted.kind} records already exist at that name, and Geeboard keeps one` };
  }
  const only = same[0]!;
  const ours = (only.comment ?? "").trim() === marker;
  const equal = wanted.kind === "SRV" ? normaliseSrv(only.content) === normaliseSrv(wanted.content) : canonicalAddress(only.content) === canonicalAddress(wanted.content);
  if (equal) return ours ? { action: "nothing", id: only.id } : { action: "adopt", id: only.id };
  if (ours) return { action: "update", id: only.id };
  return {
    action: "refuse",
    reason: `${wanted.kind === "SRV" ? "an SRV record" : "a record"} for that name already exists, ${wanted.kind === "SRV" ? "saying" : "pointing at"} ${only.content}, and Geeboard did not make it`,
  };
}

export type DnsState = "none" | "outside" | "no-address" | "set" | "failed";

/** A record the panel keeps for a server, as it is stored. */
export interface DnsRow {
  /** "A", "AAAA" or "SRV"; a string, because that is what the database keeps. */
  kind: string;
  name: string;
  /** What was last written; null when nothing has been written yet. */
  content: string | null;
  checkedAt: Date | null;
  error: string | null;
}

export interface RecordView {
  kind: RecordKind;
  name: string;
  content: string | null;
  error: string | null;
}

/** A record in a few words for a page: an address as it is, an SRV as the port it carries and where it points. */
export function recordText(record: { kind: RecordKind; content: string | null }): string {
  if (!record.content) return "not written";
  if (record.kind !== "SRV") return record.content;
  const [, , port, ...target] = record.content.split(" ");
  return `port ${port} → ${target.join(" ")}`;
}

export interface DnsView {
  state: DnsState;
  /** The address its host points at: IPv4 if there is one, else IPv6. */
  address: string | null;
  error: string | null;
  /** Each record the panel keeps, for the pages and the API. */
  records: RecordView[];
  /** Players type the name alone: the SRV record is written. */
  byName: boolean;
}

/* How a server's records stand, for its page and the API: not the panel's
   to keep (no provider, or a host outside the zone), waiting on its node's
   address, written, or failed with a reason. */
export function dnsStateOf(
  server: { host: string },
  provider: { kind: DnsKind; zone: string } | null,
  node: NodeAddressFacts | null,
  rows: DnsRow[],
): DnsView {
  const records = rows.map((r) => ({ kind: r.kind as RecordKind, name: r.name, content: r.content, error: r.error }));
  const address = rows.find((r) => r.kind === "A" && r.content)?.content ?? rows.find((r) => r.kind === "AAAA" && r.content)?.content ?? null;
  const byName = rows.some((r) => r.kind === "SRV" && r.content && !r.error);
  const view = (state: DnsState, error: string | null = null): DnsView => ({ state, address, error, records, byName });
  if (!provider) return { state: "none", address: null, error: null, records: [], byName: false };
  if (!coveredBy(provider.kind, provider.zone, server.host)) return { state: "outside", address: null, error: null, records: [], byName: false };
  const failed = rows.find((r) => r.error);
  if (failed) return view("failed", failed.error);
  if (rows.some((r) => r.content && r.kind !== "SRV")) return view("set");
  if (node && nodeAddress(node).address === null) return view("no-address");
  return view("failed", "not written yet");
}

/* Whether the poller should try a server's records on this pass: they are
   the provider's to keep, its node has an address, and either a record is
   missing, wrong or no longer wanted, or the last try at one failed long
   enough ago. A record that failed is not tried again for five minutes, so a
   provider that is down is asked once in a while and not on every pass. */
export const DNS_RETRY_MS = 5 * 60_000;

export function dnsNeedsSync(
  server: { host: string; rows: DnsRow[] },
  provider: { kind: DnsKind; zone: string },
  node: NodeAddressFacts,
  srv: SrvFacts | null,
  nowMs: number,
): boolean {
  if (!coveredBy(provider.kind, provider.zone, server.host)) return false;
  const wanted = wantedRecords({ host: server.host, node, provider, srv });
  if (wanted.records.length === 0) return false;
  // A record the panel keeps and no longer wants — the node's IPv6 address was taken away — goes at once.
  if (server.rows.some((r) => !wanted.records.some((w) => w.kind === r.kind))) return true;
  for (const w of wanted.records) {
    const row = server.rows.find((r) => r.kind === w.kind);
    if (!row) return true;
    if (!row.error && row.name === w.name && row.content === w.content) continue;
    if (row.error && nowMs - (row.checkedAt?.getTime() ?? 0) < DNS_RETRY_MS) continue;
    return true;
  }
  return false;
}
