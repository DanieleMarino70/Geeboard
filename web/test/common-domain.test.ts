import assert from "node:assert/strict";
import { test } from "node:test";
import { commonDomain } from "../src/domain/dns/rules.ts";

/* The domain a new server's address starts under. On a workspace with nothing to go on it is nothing: it was the sample workspace's
   `ashfold.gg` for every install, a name nobody who runs the panel owns. */

test("the domain most servers sit under", () => {
  assert.equal(commonDomain(["a.example.com", "b.example.com", "c.other.net"]), "example.com");
});

test("no servers, no domain", () => {
  assert.equal(commonDomain([]), null);
});

test("a name with no dot has no domain", () => {
  assert.equal(commonDomain(["localhost"]), null);
});

test("an address is not a name under a domain", () => {
  assert.equal(commonDomain(["203.0.113.9", "203.0.113.10"]), null);
  assert.equal(commonDomain(["2001:db8::1"]), null);
  assert.equal(commonDomain(["203.0.113.9", "play.example.com"]), "example.com");
});
