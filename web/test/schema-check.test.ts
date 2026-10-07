import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { appliedMigrations, checkSchema, describeSchema, judgeSchema, knownMigrations, migrateCommand, type AppliedMigration } from "../src/lib/schema-check";

const KNOWN = ["20260908211953_init", "20260908215017_scheduled_tasks", "20261001150000_node_contract"];
const done = (...names: string[]): AppliedMigration[] => names.map((name) => ({ name, finished: true, rolledBack: false }));

test("a database that has applied exactly what the image carries is at its schema", () => {
  assert.deepEqual(judgeSchema(KNOWN, done(...KNOWN)), { ok: true });
});

test("a database a release behind is named, with the first migration it lacks", () => {
  const verdict = judgeSchema(KNOWN, done(KNOWN[0]!));
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.ok && verdict.kind === "behind");
  if (!verdict.ok && verdict.kind === "behind") {
    assert.deepEqual(verdict.pending, [KNOWN[1], KNOWN[2]]);
    assert.equal(verdict.latestApplied, KNOWN[0]);
  }
});

test("a database that has never been migrated is behind by all of them", () => {
  const verdict = judgeSchema(KNOWN, []);
  assert.ok(!verdict.ok && verdict.kind === "behind" && verdict.pending.length === 3 && verdict.latestApplied === null);
});

test("a database migrated by a newer release is ahead, and that is not something to run an older panel on", () => {
  const verdict = judgeSchema(KNOWN, done(...KNOWN, "20270101000000_from_the_future"));
  assert.ok(!verdict.ok && verdict.kind === "ahead");
  if (!verdict.ok && verdict.kind === "ahead") assert.deepEqual(verdict.unknown, ["20270101000000_from_the_future"]);
});

test("a migration that started and did not finish is a failed one, before anything else is said", () => {
  const verdict = judgeSchema(KNOWN, [...done(KNOWN[0]!), { name: KNOWN[1]!, finished: false, rolledBack: false }]);
  assert.ok(!verdict.ok && verdict.kind === "failed");
  // Marked rolled back, it is as if it had not been applied: the migration is pending again.
  const resolved = judgeSchema(KNOWN, [...done(KNOWN[0]!), { name: KNOWN[1]!, finished: false, rolledBack: true }]);
  assert.ok(!resolved.ok && resolved.kind === "behind" && resolved.pending.includes(KNOWN[1]!));
});

test("every sentence names what is wrong and one thing to do, spelled for where it runs", () => {
  const behind = judgeSchema(KNOWN, done(KNOWN[0]!));
  if (behind.ok) throw new Error("expected a mismatch");
  const inImage = describeSchema(behind, "0.9.0", true);
  assert.match(inImage.line, /a release behind/);
  assert.match(inImage.line, /needs 2 more/);
  assert.equal(inImage.fix, `Apply them: ${migrateCommand(true)}`);
  assert.match(inImage.fix, /docker compose .* run --rm panel migrate$/);
  assert.match(describeSchema(behind, "0.9.0", false).fix, /npm run db:deploy$/);

  const ahead = judgeSchema(KNOWN, done(...KNOWN, "20270101000000_x"));
  if (ahead.ok) throw new Error("expected a mismatch");
  assert.match(describeSchema(ahead, "0.9.0", true).line, /newer Geeboard than 0\.9\.0/);

  const failed = judgeSchema(KNOWN, [{ name: KNOWN[1]!, finished: false, rolledBack: false }]);
  if (failed.ok) throw new Error("expected a mismatch");
  const failure = describeSchema(failed, "0.9.0", true);
  assert.match(failure.line, /may be partly changed/);
  assert.match(failure.fix, /panel resolve --rolled-back 20260908215017_scheduled_tasks/);
});

test("the image's migrations are the directories under prisma/migrations, and this checkout has the ones its schema needs", async () => {
  const here = knownMigrations();
  assert.ok(here && here.length > 40, "the real migrations directory is read");
  assert.ok(here!.every((name) => /^\d{14}_/.test(name)));
  assert.deepEqual([...here!].sort(), here, "in order");

  const empty = await mkdtemp(path.join(tmpdir(), "geeboard-schema-"));
  try {
    assert.equal(knownMigrations(empty), null, "a directory with no migrations is not evidence of anything");
    await mkdir(path.join(empty, "prisma", "migrations", "20260101000000_a"), { recursive: true });
    await mkdir(path.join(empty, "prisma", "migrations", "not-a-migration"), { recursive: true });
    assert.deepEqual(knownMigrations(empty), ["20260101000000_a"]);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("a database that cannot be read says nothing about its schema, and one with no table is behind", async () => {
  const refusing = { $queryRawUnsafe: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:5432"); } };
  assert.equal(await appliedMigrations(refusing as never), "unreadable");
  assert.equal(await checkSchema(refusing as never), "unknown");

  const unmigrated = { $queryRawUnsafe: async () => { throw new Error('relation "_prisma_migrations" does not exist'); } };
  assert.deepEqual(await appliedMigrations(unmigrated as never), []);
  const verdict = await checkSchema(unmigrated as never);
  assert.ok(verdict !== "unknown" && !verdict.ok && verdict.kind === "behind");
});
