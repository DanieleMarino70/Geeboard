import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  TEMPORARY_PASSWORD_TTL_MS,
  accountGate,
  mustEnrol,
  temporaryPasswordExpired,
} from "../src/domain/access/account.ts";

/* What stands between a signed-in person and the panel, and in what
   order. The pages, the API front door and the account page all ask
   this, so it is one answer rather than three. */

const owner = { role: "OWNER" as const, twoFactor: false, passwordSetAt: null, temporaryPasswordExpiresAt: new Date(Date.now() + 3600_000) };

test("the first owner is asked for a password first, and two-factor after", () => {
  assert.equal(accountGate(owner), "password");
  // Chosen a password of their own: the second gate is now the one in front.
  assert.equal(accountGate({ ...owner, passwordSetAt: new Date() }), "two-factor");
  assert.equal(accountGate({ ...owner, passwordSetAt: new Date(), twoFactor: true }), null);
});

/* The order is the point: a second factor enrolled behind a password
   somebody else may have read off a terminal is not the owner's. */
test("two-factor is never the first gate for an account that has not chosen a password", () => {
  assert.equal(accountGate({ ...owner, twoFactor: true }), "password");
});

test("a member is not asked for two-factor, but is asked to replace a temporary password", () => {
  const member = { role: "MEMBER" as const, twoFactor: false, passwordSetAt: null, temporaryPasswordExpiresAt: null };
  assert.equal(mustEnrol(member), false);
  assert.equal(accountGate(member), "password");
  assert.equal(accountGate({ ...member, passwordSetAt: new Date() }), null);
});

/* Pages ask the gate through requireUser, and /api/v1 through its front
   door. A route handler that reads the session itself asks nothing unless
   it is written to: the console stream, the audit export and the install
   progress all checked only that somebody was signed in, until September
   2026. A grep as a test, like test/shell-user.test.ts, because nothing
   else fails when the next one forgets. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(at));
    else if (entry.name === "route.ts") out.push(at);
  }
  return out;
}

test("every route that reads the session asks the account gate", () => {
  const offenders = routeFiles("src/app/api")
    .filter((file) => !file.split(path.sep).includes("v1"))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      const readsSession = /getCurrentUser\(|userForSession\(/.test(source);
      const asksGate = /accountGate\(|streamRefusal\(/.test(source);
      return readsSession && !asksGate;
    });
  assert.deepEqual(offenders, [], "ask accountGate (or streamRefusal, for a stream) after reading the session");
});

test("a temporary password is good for a day, and expiry is only about temporary ones", () => {
  assert.equal(TEMPORARY_PASSWORD_TTL_MS, 24 * 3600_000);
  const madeAt = new Date("2026-09-21T10:00:00Z");
  const expiresAt = new Date(madeAt.getTime() + TEMPORARY_PASSWORD_TTL_MS);
  const account = { passwordSetAt: null, temporaryPasswordExpiresAt: expiresAt };

  assert.equal(temporaryPasswordExpired(account, new Date("2026-09-22T09:59:00Z")), false);
  assert.equal(temporaryPasswordExpired(account, new Date("2026-09-22T10:00:01Z")), true);

  // A password the person chose does not expire, whatever is left on the row.
  assert.equal(temporaryPasswordExpired({ passwordSetAt: new Date(), temporaryPasswordExpiresAt: expiresAt }, new Date("2030-01-01T00:00:00Z")), false);
  // Nor does an account made before any of this existed.
  assert.equal(temporaryPasswordExpired({ passwordSetAt: null, temporaryPasswordExpiresAt: null }, new Date("2030-01-01T00:00:00Z")), false);
});
