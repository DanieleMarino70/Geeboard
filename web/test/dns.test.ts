import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addressFamily,
  canonicalAddress,
  coveredBy,
  decide,
  dnsNeedsSync,
  dnsStateOf,
  duckBase,
  normaliseSrv,
  sameDuckBase,
  isPublicAddress,
  markerFor,
  nodeAddress,
  nodeAddresses,
  peerOf,
  providerHoldsSrv,
  recordText,
  srvContent,
  srvName,
  srvOf,
  wantedRecords,
  type DnsRow,
  type WantedRecord,
} from "../src/domain/dns/rules.ts";
import { MINECRAFT_BEDROCK } from "../src/domain/games/definitions/minecraft-bedrock.ts";
import { MINECRAFT_JAVA } from "../src/domain/games/definitions/minecraft-java.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { PITCH, guideDone, guideFor } from "../src/domain/dns/guide.ts";
import { judgeAddress, lookupFailure, type Lookup } from "../src/domain/dns/address.ts";

test("an address literal has a family, and a name has none", () => {
  assert.equal(addressFamily("203.0.113.9"), "A");
  assert.equal(addressFamily("2001:db8::1"), "AAAA");
  assert.equal(addressFamily("example.com"), null);
  assert.equal(addressFamily("300.1.1.1"), null);
  assert.equal(addressFamily(""), null);
});

