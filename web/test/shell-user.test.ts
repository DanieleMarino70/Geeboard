import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { shellUser } from "../src/lib/ui-types.ts";

/* The shell is a client component, so whatever a page hands it is
   serialised into the payload the browser gets. Every page used to hand
   it the whole `User` row — and `passwordHash` and the encrypted
   `totpSecret` were in the HTML of every page in the panel. TypeScript
   was happy: a row with more fields is assignable to a type with fewer.
   Only reading the bytes on the wire showed it.

   `shellUser()` narrows it, and this fails if a page goes back to
   passing something that was not narrowed. A grep as a test, because the
   type system will not catch this one and the bytes are the evidence. */

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(at));
    else if (entry.name.endsWith(".tsx")) out.push(at);
  }
  return out;
}

test("no page hands the shell a user it did not narrow", () => {
  const offenders: string[] = [];
  for (const file of tsxFiles("src/app")) {
    const source = readFileSync(file, "utf8");
    for (const line of source.split(/\r?\n/)) {
      // A component whose own prop is already a ShellUser passes it on; a page has a row.
      if (/<(AppShell|NoServers)\b/.test(line) || /user=\{/.test(line)) {
        if (/user=\{(?!shellUser\()/.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "pass shellUser(user), not the row");
});

test("shellUser keeps three fields and drops everything else", () => {
  const row = {
    name: "Mara",
    initials: "MA",
    role: "OWNER",
    // What a real row also carries, and what must not come out the other side.
    email: "mara@example.com",
    passwordHash: "$2b$12$notarealhash",
    totpSecret: "encrypted",
  };
  assert.deepEqual(shellUser(row), { name: "Mara", initials: "MA", role: "OWNER" });
  assert.deepEqual(Object.keys(shellUser(row)).sort(), ["initials", "name", "role"]);
});
