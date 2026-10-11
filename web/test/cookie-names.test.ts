import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cookieName, cookiesAreSecure, isLoopbackHost } from "../src/domain/access/cookie-names";
import { FLASH_COOKIE } from "../src/domain/flash";

/* The session, the pending second step and the carried message are `__Host-` cookies wherever a browser keeps a Secure one (0.11.0): a
   sibling subdomain could set them for the whole domain while they were plain. The prefix needs Secure, and a Secure cookie over plain http
   comes back only on this machine, so a development server opened at a LAN address keeps the old names. See domain/access/cookie-names.ts. */

const dev = (host: string | null, forwardedProto: string | null = null) => cookiesAreSecure({ production: false, host, forwardedProto });

test("an installed panel's cookies are Secure and prefixed, whatever address it is reached at", () => {
  for (const host of ["panel.example.com", "192.168.1.20:3000", "127.0.0.1:3000", null]) {
    assert.equal(cookiesAreSecure({ production: true, host, forwardedProto: null }), true, String(host));
  }
  assert.equal(cookieName("gb_session", true), "__Host-gb_session");
  assert.equal(cookieName("gb_mfa", true), "__Host-gb_mfa");
  assert.equal(cookieName(FLASH_COOKIE, true), "__Host-gb_flash");
});

test("a development server prefixes them on this machine, where a browser keeps a Secure cookie over plain http", () => {
  for (const host of ["localhost:3540", "localhost", "LOCALHOST:3000", "app.localhost:3000", "127.0.0.1:3540", "127.8.9.1", "[::1]:3540"]) {
    assert.equal(dev(host), true, host);
  }
});

test("and keeps the old names at a LAN address over plain http, where a Secure cookie would never come back", () => {
  for (const host of ["192.168.1.20:3000", "10.0.0.5", "panel.lan:3000", "[fe80::1]:3000", "localhost.example.com", "127.0.0.1.nip.io", null]) {
    assert.equal(dev(host), false, String(host));
  }
  assert.equal(cookieName("gb_session", false), "gb_session");
  assert.equal(cookieName("gb_mfa", false), "gb_mfa");
});

test("unless what is in front of it says the browser used https", () => {
  assert.equal(dev("192.168.1.20:3000", "https"), true);
  assert.equal(dev("192.168.1.20:3000", "HTTPS, http"), true);
  assert.equal(dev("192.168.1.20:3000", "http"), false);
});

test("the loopback test is about the host, not a name that starts like one", () => {
  assert.equal(isLoopbackHost("localhost:3000"), true);
  assert.equal(isLoopbackHost("localhost.evil.example"), false);
  assert.equal(isLoopbackHost("127.0.0.1.evil.example"), false);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("[::2]:80"), false);
});

/* Every read, write and delete of these cookies goes through lib/cookie-jar.ts, which asks the request which name it has. One that named
   `gb_session` itself would read the cookie the prefix is there to refuse, and a delete without Secure leaves a `__Host-` cookie in place. */
test("nothing in the panel names its cookies but the cookie jar", () => {
  const SRC = path.join(import.meta.dirname, "..", "src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) {
        const rel = path.relative(SRC, full).split(path.sep).join("/");
        if (rel === "lib/cookie-jar.ts" || rel === "domain/access/cookie-names.ts") continue;
        const text = readFileSync(full, "utf8");
        // Quoted as a string; the comments name it in backticks.
        if (/["']__Host-/.test(text)) offenders.push(`${rel}: a "__Host-" name`);
        // The theme is the one cookie the panel's pages set themselves (shell.tsx), and the layout reads it.
        if (/\bcookies\(\)/.test(text) && !/\bcookies\(\)\)?\.get\("gb-theme"\)/.test(text)) offenders.push(`${rel}: cookies()`);
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
