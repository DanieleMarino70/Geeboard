import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { databaseOf, isVerifyDatabase, judgeDestructive, refuseVerify } from "../scripts/db-guard.mts";
import { DB_GROUP, DOCKER_GROUP, ENTRY_POINTS } from "../scripts/verify-registry.mts";

const DEMO = "postgresql://geeboard:secret@localhost:5432/geeboard?schema=public";
const VERIFY = "postgresql://geeboard:secret@localhost:5432/geeboard_verify?schema=public";

test("a database is named by its path, and its credentials are never in what is said about it", () => {
  assert.deepEqual(databaseOf(DEMO), { name: "geeboard", where: "localhost:5432" });
  assert.deepEqual(databaseOf("postgres://u:p@db.internal/geeboard_verify_setup"), { name: "geeboard_verify_setup", where: "db.internal" });
  assert.equal(databaseOf(undefined), null);
  assert.equal(databaseOf("not a url"), null);
});

test("only a database named for verification is wiped by a verify script", () => {
  assert.equal(isVerifyDatabase("geeboard_verify"), true);
  assert.equal(isVerifyDatabase("geeboard_verify_setup"), true);
  assert.equal(isVerifyDatabase("geeboard"), false);

  assert.equal(refuseVerify("verify-ops.mts", VERIFY, false), null);
  const refusal = refuseVerify("verify-ops.mts", DEMO, false);
  assert.ok(refusal);
  // It names the script and the database, and nothing secret.
  assert.match(refusal!, /verify-ops\.mts/);
  assert.match(refusal!, /"geeboard" on localhost:5432/);
  assert.doesNotMatch(refusal!, /secret/);
  // The escape is explicit, and a missing URL is not this guard's to refuse.
  assert.equal(refuseVerify("verify-ops.mts", DEMO, true), null);
  assert.equal(refuseVerify("verify-ops.mts", undefined, false), null);
});

test("a destructive prisma command asks for confirmation unless the database is made for it", () => {
  assert.deepEqual(judgeDestructive(VERIFY), { verdict: "run" });
  assert.deepEqual(judgeDestructive(DEMO), { verdict: "confirm", target: { name: "geeboard", where: "localhost:5432" } });
  assert.deepEqual(judgeDestructive(undefined), { verdict: "run" });
});

test("every verify script in package.json is in a group the runner runs, and every name in a group is a script", () => {
  const scripts = (JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  const grouped = new Set<string>([...DB_GROUP, ...DOCKER_GROUP]);
  const entries = new Set<string>(ENTRY_POINTS);

  for (const name of Object.keys(scripts)) {
    if (!name.startsWith("verify:") || entries.has(name)) continue;
    assert.ok(grouped.has(name), `${name} is in package.json and in neither group of scripts/verify-registry.mts, so nothing runs it`);
  }
  for (const name of grouped) assert.ok(name in scripts, `${name} is in scripts/verify-registry.mts and is not a script`);
  assert.equal(new Set([...DB_GROUP, ...DOCKER_GROUP]).size, DB_GROUP.length + DOCKER_GROUP.length, "a script is in both groups, or twice");
  for (const entry of ENTRY_POINTS) assert.match(scripts[entry]!, /verify-all\.mts/, `${entry} runs the runner`);
});
