import assert from "node:assert/strict";
import { test } from "node:test";
import { hstsApplies } from "../src/domain/access/hsts.ts";

/* HSTS is a promise that the host is reached over https. It is kept for a name, and not made for anything else. */

test("a panel at a name over https is told to use https", () => {
  assert.ok(hstsApplies("https://panel.example.com"));
  assert.ok(hstsApplies("https://panel.example.com:8443/"));
  assert.ok(hstsApplies("https://geeboard.party"));
});

test("a panel at an address, over http, or at nothing is not", () => {
  assert.ok(!hstsApplies("https://203.0.113.10"), "a browser does not apply HSTS to an IP address");
  assert.ok(!hstsApplies("https://[2001:db8::10]"));
  assert.ok(!hstsApplies("https://localhost:3000"));
  assert.ok(!hstsApplies("http://panel.example.com"), "a promise the panel cannot keep");
  assert.ok(!hstsApplies(undefined));
  assert.ok(!hstsApplies(""));
  assert.ok(!hstsApplies("not a url"));
});
