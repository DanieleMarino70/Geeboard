import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DNS_KINDS,
  DNS_PROVIDERS,
  coveredBy,
  isDnsKind,
  providerFacts,
  providerHoldsSrv,
  srvOf,
  wantedRecords,
} from "../src/domain/dns/rules.ts";
import { MINECRAFT_JAVA } from "../src/domain/games/definitions/minecraft-java.ts";
import { WEBHOOK_TTL, deliveryId, judgeSigningSecret, judgeStatus, parseSrv, removeBody, setBody, testBody } from "../src/domain/dns/webhook.ts";
import { signBody, signatureMatches } from "../src/domain/notify/format.ts";

/* The table of what each DNS provider is and can do. The code used to say "Cloudflare, or else DuckDNS" in a dozen
   places; with a third provider every one of them reads this, and a kind that is not in it is an error. */
test("every provider kind is in the table once, and the page offers each of them", () => {
  assert.deepEqual(Object.keys(DNS_PROVIDERS).sort(), ["cloudflare", "duckdns", "webhook"]);
  assert.deepEqual(DNS_KINDS.map((k) => k.id).sort(), Object.keys(DNS_PROVIDERS).sort());
  for (const [id, facts] of Object.entries(DNS_PROVIDERS)) {
    assert.equal(facts.id, id);
    assert.ok(facts.label);
    assert.ok(facts.took === "written" || facts.took === "accepted");
  }
});

test("what each provider can do is a fact in the table, not a branch in the code", () => {
  assert.deepEqual([DNS_PROVIDERS.cloudflare.srv, DNS_PROVIDERS.cloudflare.read, DNS_PROVIDERS.cloudflare.took], [true, true, "written"]);
  assert.deepEqual([DNS_PROVIDERS.duckdns.srv, DNS_PROVIDERS.duckdns.read, DNS_PROVIDERS.duckdns.took], [false, false, "written"]);
  assert.deepEqual([DNS_PROVIDERS.webhook.srv, DNS_PROVIDERS.webhook.read, DNS_PROVIDERS.webhook.took], [true, false, "accepted"], "a receiver takes an SRV, cannot be asked, and says accepted");
  assert.equal(DNS_PROVIDERS.duckdns.zoneFixed, "duckdns.org");
  assert.equal(DNS_PROVIDERS.cloudflare.zoneFixed, null);
  assert.equal(DNS_PROVIDERS.webhook.zoneFixed, null);
  for (const kind of ["cloudflare", "duckdns", "webhook"] as const) assert.equal(providerHoldsSrv(kind), DNS_PROVIDERS[kind].srv);
});

test("a kind that is not in the table is not a kind, and is never taken for another", () => {
  assert.equal(isDnsKind("webhook"), true);
  assert.equal(isDnsKind("route53"), false);
  assert.equal(isDnsKind(""), false);
  assert.equal(isDnsKind(undefined), false);
  assert.equal(isDnsKind(7), false);
  // Names every object has are not providers.
  for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"]) assert.equal(isDnsKind(name), false, name);
  assert.throws(() => providerFacts("route53"), /unknown DNS provider kind: route53/);
  assert.equal(providerFacts("webhook").label, "Webhook");
});

test("a webhook's zone is the receiver's domain, covered the way Cloudflare's is, and a name outside it is not sent", () => {
  assert.equal(coveredBy("webhook", "example.com", "aurora.example.com"), true);
  assert.equal(coveredBy("webhook", "example.com", "example.com"), true);
  assert.equal(coveredBy("webhook", "example.com", "aurora.example.org"), false);
  assert.equal(coveredBy("webhook", "example.com", "notexample.com"), false);
  // A webhook with the zone duckdns.org is not DuckDNS: its names are covered by suffix, and one subdomain deep is just a name.
  assert.equal(coveredBy("webhook", "duckdns.org", "duckdns.org"), true);
});

