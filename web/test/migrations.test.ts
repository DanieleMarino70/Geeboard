import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/* Two rules about the database that a release hands to the next one, held where a forgetful hand would otherwise break them.

   A migration somebody has already applied is not edited: Prisma refuses to deploy to a database that applied it with other text, and the
   people it refuses are the ones upgrading. So every migration a release shipped is pinned here by its hash (migrations-pinned.json, written
   from the release's own tag by the cut), and this fails on a change to one of them.

   A release adds, and the next one removes: after the pinned release a migration may add a table, a column that is null or has a default, an
   index, an enum value, and may not drop, rename or tighten anything, so that the previous release's code can still read and write the
   migrated database. That is what an image-only rollback would need (docs/upgrading.md still says to restore the dump), and the rule is in
   docs/extending.md, "The promise". A column that stops being used is dropped one release after the last release that reads it. */

const DIR = path.join(import.meta.dirname, "..", "prisma", "migrations");
const PINNED = JSON.parse(readFileSync(path.join(import.meta.dirname, "migrations-pinned.json"), "utf8")) as { release: string; migrations: Record<string, string> };

const names = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
// Line endings are the checkout's, not the migration's: the same text hashes the same on Windows with autocrlf and on Linux.
const sqlOf = (name: string) => readFileSync(path.join(DIR, name, "migration.sql"), "utf8").split("\r\n").join("\n");

/** What in a migration is not an addition. Empty is an expansion. */
function notAnAddition(sql: string): string[] {
  const found: string[] = [];
  const code = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  if (/\bDROP\s+(COLUMN|TABLE|TYPE|CONSTRAINT)\b/i.test(code)) found.push("drops a column, a table, a type or a constraint");
  if (/\bRENAME\b/i.test(code)) found.push("renames something");
  if (/\bSET\s+NOT\s+NULL\b/i.test(code)) found.push("makes a column that may be null required");
  if (/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i.test(code)) found.push("changes a column's type");
  if (/\bADD\s+COLUMN\b[^;,]*\bNOT\s+NULL\b(?![^;,]*\bDEFAULT\b)/i.test(code)) found.push("adds a required column with no default, which the previous release's inserts do not set");
  return found;
}

test("a migration a release shipped is the one it shipped", () => {
  const changed: string[] = [];
  for (const [name, hash] of Object.entries(PINNED.migrations)) {
    if (!names.includes(name)) {
      changed.push(`${name} is pinned and gone`);
      continue;
    }
    if (createHash("sha256").update(sqlOf(name)).digest("hex") !== hash) changed.push(`${name} was edited after ${PINNED.release}`);
  }
  assert.deepEqual(changed, [], `a migration that has shipped is never edited: write a new one. (To pin a release, run the cut: it writes migrations-pinned.json from the tag.)`);
});

test("every migration is in the order it was made: none slid in behind one that shipped", () => {
  const last = Object.keys(PINNED.migrations).sort().at(-1)!;
  const behind = names.filter((name) => !(name in PINNED.migrations) && name < last);
  assert.deepEqual(behind, [], `these are older than ${last}, which shipped: a database that applied it has not applied them`);
});

test("a migration after the last release only adds", () => {
  const offenders: string[] = [];
  for (const name of names.filter((n) => !(n in PINNED.migrations))) {
    for (const reason of notAnAddition(sqlOf(name))) offenders.push(`${name} ${reason}`);
  }
  assert.deepEqual(offenders, [], "a release adds and the one after it removes (docs/extending.md, The promise): split it, and drop one release later");
});

test("the check for an addition can fail", () => {
  assert.deepEqual(notAnAddition('ALTER TABLE "nodes" ADD COLUMN "note" TEXT;\nCREATE INDEX "x" ON "nodes"("note");'), []);
  assert.deepEqual(notAnAddition('ALTER TABLE "nodes" ADD COLUMN "n" INTEGER NOT NULL DEFAULT 0;'), []);
  assert.equal(notAnAddition('ALTER TABLE "nodes" DROP COLUMN "note";').length, 1);
  assert.equal(notAnAddition('ALTER TABLE "nodes" RENAME COLUMN "a" TO "b";').length, 1);
  assert.equal(notAnAddition('ALTER TABLE "nodes" ADD COLUMN "n" INTEGER NOT NULL;').length, 1);
  assert.equal(notAnAddition('-- DROP TABLE is not run, it is a comment\nSELECT 1;').length, 0);
});
