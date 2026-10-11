import assert from "node:assert/strict";
import { test } from "node:test";
import { plainLine } from "../src/domain/console/plain.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { playerEvents } from "../src/domain/servers/players.ts";

/* What itzg's image printed at the start of a real Paper 26.2 server (itzg/minecraft-server:2026.9.1-java25, through an agent, October
   2026), byte for byte from `docker logs`: the console showed "[39m" and "[0;39m" before the words, with the escape as a glyph. */
const PAPER_START = [
  "\u001b[39m[mc-image-helper] 16:55:29.378 INFO  : Downloaded /data/paper-26.2-133.jar",
  "\u001b[0;39m[init] Copying any plugins from /plugins to /data/plugins",
  "\u001b[0;39m\u001b[39m[mc-image-helper] 16:55:45.188 INFO  : Downloaded /data/bukkit.yml from https://raw.githubusercontent.com/Shonz1/minecraft-default-configs/main/26.2/bukkit.yml",
  "\u001b[0;39m[init] Starting the Minecraft server...",
];

test("Paper's first lines are shown as their words", () => {
  assert.deepEqual(PAPER_START.map(plainLine), [
    "[mc-image-helper] 16:55:29.378 INFO  : Downloaded /data/paper-26.2-133.jar",
    "[init] Copying any plugins from /plugins to /data/plugins",
    "[mc-image-helper] 16:55:45.188 INFO  : Downloaded /data/bukkit.yml from https://raw.githubusercontent.com/Shonz1/minecraft-default-configs/main/26.2/bukkit.yml",
    "[init] Starting the Minecraft server...",
  ]);
});

test("a line with no escapes is left exactly as it was, brackets and all", () => {
  for (const line of [
    "[init] Resolving type given PAPER",
    "[12:00:01 INFO]: <Steve> [39m is not an escape without its escape character",
    "Resetting game objects 37%",
    "  indented\ttabbed  ",
    "",
  ]) {
    assert.equal(plainLine(line), line);
  }
});

test("the other codes a terminal reads are taken off too", () => {
  // Colours with several parameters, 256 and true colour, and the bare reset.
  assert.equal(plainLine("\u001b[1;31mERROR\u001b[m done"), "ERROR done");
  assert.equal(plainLine("\u001b[38;5;208morange\u001b[0m \u001b[38;2;255;0;0mred\u001b[0m"), "orange red");
  // Erasing the line and moving the cursor, as a progress bar does.
  assert.equal(plainLine("\u001b[2K\u001b[1GDownloading 40%"), "Downloading 40%");
  // A terminal's title (OSC), ended by BEL or by ESC \, and a link.
  assert.equal(plainLine("\u001b]0;Minecraft server\u0007Starting"), "Starting");
  assert.equal(plainLine("\u001b]8;;https://example.org\u001b\\a link\u001b]8;;\u001b\\ here"), "a link here");
  // A character set chosen, a cursor saved, and an escape cut off at the end of a line.
  assert.equal(plainLine("\u001b(Bplain\u001b7 text\u001b"), "plain text");
  // The one-byte forms.
  assert.equal(plainLine("\u009b32mgreen\u009b0m"), "green");
});

test("a coloured join line is a join once its codes are off, which is what the players read", () => {
  const minecraft = requireGame("minecraft-java").console;
  const at = "2026-10-11T16:57:01.000000000Z";
  const coloured = [{ line: "\u001b[0;39m[16:57:01 INFO]: Steve joined the game\u001b[m", at }];
  // The pattern ends at the end of the line, and the reset after the name used to stand between them.
  assert.equal(playerEvents(minecraft, coloured).length, 0);
  assert.deepEqual(
    playerEvents(minecraft, coloured.map((l) => ({ ...l, line: plainLine(l.line) }))).map((e) => [e.kind, e.name]),
    [["join", "Steve"]],
  );
});
