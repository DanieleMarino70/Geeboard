import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress, sourceBucket, sourceOf, trustedHopsFrom } from "../src/domain/access/source.ts";

/* Who a request came from, for the limits that count by it. The first X-Forwarded-For entry is the client's claim; the
   one to believe is the one the proxy wrote. */

test("the entry a proxy of ours wrote is the one believed, not the one the client chose", () => {
  // The nginx block in the docs appends the peer it saw to what the client sent.
  assert.equal(clientAddress("1.2.3.4, 203.0.113.9"), "203.0.113.9");
  assert.equal(clientAddress("6.6.6.6, 7.7.7.7, 203.0.113.9"), "203.0.113.9");
  // Caddy writes the header afresh: one entry, the peer.
  assert.equal(clientAddress("203.0.113.9"), "203.0.113.9");
});

test("a script that sends a different first entry with every try stays one source", () => {
  const buckets = new Set(Array.from({ length: 50 }, (_, i) => sourceOf(`10.9.8.${i}, 203.0.113.9`)));
  assert.deepEqual([...buckets], ["203.0.113.9"]);
});

test("two proxies in front believe the second from the right", () => {
  assert.equal(clientAddress("1.2.3.4, 198.51.100.7, 10.0.0.2", 2), "198.51.100.7");
  assert.equal(clientAddress("198.51.100.7", 2), "198.51.100.7", "fewer entries than proxies: the nearest there is");
});

test("no proxy in front means no header is believed", () => {
  assert.equal(clientAddress("1.2.3.4, 5.6.7.8", 0), null);
  assert.equal(sourceOf("1.2.3.4", 0), "unknown");
  assert.equal(sourceOf(null), "unknown");
  assert.equal(sourceOf(""), "unknown");
  assert.equal(sourceOf("not an address"), "unknown");
});

test("how a proxy writes the address does not matter", () => {
  assert.equal(clientAddress("203.0.113.9:51234"), "203.0.113.9");
  assert.equal(clientAddress("[2001:db8::1]:51234"), "2001:db8::1");
  assert.equal(clientAddress("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(clientAddress(" 203.0.113.9 "), "203.0.113.9");
});

test("an IPv6 prefix is one source: a /64 is what one subscriber is handed", () => {
  assert.equal(sourceBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(sourceBucket("2001:db8:1:2:1111:2222:3333:4444"), "2001:db8:1:2::/64");
  assert.equal(sourceBucket("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(sourceBucket("2001:db8:0:0:5::1"), "2001:db8:0:0::/64");
  assert.notEqual(sourceBucket("2001:db8:1:3::1"), sourceBucket("2001:db8:1:2::1"));
  assert.equal(sourceBucket("203.0.113.9"), "203.0.113.9", "IPv4 is one machine");
  assert.equal(sourceBucket("::1"), "0:0:0:0::/64");
});

test("the number of proxies comes from the environment, and a bad value is the default", () => {
  assert.equal(trustedHopsFrom(undefined), 1);
  assert.equal(trustedHopsFrom(""), 1);
  assert.equal(trustedHopsFrom("0"), 0);
  assert.equal(trustedHopsFrom("2"), 2);
  assert.equal(trustedHopsFrom("-1"), 1);
  assert.equal(trustedHopsFrom("two"), 1);
  assert.equal(trustedHopsFrom("99"), 1);
});
