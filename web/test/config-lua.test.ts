import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPatch,
  configDrift,
  configFor,
  mergeLua,
  readConfigValues,
  readLuaValue,
  renderConfig,
  scopeToLine,
  validateConfig,
} from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";

/* A world's rules as a Lua file: what Geeboard writes before a server's
   first start, what the game rewrites it into, and reading both back.
   The shapes here are the ones measured on Zomboid 42.20.4 and 41.78.19
   — see the definition — trimmed to the lines the tests need. */

const zomboid = requireGame("project-zomboid");
const b42 = scopeToLine(zomboid, "b42");
const b41 = scopeToLine(zomboid, "b41");
const FILE = "Server/geeboard_SandboxVars.lua";

/* The game's own shape after a first start, cut down. Strength appears
   under two tables on purpose: a writer that matched keys without their
   table would set the wrong one. */
const REWRITTEN = [
  "SandboxVars = {",
  "    VERSION = 6,",
  "    -- Changing this also sets the \"Population Multiplier\". Default = Normal",
  "    Zombies = 4,",
  "    DayLength = 4,",
  '    WorldItemRemovalList = "Base.Hat, Base.Glasses",',
  "    ZombieLore = {",
  "        Speed = 4,",
  "        Strength = 2,",
  "    },",
  "    ZombieConfig = {",
  "        PopulationMultiplier = 0.65,",
  "    },",
  "    MultiplierConfig = {",
  "        Global = 1.0,",
  "        GlobalToggle = true,",
  "        Strength = 1.0",
  "    }",
  "}",
  "",
].join("\n");

/* ── Writing ──────────────────────────────────────────────────────── */

test("a new file starts from the preset and lists the choices over it", () => {
  const text = mergeLua("", [
    { section: "SandboxVars", key: "", value: "Sandbox/Extinction" },
    { section: "SandboxVars", key: "Zombies", value: "5" },
    { section: "SandboxVars", key: "ZombieConfig.PopulationMultiplier", value: "0.15" },
  ]);

  const lines = text.split("\n").filter((l) => !l.startsWith("--") && l.length > 0);
  assert.deepEqual(lines, [
    'SandboxVars = require "Sandbox/Extinction"',
    "SandboxVars.Zombies = 5",
    "SandboxVars.ZombieConfig.PopulationMultiplier = 0.15",
  ]);
  assert.match(text, /^-- Written by Geeboard/);
});

test("a new file with nothing to start from is refused, not guessed at", () => {
  assert.throws(
    () => mergeLua("", [{ section: "SandboxVars", key: "Zombies", value: "5" }]),
    /nothing to start from/,
  );
});

test("the shape Geeboard wrote takes a new base, a changed key and an added one", () => {
  const before = 'SandboxVars = require "Sandbox/Apocalypse"\nSandboxVars.Zombies = 4\n';
  const after = mergeLua(before, [
    { section: "SandboxVars", key: "", value: "Sandbox/Rising" },
    { section: "SandboxVars", key: "Zombies", value: "5" },
    { section: "SandboxVars", key: "DayLength", value: "6" },
  ]);
  assert.equal(after, 'SandboxVars = require "Sandbox/Rising"\nSandboxVars.Zombies = 5\nSandboxVars.DayLength = 6\n');
});

