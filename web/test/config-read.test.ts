import assert from "node:assert/strict";
import { test } from "node:test";
import { configDrift, configFilesOf, readConfigValues } from "../src/domain/games/config";
import type { GameDefinition } from "../src/domain/games/types";

/* Reading a server's settings back out of the files it actually has.

   The panel's stored settings are what it last wrote; the file is what
   the game reads. Where they differ, the file wins on screen. */

const game = {
  config: [
    { key: "motd", label: "MOTD", type: "string", default: "", target: { kind: "properties", file: "serverconfig.txt", key: "motd" } },
    { key: "maxPlayers", label: "Max players", type: "number", default: 8, target: { kind: "properties", file: "serverconfig.txt", key: "maxplayers" } },
    { key: "secure", label: "Anti-cheat", type: "boolean", default: true, target: { kind: "properties", file: "serverconfig.txt", key: "secure" } },
    {
      key: "difficulty", label: "Difficulty", type: "enum", default: "1",
      options: [{ value: "0", label: "Classic" }, { value: "1", label: "Expert" }],
      target: { kind: "properties", file: "serverconfig.txt", key: "difficulty" },
    },
    { key: "pvp", label: "PvP", type: "boolean", default: false, target: { kind: "ini", file: "server.ini", section: "Game", key: "PVP" } },
    { key: "memory", label: "Memory", type: "number", default: 4, target: { kind: "env", name: "MEMORY" } },
  ],
} as unknown as GameDefinition;

const properties = [
  "# written by the game",
  "motd=Hand edited",
  "maxplayers = 12",
  "secure=false",
  "difficulty=0",
  "unknownkey=ignored",
].join("\n");

test("only the files settings live in are read", () => {
  assert.deepEqual(configFilesOf(game).sort(), ["server.ini", "serverconfig.txt"]);
});

test("values come back typed as their field", () => {
  const values = readConfigValues(game, [{ path: "serverconfig.txt", content: properties }]);
  assert.deepEqual(values, { motd: "Hand edited", maxPlayers: 12, secure: false, difficulty: "0" });
});

test("an INI value is read from its own section, and a leading ./ in a path is the same file", () => {
  const ini = ["[Server]", "PVP=true", "", "[Game]", "PVP=false"].join("\n");
  assert.deepEqual(readConfigValues(game, [{ path: "./server.ini", content: ini }]), { pvp: false });
});

test("a value the field cannot hold is left out rather than forced", () => {
  const odd = ["maxplayers=lots", "secure=maybe", "difficulty=9"].join("\n");
  assert.deepEqual(readConfigValues(game, [{ path: "serverconfig.txt", content: odd }]), {});
});

test("a file that was not read leaves its fields alone", () => {
  assert.deepEqual(readConfigValues(game, []), {});
});

test("drift names what the file says and what the panel stored", () => {
  const stored = { motd: "Welcome", maxPlayers: 8, secure: true, difficulty: "1" };
  const onServer = readConfigValues(game, [{ path: "serverconfig.txt", content: properties }]);
  assert.deepEqual(
    configDrift(game, stored, onServer).map((d) => `${d.label} ${d.stored}→${d.onServer}`),
    ["MOTD Welcome→Hand edited", "Max players 8→12", "Anti-cheat true→false", "Difficulty 1→0"],
  );
  assert.deepEqual(configDrift(game, { ...stored, ...onServer }, onServer), []);
});

test("a stored value that is missing falls back to the field's default", () => {
  const onServer = readConfigValues(game, [{ path: "serverconfig.txt", content: "maxplayers=8" }]);
  assert.deepEqual(configDrift(game, {}, onServer), []);
});

/* Terraria's world file: a name in the form, a path in the file. */
test("a properties prefix is written in front of the value and taken off when read back", async () => {
  const { renderConfig, validateConfig } = await import("../src/domain/games/config");
  const { requireGame } = await import("../src/domain/games/registry");
  const terraria = requireGame("terraria");

  const rendered = renderConfig(terraria, { worldFile: "Volla(FR).wld" });
  const world = rendered.files.flatMap((f) => f.entries).find((e) => e.key === "world");
  assert.equal(world?.value, "/data/Volla(FR).wld");

  const read = readConfigValues(terraria, [{ path: "serverconfig.txt", content: "world=/data/Volla(FR).wld\nworldpath=/data\n" }]);
  assert.equal(read.worldFile, "Volla(FR).wld");
  // Edited by hand to something else, it is shown as it is, so it reads as drift.
  const edited = readConfigValues(terraria, [{ path: "serverconfig.txt", content: "world=/data\n" }]);
  assert.equal(edited.worldFile, "/data");

  // And only a file name in the server's folder is taken.
  assert.equal(validateConfig(terraria, { worldFile: "Volla(FR).wld" }).length, 0);
  for (const bad of ["/data", "../etc/world.wld", "world", "worlds/a.wld"]) {
    assert.equal(validateConfig(terraria, { worldFile: bad }).length, 1, bad);
  }
});
