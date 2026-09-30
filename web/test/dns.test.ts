import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addressFamily,
  coveredBy,
  decide,
  dnsNeedsSync,
  dnsStateOf,
  duckBase,
  sameDuckBase,
  isPublicAddress,
  markerFor,
  nodeAddress,
  peerOf,
} from "../src/domain/dns/rules.ts";
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

/* The table in the plan, one row per case. */
test("what to do at a name, given what is already there", () => {
  const wanted = { family: "A" as const, address: "203.0.113.9", marker: markerFor("srv1") };
  const rec = (over: Partial<{ id: string; type: string; content: string; comment: string | null }>) => ({
    id: "r1",
    type: "A",
    name: "aurora.example.com",
    content: "203.0.113.9",
    comment: null,
    ...over,
  });
  assert.deepEqual(decide([], wanted), { action: "create" });
  assert.deepEqual(decide([rec({ type: "TXT", content: "v=spf1" })], wanted), { action: "create" }, "a TXT at the name is not in the way");
  assert.deepEqual(decide([rec({})], wanted), { action: "adopt", id: "r1" }, "same address, not ours: adopted");
  assert.deepEqual(decide([rec({ comment: "geeboard:srv1" })], wanted), { action: "nothing", id: "r1" }, "ours and right: nothing");
  assert.deepEqual(decide([rec({ comment: "geeboard:srv1", content: "198.51.100.1" })], wanted), { action: "update", id: "r1" }, "ours and stale: updated");
  assert.equal(decide([rec({ content: "198.51.100.1" })], wanted).action, "refuse", "not ours, pointing elsewhere: refused");
  assert.equal(decide([rec({ type: "CNAME", content: "elsewhere.example.net" })], wanted).action, "refuse");
  assert.equal(decide([rec({}), rec({ id: "r2", type: "AAAA", content: "2001:db8::1" })], wanted).action, "refuse", "two records: refused");
  assert.equal(decide([rec({ type: "AAAA", content: "2001:db8::1", comment: "geeboard:srv1" })], wanted).action, "update", "ours, other family: rewritten");
  assert.equal(decide([rec({ comment: "geeboard:srv2", content: "198.51.100.1" })], wanted).action, "refuse", "another server's marker is not ours");
});

test("how a server's record stands", () => {
  const provider = { kind: "cloudflare" as const, zone: "example.com" };
  const node = { publicAddress: "203.0.113.9", observedAddress: null };
  const s = (over: Partial<{ host: string; dnsAddress: string | null; dnsError: string | null }>) => ({ host: "aurora.example.com", dnsAddress: null, dnsError: null, ...over });
  assert.equal(dnsStateOf(s({}), null, node).state, "none");
  assert.equal(dnsStateOf(s({ host: "aurora.example.org" }), provider, node).state, "outside");
  assert.equal(dnsStateOf(s({ dnsAddress: "203.0.113.9" }), provider, node).state, "set");
  assert.equal(dnsStateOf(s({ dnsError: "Cloudflare is unreachable." }), provider, node).state, "failed");
  assert.equal(dnsStateOf(s({}), provider, { publicAddress: null, observedAddress: "10.0.0.1" }).state, "no-address");
  assert.equal(dnsStateOf(s({}), provider, node).state, "failed", "an address to point at and nothing written yet");
});

test("the poller tries a record when the address moved or the last try is old", () => {
  const provider = { kind: "cloudflare" as const, zone: "example.com" };
  const node = { publicAddress: "203.0.113.9", observedAddress: null };
  const now = Date.parse("2026-09-29T10:00:00Z");
  const s = (over: Partial<{ host: string; dnsAddress: string | null; dnsError: string | null; dnsCheckedAt: Date | null }>) => ({
    host: "aurora.example.com",
    dnsAddress: null,
    dnsError: null,
    dnsCheckedAt: null,
    ...over,
  });
  assert.equal(dnsNeedsSync(s({}), provider, node, now), true, "never written");
  assert.equal(dnsNeedsSync(s({ dnsAddress: "203.0.113.9" }), provider, node, now), false, "written and right");
  assert.equal(dnsNeedsSync(s({ dnsAddress: "198.51.100.1" }), provider, node, now), true, "the node moved");
  assert.equal(dnsNeedsSync(s({ dnsError: "no", dnsCheckedAt: new Date(now - 60_000) }), provider, node, now), false, "failed a minute ago: wait");
  assert.equal(dnsNeedsSync(s({ dnsError: "no", dnsCheckedAt: new Date(now - 6 * 60_000) }), provider, node, now), true, "failed six minutes ago: again");
  assert.equal(dnsNeedsSync(s({ host: "aurora.example.org" }), provider, node, now), false, "outside the zone");
  assert.equal(dnsNeedsSync(s({}), provider, { publicAddress: null, observedAddress: "192.168.1.1" }, now), false, "no address to point at");
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
  { name: "fra-node-02", address: "203.0.113.9" },
  { name: "ash-node-01", address: null as string | null },
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
  const v = judgeAddress({ host: "aurora.example.com", lookup: missing, nodes: [{ name: "ash-node-01", address: null }], provider: cloudflare });
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
