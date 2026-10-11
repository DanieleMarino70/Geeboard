/* eslint-disable @typescript-eslint/no-explicit-any -- a manifest is loose JSON until it is validated, and the last test breaks one */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { requireGame } from "../src/domain/games/registry.ts";
import { validateManifest } from "../src/domain/games/manifest.ts";
import { acceptsCommands, consoleLine } from "../src/domain/games/types.ts";
import { placeSent } from "../src/lib/console-lines.ts";
import type { LogLine } from "../src/lib/console-fixture.ts";

/* What reaches a game's console when somebody types at it. Found on a Project Zomboid server (October 2026): the panel delivered every
   line, and three of six were the game's "Unknown command" — `/setaccesslevel …` as the game's own help writes it, `say` from another
   game, a stray `a` — while nothing on the page said a line had gone or what came back from it. Each game's console was then typed at from
   its own image. */

test("a console that refuses a leading slash is sent the command without it, and one that takes it is sent what was typed", () => {
  const zomboid = requireGame("project-zomboid").console;
  assert.deepEqual(consoleLine(zomboid, "/setaccesslevel ciccio admin"), { line: "setaccesslevel ciccio admin", slashRemoved: true });
  assert.deepEqual(consoleLine(zomboid, '  setaccesslevel "ciccio" admin '), { line: 'setaccesslevel "ciccio" admin', slashRemoved: false });
  // Two slashes, or a slash and a space, are still the one command.
  assert.equal(consoleLine(zomboid, "// players").line, "players");
  // A slash alone leaves nothing to send, which the operation refuses.
  assert.equal(consoleLine(zomboid, "/").line, "");
  // A slash inside the command is the command's.
  assert.equal(consoleLine(zomboid, 'servermsg "and/or"').line, 'servermsg "and/or"');

  const java = requireGame("minecraft-java").console;
  assert.deepEqual(consoleLine(java, "/list"), { line: "/list", slashRemoved: false });
  assert.deepEqual(consoleLine(undefined, " /list "), { line: "/list", slashRemoved: false });
});

test("the games that answered a slash with an unknown command say so, and the one that took it does not", () => {
  // Measured on each image, October 2026: see each definition.
  for (const id of ["project-zomboid", "minecraft-bedrock", "terraria", "garrys-mod"]) {
    assert.equal(requireGame(id).console.refusesSlash, true, id);
  }
  assert.notEqual(requireGame("minecraft-java").console.refusesSlash, true);
});

test("Zomboid's examples are its console's syntax: names and messages in quotes, no slash, and the level that undoes admin", () => {
  const examples = requireGame("project-zomboid").console.examples ?? [];
  assert.ok(examples.includes('setaccesslevel "<name>" admin'));
  assert.ok(examples.includes('setaccesslevel "<name>" user'));
  assert.ok(examples.includes('servermsg "<text>"'));
  assert.ok(examples.includes('kickuser "<name>"'));
  for (const e of examples) {
    assert.ok(!e.startsWith("/"), `${e}: the console calls a slash an unknown command`);
    // A placeholder that is a name or a message is quoted: either may have a space in it.
    for (const hole of e.match(/<(name|text)>/g) ?? []) assert.ok(e.includes(`"${hole}"`), `${e}: ${hole} unquoted`);
  }
  assert.equal(requireGame("project-zomboid").console.broadcastCommand, 'servermsg "%s"');
});

test("every example a console offers is something it takes: no slash where a slash is refused", () => {
  for (const id of ["minecraft-java", "minecraft-bedrock", "terraria", "project-zomboid", "valheim", "garrys-mod"]) {
    const dialect = requireGame(id).console;
    for (const e of dialect.examples ?? []) assert.equal(consoleLine(dialect, e).slashRemoved, false, `${id}: ${e}`);
  }
});

test("Valheim takes no commands, and every other game does", () => {
  assert.equal(acceptsCommands(requireGame("valheim").console), false);
  for (const id of ["minecraft-java", "minecraft-bedrock", "terraria", "project-zomboid", "garrys-mod"]) {
    assert.equal(acceptsCommands(requireGame(id).console), true, id);
  }
});

const line = (message: string, at?: string, sent = false): LogLine => ({
  time: "",
  level: sent ? "CMD" : "INFO",
  message,
  at,
  ...(sent ? { sent: { slashRemoved: false } } : {}),
});

test("a sent command is shown before the first line the server wrote after it, by time", () => {
  const server = [
    line("before", "2026-10-11T12:58:38.900000000Z"),
    line('command entered via server console (System.in): "players"', "2026-10-11T12:58:48.808123456Z"),
    line("Players connected (0):", "2026-10-11T12:58:48.881Z"),
  ];
  const sent = [line("players", "2026-10-11T12:58:48.800Z", true)];
  assert.deepEqual(placeSent(server, sent).map((l) => l.message), [
    "before",
    "players",
    'command entered via server console (System.in): "players"',
    "Players connected (0):",
  ]);
  // Nothing sent is the server's lines as they were, the same array.
  assert.equal(placeSent(server, []), server);
  // Sent after the last line, it is last; two sent out of order are put in order.
  const later = [line("b", "2026-10-11T13:00:02Z", true), line("a", "2026-10-11T13:00:01Z", true)];
  assert.deepEqual(placeSent(server, later).slice(-2).map((l) => l.message), ["a", "b"]);
  // A line with no time of its own keeps its place, and does not hold a command back.
  const untimed = [line("x"), line("y", "2026-10-11T13:00:05Z")];
  assert.deepEqual(placeSent(untimed, [line("c", "2026-10-11T13:00:03Z", true)]).map((l) => l.message), ["x", "c", "y"]);
});

test("a community game can say its console refuses a slash and give a hint, and is held to the types", () => {
  const terraria = requireGame("terraria");
  const m = JSON.parse(JSON.stringify(terraria)) as Record<string, any>;
  m.manifest = 1;
  m.id = "community-terraria";
  m.family = "Terraria Community";
  delete m.official;
  delete m.versionSources;
  delete m.followTags;
  m.install = { kind: "image", env: terraria.install.kind === "image" ? terraria.install.env : undefined };
  m.versions = m.versions.map((v: Record<string, any>) => ({
    ...v,
    image: `${String(v.image)}@sha256:${createHash("sha256").update(String(v.image)).digest("hex")}`,
  }));
  const ok = validateManifest(m);
  assert.ok(ok.ok, JSON.stringify(ok.ok ? null : ok.problems.slice(0, 3)));
  if (ok.ok) {
    assert.equal(ok.definition.console.refusesSlash, true);
    assert.equal(ok.definition.console.hint, terraria.console.hint);
  }

  m.console.refusesSlash = "yes";
  m.console.hint = "x".repeat(241);
  const bad = validateManifest(m);
  assert.equal(bad.ok, false);
  const paths = bad.ok ? [] : bad.problems.map((p) => p.path);
  assert.ok(paths.includes("console.refusesSlash"), JSON.stringify(paths));
  assert.ok(paths.includes("console.hint"), JSON.stringify(paths));
});
