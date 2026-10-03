import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { brokenPatterns, consolePatternsOf, execPattern, guardPatterns, testPattern } from "../src/domain/games/matcher.ts";
import { COMMUNITY_PREFIX, allGames, communityGameIds, findGame, gamesInFamily, isCommunityId, requireGame, setCommunityGames } from "../src/domain/games/registry.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { MINECRAFT_JAVA } from "../src/domain/games/definitions/minecraft-java.ts";
import { knownFailure } from "../src/domain/servers/health.ts";
import { playerEvents } from "../src/domain/servers/players.ts";
import { waitForSave } from "../src/domain/servers/save.ts";
import type { GameDefinition } from "../src/domain/games/types.ts";

/* Where a game that came from a manifest lives in the process, and how its
   expressions are matched. The definitions here are the shipped ones renamed:
   what is under test is the registry and the matcher, not a manifest. */

const community = (id: string, over: Partial<GameDefinition> = {}): GameDefinition => ({ ...JSON.parse(JSON.stringify(TERRARIA)), id, name: `Game ${id}`, family: `Family ${id}`, official: false, ...over });

afterEach(() => {
  setCommunityGames({ active: [], retired: [] });
  guardPatterns([]);
});

test("no game Geeboard ships has the community prefix: it is what tells them apart", () => {
  assert.ok(allGames().every((g) => !g.id.startsWith(COMMUNITY_PREFIX)));
  assert.equal(isCommunityId("community-factorio"), true);
  assert.equal(isCommunityId("terraria"), false);
});

test("an approved game is found, listed, and after the shipped ones", () => {
  const before = allGames().length;
  setCommunityGames({ active: [community("community-a")], retired: [] });
  assert.equal(allGames().length, before + 1);
  assert.equal(allGames().at(-1)?.id, "community-a");
  assert.equal(findGame("community-a")?.name, "Game community-a");
  assert.equal(requireGame("community-a").id, "community-a");
  assert.deepEqual(communityGameIds(), { active: ["community-a"], retired: [] });
  assert.equal(findGame("terraria")?.id, "terraria", "the shipped ones are where they were");
});

test("a retired game is found, so its servers go on working, and is not listed, so nothing new is made from it", () => {
  const before = allGames().length;
  setCommunityGames({ active: [], retired: [community("community-gone")] });
  assert.equal(allGames().length, before);
  assert.ok(!allGames().some((g) => g.id === "community-gone"));
  assert.equal(findGame("community-gone")?.id, "community-gone");
  assert.equal(gamesInFamily("Family community-gone").length, 1, "a server is found through its family");
});

test("a game both active and retired is active: the newer approval wins", () => {
  setCommunityGames({ active: [community("community-x", { name: "New" })], retired: [community("community-x", { name: "Old" })] });
  assert.equal(findGame("community-x")?.name, "New");
  assert.deepEqual(communityGameIds().retired, []);
});

test("a game with no prefix, or the id of one Geeboard ships, is not loaded: it could not be told apart", () => {
  setCommunityGames({ active: [community("factorio"), community("terraria", { name: "Impostor" }), community("community-ok")], retired: [community("minecraft-java")] });
  assert.deepEqual(communityGameIds(), { active: ["community-ok"], retired: [] });
  assert.equal(findGame("terraria")?.name, "Terraria", "the shipped game was not replaced");
  assert.equal(findGame("minecraft-java")?.name, MINECRAFT_JAVA.name);
  assert.equal(findGame("factorio"), undefined);
});

test("what is loaded is replaced, not added to", () => {
  setCommunityGames({ active: [community("community-a")], retired: [] });
  setCommunityGames({ active: [community("community-b")], retired: [] });
  assert.equal(findGame("community-a"), undefined);
  assert.equal(findGame("community-b")?.id, "community-b");
});

/* ── The matcher ──────────────────────────────────────────────── */

test("every expression a game runs on a console line is collected", () => {
  const found = consolePatternsOf(MINECRAFT_JAVA);
  assert.ok(found.length >= 4, String(found.length));
  assert.ok(found.includes(MINECRAFT_JAVA.console.players!.join));
  assert.ok(found.every((p) => typeof p === "string" && p.length > 0));
});

test("a shipped game's expression is matched as it always was, with its named groups", () => {
  const join = MINECRAFT_JAVA.console.players!.join;
  const m = execPattern(join, "[Server thread/INFO]: Alex joined the game");
  assert.equal(m?.groups?.name, "Alex");
  assert.equal(execPattern(join, "nothing here"), null);
  assert.equal(testPattern("(", "x"), false, "an expression that does not compile never matches");
});

test("a guarded expression that goes exponential costs the limit and is then broken, not run again", () => {
  const fatal = "^(a+)+$";
  guardPatterns([fatal]);
  const line = `${"a".repeat(40)}!`;
  let started = Date.now();
  assert.equal(testPattern(fatal, line), false);
  assert.ok(Date.now() - started < 500, `${Date.now() - started} ms`);
  assert.deepEqual(brokenPatterns(), [fatal]);
  started = Date.now();
  for (let i = 0; i < 1000; i++) testPattern(fatal, line);
  assert.ok(Date.now() - started < 200, "a broken expression is skipped without being run");
  guardPatterns([fatal]);
  assert.deepEqual(brokenPatterns(), [], "a new set forgives it");
});

test("the same text unguarded is what it was: the guard is the only thing that stops it", () => {
  assert.equal(testPattern("^(a+)+$", "aaaa"), true);
});

test("a guarded expression that is fine behaves exactly like an unguarded one", () => {
  const join = MINECRAFT_JAVA.console.players!.join;
  const line = "[Server thread/INFO]: Alex joined the game";
  const plain = execPattern(join, line);
  guardPatterns([join]);
  assert.deepEqual(execPattern(join, line), plain);
  assert.equal(execPattern(join, "no")?.groups, undefined);
});

/* ── Where a game's expressions are used ──────────────────────── */

test("a community game's hostile player pattern cannot hold the poller: no events, and quickly", () => {
  const dialect = { players: { join: "^(?<name>(a+)+)$", leave: "^(?<name>\\S+) left$" } };
  guardPatterns([dialect.players.join, dialect.players.leave]);
  const lines = Array.from({ length: 5 }, (_, i) => ({ line: `${"a".repeat(40)}!`, at: new Date(Date.UTC(2026, 9, 3, 10, 0, i)).toISOString() }));
  const started = Date.now();
  const events = playerEvents(dialect as never, lines);
  assert.deepEqual(events, []);
  assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
});

test("a community game's hostile failure pattern cannot hold the health check either", () => {
  const game = { health: { probes: [], bootGraceSeconds: 1, failures: [{ pattern: "^(\\w+\\s?)*$", reason: "boom" }] } };
  guardPatterns(["^(\\w+\\s?)*$"]);
  const started = Date.now();
  assert.equal(knownFailure(game as never, [`${"word ".repeat(30)}!`]), null);
  assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
});

test("waiting for a save with a hostile ready pattern gives up at its deadline and does not hang", async () => {
  guardPatterns(["^(a+)+$"]);
  let at = 0;
  const runtime = {
    sendCommand: async () => undefined,
    logs: async () => [{ line: `${"a".repeat(40)}!`, at: new Date().toISOString() }],
  };
  const started = Date.now();
  const saved = await waitForSave(runtime as never, { serverId: "s", runtimeId: "r" }, { command: "save", pattern: "^(a+)+$", timeoutSeconds: 1 }, new Date(), {
    pollMs: 1,
    sleep: async () => undefined,
    now: () => (at += 600),
  });
  assert.equal(saved, false);
  assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
});
