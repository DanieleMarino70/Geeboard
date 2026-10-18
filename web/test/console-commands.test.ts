import assert from "node:assert/strict";
import { test } from "node:test";
import { auditDefinition } from "../src/domain/games/audit.ts";
import { commandsMatching, MAX_COMMANDS, parseConsoleCommands } from "../src/domain/games/console-commands.ts";
import { requireGame } from "../src/domain/games/registry.ts";

/* The commands a server lists of its own (ConsoleDialect.commands): written by the game, so read as text from somewhere else,
   and offered as a command is typed. The lines are what Garry's Mod with ULX, TTT2 and its ULX commands wrote in October 2026. */

const WRITTEN = [
  "ulx kick\t<player> [{reason}]\tKicks target.",
  "ulx ban\t<player> [<minutes, 0 for perma: 0<=x, default 0>] [{reason}]\tBans target.",
  "ulx karma\t<player> <number>\tChanges the target's karma.",
  "ulx map\t<map> [<gamemode>]\tChanges map and gamemode.",
  "ttt_force_role",
  "_u",
  "_xgui",
  "kickid2",
].join("\n");

test("each line is a command, what it takes and what it does; an addon's plumbing is left out", () => {
  const commands = parseConsoleCommands(WRITTEN);
  assert.deepEqual(
    commands.map((c) => c.command),
    ["kickid2", "ttt_force_role", "ulx ban", "ulx karma", "ulx kick", "ulx map"],
  );
  assert.deepEqual(commands.find((c) => c.command === "ulx kick"), { command: "ulx kick", usage: "<player> [{reason}]", help: "Kicks target." });
  assert.deepEqual(commands.find((c) => c.command === "ttt_force_role"), { command: "ttt_force_role", usage: "", help: "" });
});

test("what the game wrote is held to a shape: a name that is not one is left out, help is cut and has no control characters", () => {
  const commands = parseConsoleCommands(
    [
      "say;quit\tx\ty",
      "<script>\tx\ty",
      "three words here\tx\ty",
      "-dash\tx\ty",
      `long_help\t\t${"word ".repeat(100)}`,
      "bell\t\u0007<a>\tline\u001bone",
      "KICKID2\t\tsecond spelling",
      "kickid2\t\tfirst spelling",
    ].join("\r\n"),
  );
  assert.deepEqual(commands.map((c) => c.command), ["bell", "KICKID2", "long_help"]);
  assert.equal(commands.find((c) => c.command === "long_help")!.help.length, 200);
  assert.ok(commands.find((c) => c.command === "long_help")!.help.endsWith("…"));
  assert.deepEqual(commands.find((c) => c.command === "bell"), { command: "bell", usage: "<a>", help: "line one" });
  // The first spelling of a name is kept, as the engine matches names without regard to case.
  assert.equal(commands.find((c) => c.command.toLowerCase() === "kickid2")!.help, "second spelling");
});

test("a list larger than a list can be is cut, not refused", () => {
  const many = Array.from({ length: MAX_COMMANDS + 50 }, (_, i) => `cmd_${i}`).join("\n");
  assert.equal(parseConsoleCommands(many).length, MAX_COMMANDS);
});

test("what is typed finds the commands it begins first, then those with a word it begins", () => {
  const commands = parseConsoleCommands(WRITTEN);
  const names = (typed: string) => commandsMatching(commands, typed).map((c) => c.command);
  assert.deepEqual(names("u"), [], "nothing for one character");
  assert.deepEqual(names("ulx k"), ["ulx karma", "ulx kick"]);
  assert.deepEqual(names("ki"), ["kickid2", "ulx kick"]);
  assert.deepEqual(names("ULX MA"), ["ulx map"]);
  // Past the command, into its arguments, nothing is offered.
  assert.deepEqual(names("ulx kick bob"), []);
});

const gmod = requireGame("garrys-mod");

test("Garry's Mod is asked in lines its console takes whole, which write the file the panel reads", () => {
  const listing = gmod.console.commands!;
  assert.equal(listing.file, "geeboard/commands.txt");
  for (const line of listing.ask) {
    assert.ok(line.startsWith("lua_run "), line);
    // Its console cut a line at 254 characters; ; ends a command and // starts a comment.
    assert.ok(line.length <= 250, `${line.length} characters`);
    assert.doesNotMatch(line, /;|\/\//);
  }
  // Lua's file.Write is relative to garrysmod/data, which is the server's folder: the same path.
  assert.ok(listing.ask.at(-1)!.includes(`file.Write("${listing.file}"`), "the last line writes the file");
  assert.ok(listing.ask.at(-1)!.endsWith("gb_cmds=nil"), "and takes its global off again");
});

test("the audit holds the list to lines a console takes and a file in the server's folder", () => {
  const broken = (commands: { ask: string[]; file: string }) => auditDefinition({ ...gmod, console: { ...gmod.console, commands } });
  assert.deepEqual(auditDefinition(gmod), []);
  assert.ok(broken({ ask: ["x".repeat(251)], file: "geeboard/c.txt" }).some((p) => /longer than 250/.test(p)));
  assert.ok(broken({ ask: ["a\nb"], file: "geeboard/c.txt" }).some((p) => /not one line/.test(p)));
  assert.ok(broken({ ask: [], file: "geeboard/c.txt" }).some((p) => /no lines, or too many/.test(p)));
  for (const file of ["/etc/passwd", "../x.txt", "geeboard/../../x", "a b.txt"]) {
    assert.ok(broken({ ask: ["status"], file }).some((p) => /not a file in the server's own folder/.test(p)), file);
  }
});
