import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultsFor, scopeToLine } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { leftBehind, nameProblem, settingsToApply, settingsToKeep, startVersion, summaryOf, travels } from "../src/domain/templates/rules.ts";

/* What a saved template carries, and what it leaves behind. Run against the
   real definitions: the point is what these rules do to Terraria's world file
   and Valheim's password, not to a stand-in. */

const terraria = requireGame("terraria");
const valheim = requireGame("valheim");
const minecraft = requireGame("minecraft-java");

test("a password and a file in a server's own folder do not travel", () => {
  assert.equal(travels(valheim.config.find((f) => f.key === "password")!), false);
  assert.equal(travels(terraria.config.find((f) => f.key === "password")!), false);
  assert.equal(travels(terraria.config.find((f) => f.key === "worldFile")!), false, "it names a file on one server's disk");
  assert.equal(travels(terraria.config.find((f) => f.key === "difficulty")!), true);
  assert.equal(travels(minecraft.config.find((f) => f.key === "maxPlayers")!), true);
});

test("saving keeps the settings that travel, as they are, and nothing else", () => {
  const server = { ...defaultsFor(terraria), difficulty: "expert", password: "hunter2", worldFile: "mine.wld", leftover: "from a version this game no longer has" };
  const kept = settingsToKeep(terraria, server);
  assert.ok(!("password" in kept) && !("worldFile" in kept) && !("leftover" in kept));
  assert.equal(kept.difficulty, "expert");
  assert.ok(!JSON.stringify(kept).includes("hunter2"), "the password is nowhere in what is saved");
});

test("a value of the wrong type is not kept, so a damaged server row cannot make a template that breaks a create", () => {
  const kept = settingsToKeep(minecraft, { maxPlayers: "twenty", pvp: "yes", motd: "hello", difficulty: 3 });
  assert.deepEqual(kept, { motd: "hello" });
});

test("applying takes only keys the game has on that line, of the right type", () => {
  const saved = { difficulty: "journey", password: "smuggled", worldFile: "../../etc/x.wld", made_up: 1 };
  const applied = settingsToApply(terraria, saved);
  assert.deepEqual(Object.keys(applied).sort(), ["difficulty"], JSON.stringify(applied));
  assert.deepEqual(settingsToApply(terraria, null), {});
  assert.deepEqual(settingsToApply(terraria, [1, 2]), {});
  assert.deepEqual(settingsToApply(terraria, "text"), {});
});

test("what applies to a build is narrowed to its version line", () => {
  const zomboid = requireGame("project-zomboid");
  const line = zomboid.versions.find((v) => v.line)?.line;
  const scoped = scopeToLine(zomboid, line);
  const saved = settingsToKeep(scoped, { ...defaultsFor(scoped), maxPlayers: 12 });
  assert.equal(saved.maxPlayers, 12);
  assert.ok(!("password" in saved), "Zomboid's join password stays behind too");
  const other = zomboid.versions.map((v) => v.line).find((l) => l && l !== line);
  if (other) {
    const applied = settingsToApply(scopeToLine(zomboid, other), saved);
    assert.ok(Object.keys(applied).every((k) => scopeToLine(zomboid, other).config.some((f) => f.key === k)), "every applied key exists on the other line");
  }
});

test("a template says which of a game's settings it leaves behind", () => {
  assert.deepEqual(leftBehind(terraria).sort(), ["Server password", "World file"].sort());
  assert.deepEqual(leftBehind(minecraft), []);
});

test("a name is two to forty characters of text", () => {
  assert.equal(nameProblem("Hardcore 2026"), null);
  assert.match(nameProblem("x")!, /at least 2/);
  assert.match(nameProblem(" ")!, /at least 2/);
  assert.match(nameProblem("x".repeat(41))!, /too long/);
  assert.match(nameProblem("bad\u0000name")!, /control/);
});

test("a list line counts settings and says the limits", () => {
  assert.equal(summaryOf({ config: { a: 1, b: 2 }, memoryGb: 4, cpuLimit: 200, diskGb: 20 }), "2 settings · 4 GB memory · 200% CPU · 20 GB disk");
  assert.equal(summaryOf({ config: { a: 1 }, memoryGb: 1, cpuLimit: 100, diskGb: 5 }), "1 setting · 1 GB memory · 100% CPU · 5 GB disk");
  assert.equal(summaryOf({ config: null, memoryGb: 1, cpuLimit: 100, diskGb: 5 }).startsWith("0 settings"), true);
});

test("a template starts on its own version, or on the game's default when that is gone, and says so", () => {
  const versions = [
    { id: "1-21", label: "1.21", formerIds: ["1-21-0"], supported: true },
    { id: "1-8", label: "1.8", supported: false },
  ];
  const fallback = { id: "1-21", label: "1.21" };
  assert.deepEqual(startVersion({ versions } as never, { versionSlug: "1-21", versionLabel: "1.21" }, fallback), { id: "1-21", changed: false, was: null });
  assert.equal(startVersion({ versions } as never, { versionSlug: "1-21-0", versionLabel: null }, fallback).id, "1-21", "by a former id");
  assert.equal(startVersion({ versions } as never, { versionSlug: null, versionLabel: "1.21" }, fallback).id, "1-21", "by label");
  const retired = startVersion({ versions } as never, { versionSlug: "1-8", versionLabel: "1.8" }, fallback);
  assert.deepEqual(retired, { id: "1-21", changed: true, was: "1.8" });
  const gone = startVersion({ versions } as never, { versionSlug: "0-1", versionLabel: "0.1" }, fallback);
  assert.deepEqual(gone, { id: "1-21", changed: true, was: "0.1" });
});
