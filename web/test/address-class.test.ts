import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAddress, literalFamily, type AddressClass } from "../src/domain/net/address.ts";

/* What kind of place an address is. The cases that matter are the ones a
   check on the outside of the address would get wrong: IPv4 hidden in IPv6,
   and the one address a cloud keeps its credentials at. */

const classes: Array<[string, AddressClass]> = [
  // IPv4
  ["8.8.8.8", "public"],
  ["1.1.1.1", "public"],
  ["203.0.113.9", "public"], // a documentation range: public here, as everywhere in the project
  ["172.15.0.1", "public"],
  ["172.32.0.1", "public"],
  ["100.63.255.255", "public"],
  ["100.128.0.1", "public"],
  ["10.0.0.1", "private"],
  ["10.255.255.255", "private"],
  ["172.16.0.1", "private"],
  ["172.31.255.254", "private"],
  ["192.168.0.100", "private"],
  ["100.64.0.1", "private"],
  ["100.127.255.254", "private"],
  ["127.0.0.1", "loopback"],
  ["127.255.255.254", "loopback"],
  ["169.254.169.254", "link-local"], // where a cloud's metadata service answers
  ["169.254.0.1", "link-local"],
  ["0.0.0.0", "unspecified"],
  ["0.1.2.3", "unspecified"],
  ["224.0.0.1", "multicast"],
  ["239.255.255.255", "multicast"],
  ["240.0.0.1", "reserved"],
  ["255.255.255.255", "reserved"],
  // IPv6
  ["2001:4860:4860::8888", "public"],
  ["2001:db8::1", "public"],
  ["::1", "loopback"],
  ["::", "unspecified"],
  ["fe80::1", "link-local"],
  ["febf::1", "link-local"],
  ["fec0::1", "private"], // site-local, deprecated
  ["fc00::1", "private"],
  ["fd12:3456:789a::1", "private"],
  ["fd00:ec2::254", "metadata"], // AWS's IPv6 metadata address lives in unique-local space
  ["ff02::1", "multicast"],
  // IPv4 inside IPv6: judged as what it carries
  ["::ffff:127.0.0.1", "loopback"],
  ["::ffff:7f00:1", "loopback"],
  ["::ffff:169.254.169.254", "link-local"],
  ["::ffff:a9fe:a9fe", "link-local"],
  ["::ffff:10.0.0.5", "private"],
  ["::ffff:8.8.8.8", "public"],
  ["::127.0.0.1", "loopback"],
  ["64:ff9b::7f00:1", "loopback"], // NAT64: a gateway forwards it to 127.0.0.1
  ["64:ff9b::a9fe:a9fe", "link-local"],
  ["64:ff9b::808:808", "public"],
  ["2002:7f00:1::", "loopback"], // 6to4 with 127.0.0.1 inside
  ["2002:a9fe:a9fe::1", "link-local"],
  ["2002:808:808::1", "public"],
];

test("an address is named for what it is", () => {
  for (const [address, expected] of classes) {
    assert.equal(classifyAddress(address), expected, address);
  }
});

test("brackets and a zone are not part of the address", () => {
  assert.equal(classifyAddress("[::1]"), "loopback");
  assert.equal(classifyAddress("[2001:db8::1]"), "public");
  assert.equal(classifyAddress("fe80::1%eth0"), "link-local");
});

test("upper case and zero compression are the same address", () => {
  assert.equal(classifyAddress("FD00:EC2::254"), "metadata");
  assert.equal(classifyAddress("0:0:0:0:0:0:0:1"), "loopback");
  assert.equal(classifyAddress("0:0:0:0:0:ffff:7f00:1"), "loopback");
});

test("a name, or anything that is not a literal, has no class: it has to be resolved first", () => {
  for (const value of ["", "example.com", "localhost", "hooks.example.com", "1.2.3", "1.2.3.4.5", "256.1.1.1", "010.0.0.1", "0x7f.0.0.1", "2130706433", "gggg::1", "1::2::3", ":::", "12345::"]) {
    assert.equal(classifyAddress(value), null, JSON.stringify(value));
  }
});

test("only a strict literal is a literal", () => {
  assert.equal(literalFamily("8.8.8.8"), "A");
  assert.equal(literalFamily("::1"), "AAAA");
  assert.equal(literalFamily("010.0.0.1"), null, "a leading zero is how an octal form hides a loopback address");
  assert.equal(literalFamily("localhost"), null);
});
