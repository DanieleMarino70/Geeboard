import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeEmail, returnPath, signInPath } from "../src/domain/access/return-to.ts";

/* Sign-in carries the page that was asked for through itself and its second step. What it carries comes from the
   address bar, so every shape of "somewhere else" has to come out as nowhere. */

test("a path inside the panel is kept, with its query", () => {
  assert.equal(returnPath("/servers/aurora-smp"), "/servers/aurora-smp");
  assert.equal(returnPath("/servers/aurora-smp/backups?tab=restore"), "/servers/aurora-smp/backups?tab=restore");
  assert.equal(returnPath("  /nodes/fra-node-02  "), "/nodes/fra-node-02", "a stray space is not part of it");
  assert.equal(returnPath("/audit?actor=Test%20Owner"), "/audit?actor=Test%20Owner");
});

test("anything that could leave the panel is nothing", () => {
  for (const hostile of [
    "https://evil.example/servers",
    "http://evil.example",
    "//evil.example/servers",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/servers\\..\\..",
    "javascript:alert(1)",
    "evil.example/servers",
    "servers/aurora",
    "/servers/\u0000aurora",
    "/servers/aurora\r\nSet-Cookie: x=1",
    "/servers/aurora\tx",
    // A dot-segment collapses into a protocol-relative path after the guard has looked at the first slash (the audit of 0.9.5).
    "/.//evil.example/session-expired",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2e//evil.example",
    "/..//evil.example",
    "/%2e%2e//evil.example",
    "/x/..//evil.example/y",
    "/.///evil.example",
    "/servers/./aurora",
    "/servers/../nodes",
  ]) {
    assert.equal(returnPath(hostile), null, JSON.stringify(hostile));
  }
});

test("what is not a page to go back to is nothing, and the dashboard is what no answer already is", () => {
  for (const path of ["/", "/sign-in", "/sign-in/two-factor", "/sign-in?next=/servers", "/setup/abc", "/api/v1/servers", "/_next/static/x.js"]) {
    assert.equal(returnPath(path), null, path);
  }
  assert.equal(returnPath(undefined), null);
  assert.equal(returnPath(null), null);
  assert.equal(returnPath(42), null);
  assert.equal(returnPath(""), null);
  assert.equal(returnPath("/" + "a".repeat(600)), null, "a length no page needs");
});

test("a lookalike of a refused page is not refused with it", () => {
  assert.equal(returnPath("/sign-instructions"), "/sign-instructions");
  assert.equal(returnPath("/apiary"), "/apiary");
});

test("the sign-in address carries what there is to carry and nothing else", () => {
  assert.equal(signInPath(), "/sign-in");
  assert.equal(signInPath({ next: "/servers/aurora-smp" }), "/sign-in?next=%2Fservers%2Faurora-smp");
  assert.equal(signInPath({ next: "/servers/aurora-smp", ended: true }), "/sign-in?next=%2Fservers%2Faurora-smp&ended=1");
  assert.equal(signInPath({ ended: true }), "/sign-in?ended=1");
  assert.equal(signInPath({ next: "https://evil.example", ended: false }), "/sign-in", "a refused next is not carried at all");
  assert.equal(signInPath({ next: "/sign-in" }), "/sign-in", "no loop");
  assert.equal(signInPath({ email: "ayla@ashfold.gg" }), "/sign-in?email=ayla%40ashfold.gg");
  assert.equal(signInPath({ email: "not an address" }), "/sign-in");
});

test("a returned path survives the round trip through the address bar", () => {
  const original = "/servers/aurora-smp/backups?tab=restore&from=2026-10-01";
  const url = new URL(signInPath({ next: original }), "http://panel.test");
  assert.equal(returnPath(url.searchParams.get("next")), original);
});

test("an address is a shape and not a check", () => {
  assert.ok(looksLikeEmail("ayla@ashfold.gg"));
  assert.ok(!looksLikeEmail("ayla"));
  assert.ok(!looksLikeEmail("a b@c"));
  assert.ok(!looksLikeEmail("a@b".padEnd(300, "x")));
});
