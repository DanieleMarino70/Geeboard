import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketEndpointProblem, judgeBucketAddresses } from "../src/domain/storage/endpoint.ts";

/* Where the panel may send its own requests to a bucket. A store on this
   machine or on the LAN is the usual way to run it and is allowed; the
   address a cloud keeps the machine's credentials at is not, in any
   spelling. */

const problem = (endpoint: string) => bucketEndpointProblem(new URL(endpoint));

test("a bucket on a public address, on the LAN, or on this machine is allowed", () => {
  for (const endpoint of [
    "https://s3.eu-west-1.amazonaws.com",
    "https://203.0.113.9:9000",
    "http://minio:9000",
    "http://10.0.0.5:9000",
    "http://192.168.1.20:9000",
    "http://172.17.0.1:9000",
    "http://127.0.0.1:9000",
    "http://[::1]:9000",
    "http://[2001:db8::1]:9000",
    "http://[fd12::1]:9000",
    "http://localhost:9000",
  ]) {
    assert.equal(problem(endpoint), null, endpoint);
  }
});

test("the metadata address and its relatives are refused, in every spelling", () => {
  for (const endpoint of [
    "http://169.254.169.254",
    "http://169.254.169.254/latest/meta-data/",
    "http://2852039166", // the same address as one number
    "http://0xa9fea9fe",
    "http://0251.0376.0251.0376", // octal
    "http://[::ffff:169.254.169.254]",
    "http://[::ffff:a9fe:a9fe]",
    "http://[64:ff9b::a9fe:a9fe]",
    "http://[2002:a9fe:a9fe::]",
    "http://[fe80::1]",
    "http://[fd00:ec2::254]",
    "http://169.254.0.1:9000",
    "http://0.0.0.0:9000",
    "http://[::]:9000",
    "http://224.0.0.1",
    "http://240.0.0.1",
    "http://255.255.255.255",
  ]) {
    assert.match(problem(endpoint) ?? "", /will not call/, endpoint);
  }
});

test("a name is judged by what it resolves to, every address of it", () => {
  assert.equal(judgeBucketAddresses(["203.0.113.9"]).ok, true);
  assert.equal(judgeBucketAddresses(["10.0.0.5", "127.0.0.1", "203.0.113.9"]).ok, true, "all three are allowed for a bucket");
  assert.equal(judgeBucketAddresses(["203.0.113.9", "169.254.169.254"]).ok, false, "one metadata address among good ones");
  assert.equal(judgeBucketAddresses(["::ffff:169.254.169.254"]).ok, false);
  assert.equal(judgeBucketAddresses([]).ok, false);
  assert.equal(judgeBucketAddresses(["nonsense"]).ok, false);
  const refused = judgeBucketAddresses(["169.254.169.254"]);
  assert.ok(!refused.ok && /cloud's metadata service/.test(refused.reason) && !/169\.254/.test(refused.reason), "says why, without repeating the address");
});