test("a webhook is sent the A, the AAAA and the SRV a server wants", () => {
  const node = { publicAddress: "203.0.113.9", publicAddress6: "2001:db8::9", observedAddress: null };
  const wanted = wantedRecords({ host: "aurora.example.com", node, provider: { kind: "webhook" }, srv: srvOf(MINECRAFT_JAVA, 25568) });
  assert.deepEqual(wanted.records.map((r) => `${r.kind} ${r.name} ${r.content}`), [
    "A aurora.example.com 203.0.113.9",
    "AAAA aurora.example.com 2001:db8::9",
    "SRV _minecraft._tcp.aurora.example.com 0 5 25568 aurora.example.com",
  ]);
});

/* What the receiver is sent. It is a contract somebody writes code against, so it is pinned field by field. */
const AT = new Date("2026-10-04T10:00:00.000Z");

test("a record to set says what it is, where it is, and whose it is", () => {
  const body = setBody("example.com", { kind: "A", name: "aurora.example.com", content: "203.0.113.9" }, "geeboard:srv_1", AT);
  assert.deepEqual(body, {
    version: 1,
    event: "dns.set",
    zone: "example.com",
    record: { type: "A", name: "aurora.example.com", content: "203.0.113.9", ttl: WEBHOOK_TTL, comment: "geeboard:srv_1" },
    sentAt: "2026-10-04T10:00:00.000Z",
  });
  assert.equal(WEBHOOK_TTL, 60);
});

test("an SRV record is sent as its content and as its four fields, so a receiver need not split a string", () => {
  const body = setBody("example.com", { kind: "SRV", name: "_minecraft._tcp.aurora.example.com", content: "0 5 25568 aurora.example.com" }, "geeboard:srv_1", AT);
  assert.deepEqual(body.record.srv, { priority: 0, weight: 5, port: 25568, target: "aurora.example.com" });
  assert.equal(body.record.content, "0 5 25568 aurora.example.com");
  assert.deepEqual(parseSrv("0 5 25565 aurora.example.com."), { priority: 0, weight: 5, port: 25565, target: "aurora.example.com" }, "a trailing dot is not part of the target");
  assert.equal(parseSrv("0 5 25565"), null);
  assert.equal(parseSrv("0 5 99999 a.example.com"), null);
  assert.equal(parseSrv("x 5 25565 a.example.com"), null);
  const noSrv = setBody("example.com", { kind: "A", name: "a.example.com", content: "203.0.113.9" }, "m", AT);
  assert.equal("srv" in noSrv.record, false, "an address record carries no srv field");
});

test("removing a record names its type and its name, and nothing else", () => {
  assert.deepEqual(removeBody("example.com", { kind: "AAAA", name: "aurora.example.com" }, AT), {
    version: 1,
    event: "dns.remove",
    zone: "example.com",
    record: { type: "AAAA", name: "aurora.example.com" },
    sentAt: "2026-10-04T10:00:00.000Z",
  });
  assert.deepEqual(testBody("example.com", AT), { version: 1, event: "dns.test", zone: "example.com", sentAt: "2026-10-04T10:00:00.000Z" });
});

/* A delivery id is the same for the same thing said again, and not for anything else. A signature and a timestamp are
   not: they change with every attempt, which is why they cannot be what a receiver deduplicates on. */
test("a delivery id is made of what is asked, not of when", () => {
  const rec = { kind: "A" as const, name: "aurora.example.com", content: "203.0.113.9" };
  const first = deliveryId(setBody("example.com", rec, "geeboard:a", AT));
  const again = deliveryId(setBody("example.com", rec, "geeboard:a", new Date(AT.getTime() + 300_000)));
  assert.equal(first, again, "a retry five minutes later is the same delivery");
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.notEqual(first, deliveryId(setBody("example.com", { ...rec, content: "203.0.113.10" }, "geeboard:a", AT)), "another address is another delivery");
  assert.notEqual(first, deliveryId(setBody("example.com", { ...rec, kind: "AAAA" }, "geeboard:a", AT)), "another type is another one");
  assert.notEqual(first, deliveryId(setBody("example.com", { ...rec, name: "b.example.com" }, "geeboard:a", AT)));
  const removal = deliveryId(removeBody("example.com", rec, AT));
  assert.notEqual(first, removal, "setting and removing the same record are different deliveries");
  assert.equal(removal, deliveryId(removeBody("example.com", rec, new Date(0))));
  assert.notEqual(removal, deliveryId(testBody("example.com", AT)));
});

