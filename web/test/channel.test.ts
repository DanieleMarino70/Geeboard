import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAIN_HTTP_WARNING, plainHttpAcrossTheInternet } from "../src/domain/nodes/channel.ts";

/* The panel calls an agent over plain http with one token. Across the internet that is said, when the address is typed. */

test("plain http at a public address is the one that is said", () => {
  for (const address of ["http://203.0.113.10:8080", "http://8.8.8.8:8080", "http://node.example.com:8080", "http://[2001:db8::10]:8080", "  http://203.0.113.10:8080  "]) {
    assert.ok(plainHttpAcrossTheInternet(address), address);
  }
});

test("a LAN, a private network and this machine are not", () => {
  for (const address of [
    "http://10.0.0.5:8080",
    "http://192.168.1.20:8080",
    "http://172.20.0.2:8080",
    "http://127.0.0.1:8080",
    "http://169.254.1.1:8080",
    "http://100.64.12.9:8080",
    "http://[fd00::5]:8080",
    "http://[::1]:8080",
    "http://localhost:8080",
    "http://fra-node-02:8080",
    "http://gamebox.local:8080",
    "http://gamebox.lan:8080",
    "http://gamebox.tail1234.ts.net:8080",
  ]) {
    assert.ok(!plainHttpAcrossTheInternet(address), address);
  }
});

test("https, an empty field and nonsense are not", () => {
  assert.ok(!plainHttpAcrossTheInternet("https://node.example.com:8443"));
  assert.ok(!plainHttpAcrossTheInternet(""));
  assert.ok(!plainHttpAcrossTheInternet("not a url"));
  assert.ok(!plainHttpAcrossTheInternet("ftp://203.0.113.10"));
});

test("the sentence names the way out", () => {
  assert.match(PLAIN_HTTP_WARNING, /WireGuard, Tailscale/);
  assert.match(PLAIN_HTTP_WARNING, /TLS in front of the agent/);
});
