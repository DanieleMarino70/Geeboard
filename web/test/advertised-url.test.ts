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

test("an address with credentials in it is refused, and so is one that is nobody's", () => {
  assert.match(problem("http://user:pass@203.0.113.10:8080")!, /user name or password/);
  assert.match(problem("http://user@203.0.113.10:8080")!, /user name or password/);
  assert.match(problem("http://0.0.0.0:8080")!, /not an address/);
  assert.match(problem("http://[::]:8080")!, /unspecified/);
  assert.match(problem("http://224.0.0.1:8080")!, /multicast/);
  assert.match(problem("http://[ff02::1]:8080")!, /multicast/);
});
