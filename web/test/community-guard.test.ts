import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { plainTest, validateConfig } from "../src/domain/games/config.ts";
import { guardedTest } from "../src/domain/games/regex-guard.ts";
import { allGames } from "../src/domain/games/registry.ts";

/* A community game's regular expressions are written by a stranger and approved by an owner who reads a preview. The panel runs them under a time
   limit wherever it can, and the audit of 0.9.5 found the places it could and did not: a setting's pattern checked against the manifest's own default
   (so one paste by an admin froze the panel before any owner saw it), and the line a container prints, matched in the browser. */

const SRC = path.join(import.meta.dirname, "..", "src");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

test("a catastrophic pattern is cut off and does not match, instead of freezing whoever asked", () => {
  const started = Date.now();
  assert.equal(guardedTest("(À{1,100}){1,100}x", "À".repeat(60) + "~"), false);
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  assert.equal(guardedTest("^[a-z]+$", "abc"), true, "and an ordinary pattern is answered as it always was");
});

test("every place that checks a manifest's setting values passes the guarded test", () => {
  for (const file of ["domain/games/manifest.ts", "lib/create-ops.ts", "lib/config-ops.ts"]) {
    const calls = read(file).split("\n").filter((line) => /\bvalidateConfig\(/.test(line) && !/^\s*(import|\*|\/\/)/.test(line));
    assert.ok(calls.length > 0, `${file} no longer calls validateConfig: this test is looking at nothing`);
    for (const call of calls) assert.match(call, /guardedTest/, `${file}: ${call.trim()}`);
  }
});

test("the browser is not handed an expression to run on a line a container printed, unless the panel ships the game", () => {
  assert.match(read("app/console/page.tsx"), /isGuarded\(pattern\)/);
  assert.doesNotMatch(read("app/servers/[id]/console-tail.tsx"), /isProbeLine/, "the server-side tail uses the guarded matcher");
});

test("the games the panel ships are checked the plain way and still pass: their patterns are code that was read", () => {
  for (const game of allGames()) {
    const problems = validateConfig(game, {}, plainTest);
    assert.deepEqual(problems, [], game.id);
  }
});