test("the game's own shape has its keys replaced inside the right table, and nothing else touched", () => {
  const after = mergeLua(REWRITTEN, [
    { section: "SandboxVars", key: "Zombies", value: "6" },
    { section: "SandboxVars", key: "ZombieLore.Strength", value: "1" },
    { section: "SandboxVars", key: "MultiplierConfig.Strength", value: "3.0" },
    { section: "SandboxVars", key: "MultiplierConfig.Global", value: "2.0" },
  ]);

  assert.match(after, /^    Zombies = 6,$/m);
  assert.match(after, /^        Speed = 4,$/m, "a neighbour is left alone");
  assert.match(after, /ZombieLore = \{\n        Speed = 4,\n        Strength = 1,\n/);
  assert.match(after, /Global = 2\.0,\n        GlobalToggle = true,\n        Strength = 3\.0\n/, "no comma after the last key, as before");
  assert.match(after, /-- Changing this also sets/, "the game's comments survive");
  assert.match(after, /WorldItemRemovalList = "Base\.Hat, Base\.Glasses",/, "a string with a comma inside is not a key");
  assert.equal(after.split("\n").length, REWRITTEN.split("\n").length, "no line added or lost");
});

test("a key the game's file does not have is an error, not an insertion", () => {
  assert.throws(
    () => mergeLua(REWRITTEN, [{ section: "SandboxVars", key: "ZombieRespawn", value: "2" }]),
    /has no SandboxVars\.ZombieRespawn/,
  );
  assert.throws(
    () => mergeLua(REWRITTEN, [{ section: "SandboxVars", key: "ZombieConfig.Nope", value: "2" }]),
    /ZombieConfig\.Nope/,
  );
});

test("a preset cannot be put under a file the game has already written", () => {
  assert.throws(
    () => mergeLua(REWRITTEN, [{ section: "SandboxVars", key: "", value: "Sandbox/Rising" }]),
    /already been written by the game/,
  );
});

test("a file in neither shape is refused", () => {
  assert.throws(
    () => mergeLua("Something = 1\n", [{ section: "SandboxVars", key: "Zombies", value: "1" }]),
    /no SandboxVars table/,
  );
  assert.throws(
    () => mergeLua("", [{ section: "A", key: "", value: "x" }, { section: "B", key: "k", value: "1" }]),
    /one table at a time/,
  );
});

/* ── Reading ──────────────────────────────────────────────────────── */

test("a value reads back from either shape, and the base only from Geeboard's", () => {
  const mine = 'SandboxVars = require "Sandbox/Rising"\nSandboxVars.Zombies = 5\nSandboxVars.ZombieLore.Speed = 3\n';
  assert.equal(readLuaValue(mine, "SandboxVars", ""), "Sandbox/Rising");
  assert.equal(readLuaValue(mine, "SandboxVars", "Zombies"), "5");
  assert.equal(readLuaValue(mine, "SandboxVars", "ZombieLore.Speed"), "3");
  assert.equal(readLuaValue(mine, "SandboxVars", "DayLength"), undefined);

  assert.equal(readLuaValue(REWRITTEN, "SandboxVars", ""), undefined);
  assert.equal(readLuaValue(REWRITTEN, "SandboxVars", "Zombies"), "4");
  assert.equal(readLuaValue(REWRITTEN, "SandboxVars", "ZombieLore.Strength"), "2");
  assert.equal(readLuaValue(REWRITTEN, "SandboxVars", "MultiplierConfig.Strength"), "1.0");
  assert.equal(readLuaValue(REWRITTEN, "SandboxVars", "WorldItemRemovalList"), "Base.Hat, Base.Glasses");
  assert.equal(readLuaValue(REWRITTEN, "Other", "Zombies"), undefined);
});

test("the settings form reads the game's file as choices, whatever the spelling of a number", () => {
  const rewritten = REWRITTEN.replace("Global = 1.0", "Global = 2").replace("Zombies = 4", "Zombies = 3");
  const values = readConfigValues(b42, [{ path: FILE, content: rewritten }]);

  assert.equal(values.zombiePopulation, "3");
  assert.equal(values.dayLength, "4");
  assert.equal(values.zombieSpeed, "4");
  assert.equal(values.xpMultiplier, "2.0", "2 in the file is the 2.0 option");
  // The rewritten file names no preset; the stored value is the only record.
  assert.equal(values.sandboxPreset, undefined);

  const mine = 'SandboxVars = require "Sandbox/Rising"\nSandboxVars.Zombies = 5\n';
  assert.equal(readConfigValues(b42, [{ path: FILE, content: mine }]).sandboxPreset, "Rising");
});

test("a choice left to the preset is not drift against what the file holds", () => {
  const drift = configDrift(b42, { zombiePopulation: "", dayLength: "2" }, { zombiePopulation: "4", dayLength: "4" });
  assert.deepEqual(drift.map((d) => d.key), ["dayLength"]);
});

/* ── Rendering ────────────────────────────────────────────────────── */

test("the world's rules render to one Lua patch: the preset, the choices, their companions", () => {
  const rendered = renderConfig(
    b42,
    { sandboxPreset: "Extinction", zombiePopulation: "3", xpMultiplier: "2.0", zombieSpeed: "" },
    undefined,
    { creating: true },
  );
  const patch = rendered.files.find((f) => f.format === "lua")!;

  assert.equal(patch.path, FILE);
  assert.deepEqual(
    patch.entries.map((e) => [e.key, e.value]),
    [
      ["", "Sandbox/Extinction"],
      ["Zombies", "3"],
      ["ZombieConfig.PopulationMultiplier", "1.2"],
      ["MultiplierConfig.Global", "2.0"],
      ["MultiplierConfig.GlobalToggle", "true"],
    ],
    "a speed left to the preset writes nothing",
  );
  assert.equal(rendered.env.SERVERPRESET, undefined, "the image's own preset copy is not used");

  const text = applyPatch(patch, "");
  assert.match(text, /^SandboxVars = require "Sandbox\/Extinction"$/m);
  assert.match(text, /^SandboxVars\.ZombieConfig\.PopulationMultiplier = 1\.2$/m);
});

test("the world's rules are rendered only for a server being created", () => {
  const rendered = renderConfig(b42, { sandboxPreset: "Extinction", zombiePopulation: "3" });
  assert.equal(rendered.files.some((f) => f.format === "lua"), false);
  // The ordinary settings still are.
  assert.ok(rendered.files.some((f) => f.path === "Server/geeboard.ini"));
});

test("build 41 has its own counts and multipliers, and its own XP key", () => {
  const rendered = renderConfig(b41, { zombiePopulation: "5", xpMultiplier: "1.5" }, undefined, { creating: true });
  const entries = rendered.files.find((f) => f.format === "lua")!.entries.map((e) => [e.key, e.value]);
  assert.deepEqual(entries, [
    ["", "Sandbox/Apocalypse"],
    ["Zombies", "5"],
    ["ZombieConfig.PopulationMultiplier", "0.35"],
    ["XpMultiplier", "1.5"],
  ]);
});

/* ── Version lines ────────────────────────────────────────────────── */

test("each build sees its own shape of the same setting", () => {
  const keys = (fields: { key: string }[]) => fields.map((f) => f.key);

  assert.ok(keys(b42.config).includes("zombieRespawn"));
  assert.ok(!keys(b41.config).includes("zombieRespawn"), "build 41 has no respawn option");
  assert.equal(b42.config.filter((f) => f.key === "zombiePopulation").length, 1);
  assert.equal(b41.config.filter((f) => f.key === "zombiePopulation").length, 1);
  assert.equal(b42.config.find((f) => f.key === "zombiePopulation")!.options!.length, 7, "six counts and the preset's");
  assert.equal(b41.config.find((f) => f.key === "zombiePopulation")!.options!.length, 6);

  // A build 42 count on a build 41 server is refused, not written.
  assert.equal(validateConfig(b41, { zombiePopulation: "6" }).length, 1);
  assert.equal(validateConfig(b42, { zombiePopulation: "6" }).length, 0);

  /* No line to go on: only the settings every version shares, so nothing
     with a build-specific meaning is offered to a world of unknown build. */
  const unknown = configFor(zomboid, undefined);
  assert.ok(keys(unknown).includes("maxPlayers"));
  assert.ok(keys(unknown).includes("startMonth"), "the same on both builds");
  assert.ok(!keys(unknown).includes("sandboxPreset"));
});
