import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeDestination,
  judgeAddresses,
  judgeUrl,
  policyFromEnvironment,
  PRIVATE_NETWORKS_VARIABLE,
  type DestinationPolicy,
} from "../src/domain/notify/destination.ts";

/* Where the panel may send a notification. The rules are the security of
   the feature: a webhook is an address a person types, called from inside
   the panel's own network. */

const STRICT: DestinationPolicy = { allowPrivate: false };
const LAN: DestinationPolicy = { allowPrivate: true };
const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG";
const DISCORD = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;

const reasonOf = (v: ReturnType<typeof judgeUrl>) => (v.ok ? null : v.reason);

test("a Discord webhook is what Discord issues, and nothing else", () => {
  for (const host of ["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"]) {
    const v = judgeUrl("DISCORD", `https://${host}/api/webhooks/123456789012345678/${TOKEN}`, STRICT);
    assert.ok(v.ok, host);
  }
  assert.ok(judgeUrl("DISCORD", `https://discord.com/api/v10/webhooks/123456789012345678/${TOKEN}`, STRICT).ok, "a versioned path");
  assert.ok(judgeUrl("DISCORD", `${DISCORD}?thread_id=123456789012345678&wait=true`, STRICT).ok, "a thread, and waiting");
});

test("anything that is not exactly that is refused for Discord, whatever the policy", () => {
  const refused = [
    `http://discord.com/api/webhooks/123456789012345678/${TOKEN}`, // not https
    `https://discord.com:8443/api/webhooks/123456789012345678/${TOKEN}`, // a port
    `https://discord.com.evil.example/api/webhooks/123456789012345678/${TOKEN}`, // a host that starts like it
    `https://evil.example/api/webhooks/123456789012345678/${TOKEN}`,
    `https://discord.com@evil.example/api/webhooks/123456789012345678/${TOKEN}`, // a login, and a different host
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}/github`, // a suffix
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}/`,
    `https://discord.com/api/webhooks/abc/${TOKEN}`,
    "https://discord.com/api/webhooks/123456789012345678/short",
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}?url=http://169.254.169.254/`, // an option it does not take
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}#x`,
    `https://127.0.0.1/api/webhooks/123456789012345678/${TOKEN}`,
    "https://discord.com/",
    "not a url",
    "",
  ];
  for (const raw of refused) {
    for (const policy of [STRICT, LAN]) {
      assert.equal(judgeUrl("DISCORD", raw, policy).ok, false, raw);
    }
  }
  assert.match(reasonOf(judgeUrl("DISCORD", "https://evil.example/x", STRICT))!, /discord\.com\/api\/webhooks/);
});

test("a webhook is https to somewhere that is not a literal bad address", () => {
  const v = judgeUrl("WEBHOOK", "https://hooks.example.com/in/abc?x=1", STRICT);
  assert.ok(v.ok);
  assert.equal(v.ok && v.host, "hooks.example.com");
  assert.equal(v.ok && v.literal, null, "a name is left to be resolved");
  assert.equal(v.ok && v.plainHttp, false);
  const lit = judgeUrl("WEBHOOK", "https://203.0.113.9/hook", STRICT);
  assert.ok(lit.ok && lit.literal === "203.0.113.9");
  assert.ok(judgeUrl("WEBHOOK", "https://[2001:db8::1]:8443/hook", STRICT).ok);
});

test("plain http is refused, and says what to do about it", () => {
  const v = judgeUrl("WEBHOOK", "http://hooks.example.com/in", STRICT);
  assert.equal(v.ok, false);
  assert.match(reasonOf(v)!, new RegExp(PRIVATE_NETWORKS_VARIABLE));
  assert.match(reasonOf(judgeUrl("WEBHOOK", "ftp://hooks.example.com/in", STRICT))!, /https/);
  assert.match(reasonOf(judgeUrl("WEBHOOK", "hooks.example.com/in", STRICT))!, /https/);
});

test("with the operator's consent, plain http is allowed, to a private network only", () => {
  const lan = judgeUrl("WEBHOOK", "http://192.168.1.20:8080/ntfy", LAN);
  assert.ok(lan.ok && lan.plainHttp && lan.literal === "192.168.1.20");
  // A public literal over http: refused at once, with the reason.
  assert.match(reasonOf(judgeUrl("WEBHOOK", "http://203.0.113.9/hook", LAN))!, /Plain http is allowed only to a private network/);
  // A name over http is allowed to be resolved, and every address then has to be private.
  const named = judgeUrl("WEBHOOK", "http://ntfy.lan/topic", LAN);
  assert.ok(named.ok && named.plainHttp && named.literal === null);
  assert.equal(judgeAddresses("WEBHOOK", ["192.168.1.20"], LAN, true).ok, true);
  assert.equal(judgeAddresses("WEBHOOK", ["203.0.113.9"], LAN, true).ok, false, "plain http to a public address is not a thing");
  assert.equal(judgeAddresses("WEBHOOK", ["192.168.1.20", "203.0.113.9"], LAN, true).ok, false);
});

test("private networks are refused by default, and allowed by the operator's word alone", () => {
  for (const host of ["10.0.0.5", "172.16.3.4", "192.168.0.9", "100.64.1.1", "[fd12::1]", "[fc00::1]"]) {
    const raw = `https://${host}/hook`;
    assert.equal(judgeUrl("WEBHOOK", raw, STRICT).ok, false, `${raw} by default`);
    assert.match(reasonOf(judgeUrl("WEBHOOK", raw, STRICT))!, new RegExp(PRIVATE_NETWORKS_VARIABLE));
    assert.equal(judgeUrl("WEBHOOK", raw, LAN).ok, true, `${raw} with consent`);
  }
});