test("a request is signed as a notification is, over the timestamp and the exact body", () => {
  const body = JSON.stringify(setBody("example.com", { kind: "A", name: "a.example.com", content: "203.0.113.9" }, "m", AT));
  const sig = signBody("gbwh_secret-secret-secret", 1_790_000_000, body);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(signatureMatches("gbwh_secret-secret-secret", 1_790_000_000, body, sig), true);
  assert.equal(signatureMatches("gbwh_secret-secret-secret", 1_790_000_001, body, sig), false, "another timestamp");
  assert.equal(signatureMatches("gbwh_other-secret-other-xx", 1_790_000_000, body, sig), false, "another secret");
  assert.equal(signatureMatches("gbwh_secret-secret-secret", 1_790_000_000, body.replace("203.0.113.9", "203.0.113.8"), sig), false, "another body");
});

/* What a status means. A receiver's words are never read, so the phrases are fixed and name the code and nothing else. */
test("2xx is accepted, and so is a remove of what is not there", () => {
  for (const status of [200, 201, 202, 204]) assert.deepEqual(judgeStatus("dns.set", status), { ok: true }, String(status));
  assert.deepEqual(judgeStatus("dns.test", 204), { ok: true });
  assert.deepEqual(judgeStatus("dns.remove", 404), { ok: true });
  assert.deepEqual(judgeStatus("dns.remove", 410), { ok: true });
  assert.equal(judgeStatus("dns.set", 404).ok, false, "a set at an address that is not there is a mistake");
  assert.equal(judgeStatus("dns.test", 404).ok, false);
});

test("a receiver that does not trust the signature is a refused secret, and one that is struggling is a failure to retry", () => {
  for (const status of [401, 403]) {
    const r = judgeStatus("dns.set", status);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "DNS_TOKEN_REFUSED", String(status));
      assert.match(r.message, new RegExp(`HTTP ${status}`));
      assert.match(r.message, /holds the secret/);
    }
  }
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const r = judgeStatus("dns.set", status);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, "DNS_PROVIDER_FAILED", String(status));
      assert.match(r.message, /could not take the record just now/);
    }
  }
  const redirect = judgeStatus("dns.set", 302);
  assert.equal(redirect.ok, false);
  if (!redirect.ok) assert.match(redirect.message, /does not follow/);
});

test("any other refusal is of that record, and says which status it was", () => {
  const r = judgeStatus("dns.set", 422);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "DNS_PROVIDER_FAILED");
    assert.equal(r.message, "The receiver refused this record (HTTP 422).");
  }
  const t = judgeStatus("dns.test", 400);
  if (!t.ok) assert.equal(t.message, "The receiver answered HTTP 400 to the test.");
  // Nothing in a message can be what a receiver wrote: it is built from the status alone.
  for (const status of [400, 409, 422, 451]) {
    const m = judgeStatus("dns.set", status);
    if (!m.ok) assert.doesNotMatch(m.message, /[<>{}]/);
  }
});

test("a signing secret is long enough, has no spaces, and is not a novel", () => {
  assert.equal(judgeSigningSecret("gbwh_" + "a".repeat(64)), null);
  assert.match(judgeSigningSecret("short")!, /at least 16/);
  assert.match(judgeSigningSecret("has a space in it, sixteen+")!, /no spaces/);
  assert.match(judgeSigningSecret("x".repeat(201))!, /too long/);
  assert.equal(judgeSigningSecret("x".repeat(16)), null);
  assert.match(judgeSigningSecret("x".repeat(15))!, /at least 16/);
});
