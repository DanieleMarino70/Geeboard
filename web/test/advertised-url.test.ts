import assert from "node:assert/strict";
import { test } from "node:test";
import { advertisedUrlProblem } from "../src/domain/nodes/advertised-url.ts";

/* The address a node registers with is called, with its token, for as long as it exists. A LAN or loopback address is how a
   panel and a node on one host reach each other, so those pass; what cannot be a node's does not. */

const problem = (text: string) => advertisedUrlProblem(new URL(text));

test("the addresses a node really has are fine", () => {
  for (const ok of [
    "http://203.0.113.10:8080",
    "https://node.example.com:8080",
    "http://192.168.1.20:8080",
    "http://10.0.0.5:8080",
    "http://172.17.0.1:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://[2001:db8::10]:8080",
    "http://[::1]:8080",
    "http://fra-node-02:8080",
  ]) {
    assert.equal(problem(ok), null, ok);
  }
});

test("the cloud metadata service is refused in every spelling there is", () => {
  assert.match(problem("http://169.254.169.254/")!, /link-local/);
  assert.match(problem("http://169.254.0.1:8080")!, /link-local/);
  assert.match(problem("http://metadata.google.internal/")!, /metadata/);
  assert.match(problem("http://[fd00:ec2::254]/")!, /metadata/);
  assert.match(problem("http://[fe80::1]:8080")!, /link-local/);
  assert.match(problem("http://[::ffff:169.254.169.254]/")!, /link-local|another spelling/);
});

test("the metadata address is refused in the spellings a text filter missed, and a name with a dot at its end is the name", () => {
  for (const hidden of [
    "http://[::a9fe:a9fe]/", // the deprecated IPv4-compatible form
    "http://[64:ff9b::a9fe:a9fe]/", // NAT64
    "http://[2002:a9fe:a9fe::]/", // 6to4
    "http://[::ffff:0:a9fe:a9fe]/", // SIIT
    "http://[64:ff9b:1::a9fe:a9fe]/", // local-use NAT64
  ]) {
    assert.match(problem(hidden)!, /link-local/, hidden);
  }
  assert.match(problem("http://[::ffff:224.0.0.1]/")!, /multicast/);
  assert.match(problem("http://[::ffff:0.0.0.0]/")!, /unspecified|not an address/);
  assert.match(problem("http://metadata.google.internal./")!, /metadata/);
  assert.match(problem("http://instance-data./")!, /metadata/);
  assert.match(problem("http://metadata.goog/")!, /metadata/);
  for (const other of ["http://100.100.100.200/", "http://168.63.129.16/", "http://192.0.0.192/"]) assert.match(problem(other)!, /metadata/, other);
  // A name is not resolved here: whoever registers a node chooses where it is, and docs/security.md says so.
  assert.equal(problem("http://169.254.169.254.nip.io/"), null);
});

test("an address with credentials in it is refused, and so is one that is nobody's", () => {
  assert.match(problem("http://user:pass@203.0.113.10:8080")!, /user name or password/);
  assert.match(problem("http://user@203.0.113.10:8080")!, /user name or password/);
  assert.match(problem("http://0.0.0.0:8080")!, /not an address/);
  assert.match(problem("http://[::]:8080")!, /unspecified/);
  assert.match(problem("http://224.0.0.1:8080")!, /multicast/);
  assert.match(problem("http://[ff02::1]:8080")!, /multicast/);
});