test("private, loopback and link-local addresses are not public", () => {
  for (const ip of ["10.0.0.5", "172.16.4.4", "172.31.255.1", "192.168.1.20", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ["203.0.113.9", "8.8.8.8", "172.32.0.1", "100.128.0.1"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("fd12::1"), false);
  assert.equal(isPublicAddress("fe80::1"), false);
  assert.equal(isPublicAddress("2001:db8::1"), true);
  assert.equal(isPublicAddress("::ffff:192.168.1.1"), false);
  assert.equal(isPublicAddress("example.com"), false);
});

/* Caddy writes the peer it accepted the connection from last; whatever
   came before is the client's own claim. */
test("the peer is the last address in X-Forwarded-For, and a claim is not one", () => {
  assert.equal(peerOf("203.0.113.9"), "203.0.113.9");
  assert.equal(peerOf("1.2.3.4, 203.0.113.9"), "203.0.113.9");
  assert.equal(peerOf("203.0.113.9:4321"), "203.0.113.9");
  assert.equal(peerOf("[2001:db8::1]:4321"), "2001:db8::1");
  assert.equal(peerOf("2001:db8::1"), "2001:db8::1");
  assert.equal(peerOf("unknown"), null);
  assert.equal(peerOf(""), null);
  assert.equal(peerOf(null), null);
});

test("a node's address is the one set by hand, else the public one the panel saw", () => {
  assert.deepEqual(nodeAddress({ publicAddress: "203.0.113.9", observedAddress: "192.168.1.2" }), { address: "203.0.113.9", source: "set" });
  assert.deepEqual(nodeAddress({ publicAddress: null, observedAddress: "203.0.113.9" }), { address: "203.0.113.9", source: "seen" });
  assert.deepEqual(nodeAddress({ publicAddress: null, observedAddress: "192.168.1.2" }), { address: null, reason: "private" });
  assert.deepEqual(nodeAddress({ publicAddress: null, observedAddress: null }), { address: null, reason: "unset" });
  assert.deepEqual(nodeAddress({ publicAddress: "", observedAddress: null }), { address: null, reason: "unset" });
});

/* A node has an address in each family it has one in, and the one that was set by hand is the whole answer:
   nothing the panel observed is added to it, so no family is ever guessed. */
test("a node has an address for each family, and what a person set is the whole of it", () => {
  const none = { publicAddress: null, publicAddress6: null, observedAddress: null };
  assert.deepEqual(nodeAddresses({ ...none, publicAddress: "203.0.113.9" }), { v4: "203.0.113.9", v6: null, source: "set" });
  assert.deepEqual(nodeAddresses({ ...none, publicAddress: "203.0.113.9", publicAddress6: "2001:db8::9" }), { v4: "203.0.113.9", v6: "2001:db8::9", source: "set" });
  assert.deepEqual(nodeAddresses({ ...none, publicAddress6: "2001:db8::9" }), { v4: null, v6: "2001:db8::9", source: "set" }, "an IPv6-only node");
  assert.deepEqual(nodeAddresses({ ...none, publicAddress: "2001:db8::9" }), { v4: null, v6: "2001:db8::9", source: "set" }, "an IPv6 address in the old field is still IPv6");
  // The observed address is looked at only when nothing was set, and never fills the other family.
  assert.deepEqual(nodeAddresses({ ...none, publicAddress: "203.0.113.9", observedAddress: "2001:db8::77" }), { v4: "203.0.113.9", v6: null, source: "set" });
  assert.deepEqual(nodeAddresses({ ...none, observedAddress: "203.0.113.9" }), { v4: "203.0.113.9", v6: null, source: "seen" });
  assert.deepEqual(nodeAddresses({ ...none, observedAddress: "2001:db8::77" }), { v4: null, v6: "2001:db8::77", source: "seen" });
  assert.deepEqual(nodeAddresses({ ...none, observedAddress: "10.0.0.4" }), { v4: null, v6: null, source: null, reason: "private" });
  assert.deepEqual(nodeAddresses(none), { v4: null, v6: null, source: null, reason: "unset" });
  // The one address a line of text names is the IPv4 one when there is one.
  assert.deepEqual(nodeAddress({ ...none, publicAddress: "203.0.113.9", publicAddress6: "2001:db8::9" }), { address: "203.0.113.9", source: "set" });
  assert.deepEqual(nodeAddress({ ...none, publicAddress6: "2001:db8::9" }), { address: "2001:db8::9", source: "set" });
});

test("a host is the provider's when it is under the zone; DuckDNS takes one label only", () => {
  assert.equal(coveredBy("cloudflare", "example.com", "aurora.example.com"), true);
  assert.equal(coveredBy("cloudflare", "example.com", "example.com"), true);
  assert.equal(coveredBy("cloudflare", "example.com", "deep.aurora.example.com"), true);
  assert.equal(coveredBy("cloudflare", "example.com", "aurora.example.org"), false);
  assert.equal(coveredBy("cloudflare", "example.com", "notexample.com"), false);
  assert.equal(coveredBy("duckdns", "duckdns.org", "aurora.duckdns.org"), true);
  assert.equal(coveredBy("duckdns", "duckdns.org", "a.aurora.duckdns.org"), true, "a name under a subdomain follows it");
  assert.equal(coveredBy("duckdns", "duckdns.org", "duckdns.org"), false);
  assert.equal(coveredBy("duckdns", "duckdns.org", "aurora.example.com"), false);
  assert.equal(duckBase("Aurora.duckdns.org"), "aurora");
  assert.equal(duckBase("aurora.example.com"), null);
  assert.equal(duckBase("duckdns.org"), null);
});

/* The table in the plan, one row per case — and now one table for each kind of record. */
test("what to do at a name, given what is already there", () => {
  const marker = markerFor("srv1");
  const wanted: WantedRecord = { kind: "A", name: "aurora.example.com", content: "203.0.113.9" };
  const rec = (over: Partial<{ id: string; type: string; content: string; comment: string | null }>) => ({
    id: "r1",
    type: "A",
    name: "aurora.example.com",
    content: "203.0.113.9",
    comment: null,
    ...over,
  });
  assert.deepEqual(decide([], wanted, marker), { action: "create" });
  assert.deepEqual(decide([rec({ type: "TXT", content: "v=spf1" })], wanted, marker), { action: "create" }, "a TXT at the name is not in the way");
  assert.deepEqual(decide([rec({})], wanted, marker), { action: "adopt", id: "r1" }, "same address, not ours: adopted");
  assert.deepEqual(decide([rec({ comment: "geeboard:srv1" })], wanted, marker), { action: "nothing", id: "r1" }, "ours and right: nothing");
  assert.deepEqual(decide([rec({ comment: "geeboard:srv1", content: "198.51.100.1" })], wanted, marker), { action: "update", id: "r1" }, "ours and stale: updated");
  assert.equal(decide([rec({ content: "198.51.100.1" })], wanted, marker).action, "refuse", "not ours, pointing elsewhere: refused");
  assert.equal(decide([rec({ type: "CNAME", content: "elsewhere.example.net" })], wanted, marker).action, "refuse");
  assert.equal(decide([rec({}), rec({ id: "r2", content: "198.51.100.1" })], wanted, marker).action, "refuse", "two A records: refused");
  assert.equal(decide([rec({ comment: "geeboard:srv2", content: "198.51.100.1" })], wanted, marker).action, "refuse", "another server's marker is not ours");
});

/* An A and an AAAA at one name are not in each other's way, which was the case that used to be refused. */
test("an A record and an AAAA record at one name are each decided on their own", () => {
  const marker = markerFor("srv1");
  const a: WantedRecord = { kind: "A", name: "aurora.example.com", content: "203.0.113.9" };
  const aaaa: WantedRecord = { kind: "AAAA", name: "aurora.example.com", content: "2001:db8::9" };
  const rec = (type: string, content: string, comment: string | null = null) => ({ id: `id-${type}`, type, name: "aurora.example.com", content, comment });
  const both = [rec("A", "203.0.113.9", marker), rec("AAAA", "2001:db8::9", marker)];
  assert.deepEqual(decide(both, a, marker), { action: "nothing", id: "id-A" });
  assert.deepEqual(decide(both, aaaa, marker), { action: "nothing", id: "id-AAAA" });
  assert.deepEqual(decide([rec("A", "203.0.113.9", marker)], aaaa, marker), { action: "create" }, "the A is there, the AAAA is not yet");
  assert.deepEqual(decide([rec("AAAA", "2001:db8::9", marker)], a, marker), { action: "create" });
  assert.equal(decide([rec("A", "203.0.113.9", marker), rec("A", "198.51.100.1")], a, marker).action, "refuse", "two of the same kind");
  assert.equal(decide([rec("AAAA", "2001:db8::1")], aaaa, marker).action, "refuse", "an AAAA somebody else made, elsewhere");
  assert.deepEqual(decide([rec("AAAA", "2001:0DB8:0:0:0:0:0:9")], aaaa, marker), { action: "adopt", id: "id-AAAA" }, "the same address written another way");
});

test("an SRV record is compared as the numbers and the target it says, whatever its spacing or case", () => {
  const marker = markerFor("srv1");
  const name = "_minecraft._tcp.aurora.example.com";
  const wanted: WantedRecord = { kind: "SRV", name, content: srvContent(25568, "aurora.example.com") };
  assert.equal(wanted.content, "0 5 25568 aurora.example.com");
  const rec = (content: string, comment: string | null = null) => ({ id: "s1", type: "SRV", name, content, comment });
  assert.deepEqual(decide([], wanted, marker), { action: "create" });
  assert.deepEqual(decide([rec("0 5 25568 aurora.example.com", marker)], wanted, marker), { action: "nothing", id: "s1" });
  assert.deepEqual(decide([rec("0  5  25568  AURORA.example.com.", marker)], wanted, marker), { action: "nothing", id: "s1" }, "spacing, case and a trailing dot");
  assert.deepEqual(decide([rec("0 5 25565 aurora.example.com", marker)], wanted, marker), { action: "update", id: "s1" }, "ours, and the port moved");
  assert.deepEqual(decide([rec("0 5 25568 aurora.example.com")], wanted, marker), { action: "adopt", id: "s1" });
  const foreign = decide([rec("10 5 25565 elsewhere.example.net")], wanted, marker);
  assert.equal(foreign.action, "refuse");
  assert.match(foreign.action === "refuse" ? foreign.reason : "", /an SRV record for that name already exists, saying 10 5 25565 elsewhere/);
  assert.equal(decide([rec("0 5 25568 a.example.com"), rec("1 5 25568 b.example.com")], wanted, marker).action, "refuse");
  assert.equal(normaliseSrv(" 0  5 25568 Host.Example.com. "), "0 5 25568 host.example.com");
  assert.equal(canonicalAddress("2001:0DB8::0009"), "2001:db8::9");
  assert.equal(canonicalAddress("203.0.113.9"), "203.0.113.9");
});

/* What a server wants is a function of four things: its host, its node's addresses, its provider and its game. */
interface NodeFacts {
  publicAddress: string | null;
  publicAddress6: string | null;
  observedAddress: string | null;
}

test("a server wants an A, an AAAA and an SRV, as its node, provider and game allow", () => {
  const cloudflare = { kind: "cloudflare" as const };
  const duck = { kind: "duckdns" as const };
  const v4: NodeFacts = { publicAddress: "203.0.113.9", publicAddress6: null, observedAddress: null };
  const both: NodeFacts = { ...v4, publicAddress6: "2001:db8::9" };
  const srv = srvOf(MINECRAFT_JAVA, 25568);
  assert.deepEqual(srv, { service: "minecraft", protocol: "tcp", port: 25568 });
  const want = (node: NodeFacts, provider: typeof cloudflare | typeof duck, s: ReturnType<typeof srvOf> = srv) => wantedRecords({ host: "Aurora.Example.com", node, provider, srv: s });
  assert.deepEqual(want(v4, cloudflare).records, [
    { kind: "A", name: "aurora.example.com", content: "203.0.113.9" },
    { kind: "SRV", name: "_minecraft._tcp.aurora.example.com", content: "0 5 25568 aurora.example.com" },
  ]);
  assert.deepEqual(want(both, cloudflare).records.map((r) => r.kind), ["A", "AAAA", "SRV"]);
  assert.deepEqual(want(both, duck).records.map((r) => r.kind), ["A", "AAAA"], "DuckDNS holds two addresses and no SRV");
  assert.deepEqual(want(both, cloudflare, null).records.map((r) => r.kind), ["A", "AAAA"], "a game that does not ask for one");
  assert.deepEqual(want({ publicAddress: null, publicAddress6: null, observedAddress: "10.0.0.2" }, cloudflare), { records: [], reason: "private" }, "no SRV for a target with no address");
  assert.deepEqual(want({ publicAddress: null, publicAddress6: null, observedAddress: null }, cloudflare), { records: [], reason: "unset" });
  assert.equal(providerHoldsSrv("cloudflare"), true);
  assert.equal(providerHoldsSrv("duckdns"), false);
});

test("only Minecraft: Java Edition asks for an SRV record, and it carries the port of the block the server holds", () => {
  assert.deepEqual(MINECRAFT_JAVA.srv, { service: "minecraft", protocol: "tcp", port: "game" });
  assert.equal(MINECRAFT_BEDROCK.srv, undefined, "Bedrock's client does not look one up, and its game is UDP");
  assert.equal(TERRARIA.srv, undefined);
  assert.equal(srvOf(MINECRAFT_JAVA, 25565)?.port, 25565);
  assert.equal(srvOf(MINECRAFT_JAVA, 25571)?.port, 25571, "the third server on a node");
  assert.equal(srvOf(TERRARIA, 7777), null);
  assert.equal(srvOf(null, 25565), null, "a server made before the catalog existed has no game to ask");
  assert.equal(srvName({ service: "minecraft", protocol: "tcp" }, "Aurora.Example.com"), "_minecraft._tcp.aurora.example.com");
  // The role it names has to be one the game has: a definition that named another would write nothing.
  assert.ok(MINECRAFT_JAVA.ports.some((p) => p.id === MINECRAFT_JAVA.srv!.port && p.protocol === MINECRAFT_JAVA.srv!.protocol));
});

test("how a server's records stand", () => {
  const provider = { kind: "cloudflare" as const, zone: "example.com" };
  const node: NodeFacts = { publicAddress: "203.0.113.9", publicAddress6: null, observedAddress: null };
  const s = (over: Partial<{ host: string }> = {}) => ({ host: "aurora.example.com", ...over });
  const row = (over: Partial<DnsRow>): DnsRow => ({ kind: "A", name: "aurora.example.com", content: "203.0.113.9", checkedAt: null, error: null, ...over });
  assert.equal(dnsStateOf(s(), null, node, []).state, "none");
  assert.equal(dnsStateOf(s({ host: "aurora.example.org" }), provider, node, [row({})]).state, "outside");
  const written = dnsStateOf(s(), provider, node, [row({})]);
  assert.equal(written.state, "set");
  assert.equal(written.address, "203.0.113.9");
  assert.equal(written.byName, false);
  assert.equal(dnsStateOf(s(), provider, node, [row({ content: null, error: "Cloudflare is unreachable." })]).state, "failed");
  assert.equal(dnsStateOf(s(), provider, node, [row({}), row({ kind: "SRV", content: null, error: "refused" })]).state, "failed", "one record failing is the state");
  assert.equal(dnsStateOf(s(), provider, { publicAddress: null, publicAddress6: null, observedAddress: "10.0.0.1" }, []).state, "no-address");
  assert.equal(dnsStateOf(s(), provider, node, []).state, "failed", "an address to point at and nothing written yet");
  const full = dnsStateOf(s(), provider, node, [row({}), row({ kind: "AAAA", content: "2001:db8::9" }), row({ kind: "SRV", name: "_minecraft._tcp.aurora.example.com", content: "0 5 25568 aurora.example.com" })]);
  assert.equal(full.state, "set");
  assert.equal(full.byName, true, "the SRV is written, so players need only the name");
  assert.deepEqual(full.records.map((r) => r.kind), ["A", "AAAA", "SRV"]);
  assert.equal(dnsStateOf(s(), provider, node, [row({}), row({ kind: "SRV", content: "0 5 25568 aurora.example.com", error: "later failed" })]).byName, false, "an SRV that failed is not one players can use");
  assert.equal(recordText({ kind: "A", content: "203.0.113.9" }), "203.0.113.9");
  assert.equal(recordText({ kind: "SRV", content: "0 5 25568 aurora.example.com" }), "port 25568 → aurora.example.com");
  assert.equal(recordText({ kind: "AAAA", content: null }), "not written");
});

test("the poller tries a server's records when one is missing, wrong or unwanted, or the last try is old", () => {
  const provider = { kind: "cloudflare" as const, zone: "example.com" };
  const node: NodeFacts = { publicAddress: "203.0.113.9", publicAddress6: null, observedAddress: null };
  const both: NodeFacts = { ...node, publicAddress6: "2001:db8::9" };
  const now = Date.parse("2026-09-29T10:00:00Z");
  const srv = srvOf(MINECRAFT_JAVA, 25568);
  const row = (over: Partial<DnsRow>): DnsRow => ({ kind: "A", name: "aurora.example.com", content: "203.0.113.9", checkedAt: null, error: null, ...over });
  const SRV = row({ kind: "SRV", name: "_minecraft._tcp.aurora.example.com", content: "0 5 25568 aurora.example.com" });
  const needs = (host: string, rows: DnsRow[], n = node, s = srv) => dnsNeedsSync({ host, rows }, provider, n, s, now);
  assert.equal(needs("aurora.example.com", []), true, "never written");
  assert.equal(needs("aurora.example.com", [row({})]), true, "the SRV is not there yet");
  assert.equal(needs("aurora.example.com", [row({}), SRV]), false, "written and right");
  assert.equal(needs("aurora.example.com", [row({}), SRV], node, null), true, "an SRV nobody asks for any more goes");
  assert.equal(needs("aurora.example.com", [row({ content: "198.51.100.1" }), SRV]), true, "the node moved");
  assert.equal(needs("aurora.example.com", [row({}), { ...SRV, content: "0 5 25565 aurora.example.com" }]), true, "the server moved to another port");
  assert.equal(needs("aurora.example.com", [row({}), SRV], both), true, "the node got an IPv6 address");
  assert.equal(needs("aurora.example.com", [row({}), row({ kind: "AAAA", content: "2001:db8::9" }), SRV]), true, "and lost it: the AAAA goes");
  assert.equal(needs("aurora.example.com", [row({}), row({ kind: "AAAA", content: "2001:db8::9" }), SRV], both), false);
  assert.equal(needs("aurora.example.com", [row({ name: "old.example.com" }), SRV]), true, "the host changed under a record");
  assert.equal(needs("aurora.example.com", [row({ content: null, error: "no", checkedAt: new Date(now - 60_000) }), SRV]), false, "failed a minute ago: wait");
  assert.equal(needs("aurora.example.com", [row({ content: null, error: "no", checkedAt: new Date(now - 6 * 60_000) }), SRV]), true, "failed six minutes ago: again");
  assert.equal(needs("aurora.example.org", []), false, "outside the zone");
  assert.equal(needs("aurora.example.com", [], { publicAddress: null, publicAddress6: null, observedAddress: "192.168.1.1" }), false, "no address to point at");
});

/* The DNS page walks somebody through the provider they chose. What it
   says has to be true of the provider, and what it ticks has to come from
   the panel's own facts. */
test("every provider has four steps, and the panel can tick each only from what it holds", () => {
  for (const kind of ["duckdns", "cloudflare"] as const) {
    assert.equal(guideFor(kind).length, 4, kind);
    assert.ok(PITCH[kind].label && PITCH[kind].pitch && PITCH[kind].site.startsWith("https://"), kind);
    for (const step of guideFor(kind)) assert.ok(step.title && step.body, `${kind}: ${step.title}`);
  }
  assert.deepEqual(guideDone({ saved: false, written: 0 }), [false, false, false, false]);
  assert.deepEqual(guideDone({ saved: true, written: 0 }), [true, true, true, false]);
  assert.deepEqual(guideDone({ saved: true, written: 2 }), [true, true, true, true]);
});

test("DuckDNS is told to make its subdomains by hand, and Cloudflare that there is nothing to make", () => {
  const duck = guideFor("duckdns").map((s) => s.body).join(" ");
  assert.match(duck, /cannot do this one for you/);
  assert.match(guideFor("cloudflare")[3]!.title, /Nothing to make first/);
  // Cloudflare's token page is linked, with both permissions named, and never the global key.
  assert.equal(guideFor("cloudflare")[1]!.link?.href, "https://dash.cloudflare.com/profile/api-tokens");
  assert.match(guideFor("cloudflare")[1]!.body, /Zone → Zone → Read.*Zone → DNS → Edit/);
  assert.match(guideFor("cloudflare")[1]!.body, /never the global key/);
});

/* DuckDNS answers for every name under an account's subdomain with that
   subdomain's address (checked from two public resolvers, at two depths),
   so the name that owns the address is the last label before duckdns.org. */
test("a DuckDNS name belongs to the subdomain it sits under, at any depth", () => {
  assert.equal(duckBase("myserver.duckdns.org"), "myserver");
  assert.equal(duckBase("aurora.myserver.duckdns.org"), "myserver");
  assert.equal(duckBase("a.b.myserver.duckdns.org"), "myserver");
  assert.equal(duckBase("myserver.duckdns.org.example.com"), null);
  assert.equal(duckBase("notduckdns.org"), null);
  assert.equal(sameDuckBase("aurora.myserver.duckdns.org", "myserver.duckdns.org"), true);
  assert.equal(sameDuckBase("aurora.myserver.duckdns.org", "wipe.myserver.duckdns.org"), true);
  assert.equal(sameDuckBase("aurora.myserver.duckdns.org", "aurora.other.duckdns.org"), false);
  assert.equal(sameDuckBase("aurora.example.com", "aurora.example.com"), false, "not DuckDNS at all");
});

/* The wizard says what the typed address comes to. One test per thing it can
   say, so a change to a sentence is a change somebody meant. */
const NODES = [
  { name: "fra-node-02", addresses: ["203.0.113.9"] },
  { name: "ash-node-01", addresses: [] as string[] },
];
const missing: Lookup = { kind: "missing" };
const at = (...addresses: string[]): Lookup => ({ kind: "found", addresses });
const cloudflare = { kind: "cloudflare" as const, zone: "example.com" };
const duck = { kind: "duckdns" as const, zone: "duckdns.org" };

test("no provider, and the name does not exist: it says so, and offers a provider", () => {
  const v = judgeAddress({ host: "aurora.example.com", lookup: missing, nodes: NODES, provider: null });
  assert.equal(v.tone, "info");
  assert.match(v.title, /does not exist yet/);
  assert.match(v.body, /Players cannot join by it/);
  assert.equal(v.offerSetup, true);
});

test("no provider, and the name already points at a node: nothing to offer", () => {
  const v = judgeAddress({ host: "aurora.example.com", lookup: at("203.0.113.9"), nodes: NODES, provider: null });
  assert.equal(v.tone, "success");
  assert.equal(v.title, "Points at fra-node-02");
  assert.equal(v.offerSetup, false);
});

test("a name that points at a node's IPv6 address is a name that points at the node", () => {
  const dual = [{ name: "fra-node-02", addresses: ["203.0.113.9", "2001:db8::9"] }];
  assert.equal(judgeAddress({ host: "aurora.example.com", lookup: at("2001:db8::9"), nodes: dual, provider: null }).title, "Points at fra-node-02");
  assert.equal(judgeAddress({ host: "aurora.example.com", lookup: at("203.0.113.9", "2001:db8::9"), nodes: dual, provider: cloudflare }).title, "Already points at fra-node-02");
});

test("no provider, and the name points at a machine that is not a node: said, with the offer", () => {
  const v = judgeAddress({ host: "aurora.example.com", lookup: at("198.51.100.1"), nodes: NODES, provider: null });
  assert.equal(v.tone, "warning");
  assert.match(v.title, /198\.51\.100\.1/);
  assert.match(v.body, /not one of your nodes/);
  assert.equal(v.offerSetup, true);
  const home = judgeAddress({ host: "aurora.example.com", lookup: at("192.168.1.20"), nodes: NODES, provider: null });
  assert.match(home.body, /private address/, "a private address is said to be one");
});

test("no provider, and the lookup failed: it says it could not check, and does not block", () => {
  const v = judgeAddress({ host: "aurora.example.com", lookup: { kind: "failed", reason: lookupFailure("ETIMEOUT") }, nodes: NODES, provider: null });
  assert.equal(v.tone, "muted");
  assert.match(v.body, /did not answer in time/);
  assert.match(v.body, /You can still create the server/);
  assert.equal(v.offerSetup, true);
});

test("with a provider, a name under its zone is the panel's to write, and says what will happen", () => {
  const fresh = judgeAddress({ host: "aurora.example.com", lookup: missing, nodes: NODES, provider: cloudflare });
  assert.equal(fresh.tone, "success");
  assert.match(fresh.title, /Geeboard will create this record/);
  assert.equal(fresh.offerSetup, false);
  const right = judgeAddress({ host: "aurora.example.com", lookup: at("203.0.113.9"), nodes: NODES, provider: cloudflare });
  assert.match(right.title, /Already points at fra-node-02/);
  const other = judgeAddress({ host: "aurora.example.com", lookup: at("198.51.100.1"), nodes: NODES, provider: cloudflare });
  assert.equal(other.tone, "warning");
  assert.match(other.body, /leaves a record it did not make alone/);
  const dk = judgeAddress({ host: "aurora.myserver.duckdns.org", lookup: at("198.51.100.1"), nodes: NODES, provider: duck });
  assert.equal(dk.tone, "info");
  assert.match(dk.title, /point it at the node/);
  const dkNew = judgeAddress({ host: "aurora.myserver.duckdns.org", lookup: missing, nodes: NODES, provider: duck });
  assert.match(dkNew.body, /subdomain is one you made on duckdns\.org/);
});

test("with a provider and no node that has an address, it says what is missing", () => {
  const v = judgeAddress({ host: "aurora.example.com", lookup: missing, nodes: [{ name: "ash-node-01", addresses: [] }], provider: cloudflare });
  assert.equal(v.tone, "warning");
  assert.equal(v.title, "No node has a public address yet");
  assert.match(v.body, /Configure/);
  assert.equal(v.offerSetup, false, "the provider is set; what is missing is an address");
});

test("with a provider, a name outside its zone is the creator's, and says so", () => {
  const v = judgeAddress({ host: "aurora.example.org", lookup: missing, nodes: NODES, provider: cloudflare });
  assert.equal(v.tone, "warning");
  assert.equal(v.title, "Not under example.com");
  assert.match(v.body, /create this one yourself/);
  assert.equal(v.offerSetup, false);
  const right = judgeAddress({ host: "aurora.example.org", lookup: at("203.0.113.9"), nodes: NODES, provider: cloudflare });
  assert.equal(right.tone, "success");
});