test("what is never reachable stays unreachable with the consent, in every spelling", () => {
  const never = [
    "https://127.0.0.1/hook",
    "https://127.1/hook", // URL turns it into 127.0.0.1
    "https://2130706433/hook", // the same address as one number
    "https://0x7f.0.0.1/hook",
    "https://0177.0.0.1/hook", // octal
    "https://[::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[::ffff:7f00:1]/hook",
    "https://169.254.169.254/latest/meta-data/",
    "https://2852039166/latest/meta-data/", // 169.254.169.254 as one number
    "https://0xa9fea9fe/",
    "https://[::ffff:169.254.169.254]/",
    "https://[fe80::1]/hook",
    "https://[fd00:ec2::254]/latest/meta-data/",
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://[2002:a9fe:a9fe::]/",
    "https://0.0.0.0/hook",
    "https://[::]/hook",
    "https://224.0.0.1/hook",
    "https://255.255.255.255/hook",
    "https://240.0.0.1/hook",
  ];
  for (const raw of never) {
    for (const policy of [STRICT, LAN]) {
      assert.equal(judgeUrl("WEBHOOK", raw, policy).ok, false, `${raw} ${policy.allowPrivate ? "with consent" : "by default"}`);
    }
  }
});

test("a name that resolves to a bad address is refused, whatever else it resolves to", () => {
  assert.equal(judgeAddresses("WEBHOOK", ["203.0.113.9"], STRICT).ok, true);
  assert.equal(judgeAddresses("WEBHOOK", ["203.0.113.9", "2001:db8::1"], STRICT).ok, true, "two public addresses");
  assert.equal(judgeAddresses("WEBHOOK", ["203.0.113.9", "10.0.0.5"], STRICT).ok, false, "one private among public ones");
  assert.equal(judgeAddresses("WEBHOOK", ["203.0.113.9", "127.0.0.1"], LAN).ok, false, "one loopback, even with consent");
  assert.equal(judgeAddresses("WEBHOOK", ["203.0.113.9", "169.254.169.254"], LAN).ok, false, "the metadata address, even with consent");
  assert.equal(judgeAddresses("WEBHOOK", ["10.0.0.5", "192.168.0.2"], LAN).ok, true, "a whole private network, with consent");
  assert.equal(judgeAddresses("WEBHOOK", [], STRICT).ok, false, "no address at all");
  assert.equal(judgeAddresses("WEBHOOK", ["not-an-address"], STRICT).ok, false);
  assert.equal(judgeAddresses("DISCORD", ["10.0.0.5"], LAN).ok, false, "Discord is public, with or without consent");
  assert.equal(judgeAddresses("DISCORD", ["162.159.135.232"], STRICT).ok, true);
});

test("the machine itself is reachable only where a test says so", () => {
  const forTests = { allowPrivate: false, allowLoopback: true };
  assert.equal(judgeAddresses("WEBHOOK", ["127.0.0.1"], forTests).ok, true);
  assert.equal(judgeAddresses("WEBHOOK", ["::1"], forTests).ok, true);
  assert.equal(judgeAddresses("WEBHOOK", ["169.254.169.254"], forTests).ok, false, "and still not the metadata address");
  assert.equal(judgeAddresses("WEBHOOK", ["10.0.0.5"], forTests).ok, false, "nor a private one that was not allowed");
});

test("a login in the address, and a fragment, are refused", () => {
  assert.equal(judgeUrl("WEBHOOK", "https://user:pass@hooks.example.com/x", STRICT).ok, false);
  assert.equal(judgeUrl("WEBHOOK", "https://user@hooks.example.com/x", STRICT).ok, false);
  assert.equal(judgeUrl("WEBHOOK", "https://hooks.example.com/x#y", STRICT).ok, false);
  assert.equal(judgeUrl("WEBHOOK", `https://hooks.example.com/${"a".repeat(2100)}`, STRICT).ok, false, "absurdly long");
  assert.equal(judgeUrl("WEBHOOK", "   ", STRICT).ok, false);
});

test("the operator's consent is a plain yes in the environment, and nothing looser", () => {
  for (const yes of ["1", "true", "TRUE", "on", "yes", " 1 "]) assert.equal(policyFromEnvironment({ [PRIVATE_NETWORKS_VARIABLE]: yes }).allowPrivate, true, yes);
  for (const no of [undefined, "", "0", "false", "off", "no", "2", "enabled", "y"]) assert.equal(policyFromEnvironment({ [PRIVATE_NETWORKS_VARIABLE]: no }).allowPrivate, false, String(no));
  assert.equal(policyFromEnvironment({}).allowLoopback, undefined, "never from the environment");
});

test("the page may show where a webhook goes and never the token in it", () => {
  const shown = describeDestination("DISCORD", DISCORD);
  assert.equal(shown, "discord.com/api/webhooks/123456789012345678/•••");
  assert.ok(!shown.includes(TOKEN));
  assert.equal(describeDestination("WEBHOOK", "https://hooks.example.com/in/secret-path?key=abc"), "hooks.example.com");
  assert.equal(describeDestination("WEBHOOK", "garbage"), "an address that cannot be read");
});
