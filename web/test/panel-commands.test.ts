import assert from "node:assert/strict";
import { test } from "node:test";
import { lockedOutHelp, recoveryCommand, runsInImage, setupCommand, whereToRun } from "../src/lib/panel-commands.ts";

/* The commands the panel tells a person to type. A Docker installation has no checkout, no npm and no
   admin:recover script; the one a person reads when they are locked out must be the one that exists. */

test("an installation from the image is told the verb on the image", () => {
  assert.equal(recoveryCommand({ inImage: true }), "docker compose -f deploy/panel/docker-compose.yml run --rm panel recover");
  assert.equal(setupCommand({ inImage: true }), "docker compose -f deploy/panel/docker-compose.yml run --rm panel setup");
});

test("a checkout is told the scripts", () => {
  assert.equal(recoveryCommand({ inImage: false }), "npm run admin:recover");
  assert.equal(setupCommand({ inImage: false }), "npm run setup");
});

test("which owner is added the way each form takes it", () => {
  assert.equal(
    recoveryCommand({ inImage: true, email: "owner@example.com" }),
    "docker compose -f deploy/panel/docker-compose.yml run --rm panel recover --email owner@example.com",
  );
  assert.equal(recoveryCommand({ inImage: false, email: "owner@example.com" }), "npm run admin:recover -- --email owner@example.com");
});

test("the image says which it is, and a bare environment is a checkout", () => {
  assert.ok(runsInImage({ GEEBOARD_IN_IMAGE: "1" }));
  assert.ok(!runsInImage({}));
  assert.ok(!runsInImage({ GEEBOARD_IN_IMAGE: "0" }));
  assert.ok(!runsInImage({ GEEBOARD_IN_IMAGE: "true" }), "docker-entrypoint.sh exports exactly 1");
});

test("where to type it is said for the place it runs", () => {
  assert.match(whereToRun({ inImage: true }), /in the folder you installed it from/);
  assert.match(whereToRun({ inImage: false }), /checkout/);
});

test("the sign-in page tells an installation with nobody how to make the first owner, and one with people how to get back in", () => {
  const none = lockedOutHelp(0, { inImage: true });
  assert.ok(none.noOwnerYet);
  assert.equal(none.command, setupCommand({ inImage: true }));
  const some = lockedOutHelp(3, { inImage: true });
  assert.ok(!some.noOwnerYet);
  assert.equal(some.command, recoveryCommand({ inImage: true }));
  assert.equal(lockedOutHelp(1, { inImage: false }).command, "npm run admin:recover");
  assert.equal(lockedOutHelp(0, { inImage: false }).command, "npm run setup");
});

/* No message the product writes may send a Docker installation to a script it does not have. Read from the source:
   the sentences are in a dozen files, and a new one that says `npm run admin:recover` outside this module is the
   mistake that was made seven times. */
test("nothing names npm run admin:recover outside the one module that knows the layouts", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.endsWith("panel-commands.ts") && /npm run admin:recover/.test(readFileSync(path, "utf8"))) found.push(path);
    }
  };
  walk(join(import.meta.dirname, "..", "src"));
  assert.deepEqual(found, [], "these name a checkout-only command");
});
