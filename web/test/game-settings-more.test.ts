/* eslint-disable @typescript-eslint/no-explicit-any -- a manifest is loose JSON until it is validated, and the last test breaks one */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { auditDefinition } from "../src/domain/games/audit.ts";
import { applyPatch, fieldsAsShown, readChoices, readConfigValues, renderConfig, scopeToLine, validateConfig } from "../src/domain/games/config.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import { validateManifest } from "../src/domain/games/manifest.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import type { ConfigField, GameDefinition } from "../src/domain/games/types.ts";
import { ZOMBOID_PRESETS } from "../src/domain/games/zomboid-presets.ts";

/* The settings 0.11.0 added to Terraria's neighbours: Valheim's single
   world modifiers, Garry's Mod's choices and engine settings, and
   Zomboid's server options, world rules and what its presets set. Each
   was read off the game's own image first; the definitions' comments say
   where. */

const valheim = requireGame("valheim");
const gmod = requireGame("garrys-mod");
const zomboid = requireGame("project-zomboid");
const b42 = scopeToLine(zomboid, "b42");
const b41 = scopeToLine(zomboid, "b41");

const field = (game: GameDefinition, key: string): ConfigField => {
  const found = game.config.find((f) => f.key === key);
  assert.ok(found, `${game.id} has ${key}`);
  return found;
};
const emptyLabel = (fields: ConfigField[], key: string) => fields.find((f) => f.key === key)!.options!.find((o) => o.value === "")!.label;

/* ── Valheim ───────────────────────────────────────────────────── */

test("Valheim's preset comes first in SERVER_ARGS and each modifier after it, as the game's manual asks", () => {
  const env = renderConfig(valheim, {
    preset: "-preset hard",
    combat: "-modifier combat veryeasy",
    raids: "-modifier raids none",
    nomap: "-setkey nomap",
    saveInterval: "-saveinterval 600",
  }).env;
  assert.equal(env.SERVER_ARGS, "-preset hard -modifier combat veryeasy -modifier raids none -setkey nomap -saveinterval 600");
});

test("a modifier left to the preset writes nothing, even on a save that writes empty values", () => {
  assert.equal(renderConfig(valheim, { preset: "-preset casual" }).env.SERVER_ARGS, "-preset casual");
  const saved = renderConfig(valheim, { preset: "-preset normal", combat: "", portals: "-modifier portals veryhard" }, undefined, { includeEmpty: true });
  assert.equal(saved.env.SERVER_ARGS, "-preset normal -modifier portals veryhard");
});

test("every Valheim modifier is the manual's: a -modifier or -setkey with one of its values, or nothing", () => {
  const manual: Record<string, string[]> = {
    combat: ["veryeasy", "easy", "hard", "veryhard"],
    deathpenalty: ["casual", "veryeasy", "easy", "hard", "hardcore"],
    resources: ["muchless", "less", "more", "muchmore", "most"],
    raids: ["none", "muchless", "less", "more", "muchmore"],
    portals: ["casual", "hard", "veryhard"],
  };
  const keys = ["nobuildcost", "playerevents", "passivemobs", "nomap"];
  for (const f of valheim.config.filter((f) => f.group === "World modifiers")) {
    for (const { value } of f.options!) {
      if (value === "") continue;
      const modifier = /^-modifier (\w+) (\w+)$/.exec(value);
      const setkey = /^-setkey (\w+)$/.exec(value);
      assert.ok(modifier ? manual[modifier[1]!]?.includes(modifier[2]!) : setkey && keys.includes(setkey[1]!), `${f.key}: ${value}`);
    }
  }
  assert.deepEqual(
    field(valheim, "preset").options!.map((o) => o.value),
    ["casual", "easy", "normal", "hard", "hardcore", "immersive", "hammer"].map((p) => `-preset ${p}`),
  );
});

test("a server made before the modifiers keeps what it had: its stored preset is still valid and alone in SERVER_ARGS", () => {
  assert.deepEqual(validateConfig(valheim, { preset: "-preset hard", public: false, worldName: "geeboard" }), []);
  assert.equal(renderConfig(valheim, { preset: "-preset hard" }).env.SERVER_ARGS, "-preset hard");
});

test("two settings writing one variable must both say they are parts of it", () => {
  const broken: GameDefinition = {
    ...valheim,
    config: valheim.config.map((f) => (f.key === "combat" ? { ...f, target: { kind: "env", name: "SERVER_ARGS" } } : f)),
  };
  assert.ok(auditDefinition(broken).some((p) => /all write SERVER_ARGS, and not all of them as a part of it/.test(p)));
  assert.deepEqual(auditDefinition(valheim), []);
});

/* ── Garry's Mod ───────────────────────────────────────────────── */

test("Garry's Mod's region, uploads and downloads are cvars in server.cfg; its tick rate is a flag in ARGS", () => {
  const rendered = renderConfig(gmod, { region: "3", allowUpload: false, allowDownload: true, tickRate: "-tickrate 33" }, gmod.versions[0], { creating: true });
  const cfg = applyPatch(rendered.files.find((f) => f.path === "geeboard/server.cfg")!, "");
  assert.match(cfg, /^sv_region "3"$/m);
  assert.match(cfg, /^sv_allowupload "0"$/m);
  assert.match(cfg, /^sv_allowdownload "1"$/m);
  assert.equal(rendered.env.ARGS, "-tickrate 33");
  // And read back as the form shows them.
  const read = readConfigValues(gmod, [{ path: "geeboard/server.cfg", content: cfg }]);
  assert.equal(read.region, "3");
  assert.equal(read.allowUpload, false);
});

test("the gamemode and the map offer what the image has, and every offered name is one the setting takes", () => {
  const gamemodes = field(gmod, "gamemode").choices!.values.map((c) => c.value);
  assert.deepEqual(gamemodes, ["sandbox", "terrortown"]);
  const maps = field(gmod, "map").choices!.values.map((c) => c.value);
  assert.ok(maps.includes("gm_construct") && maps.includes("gm_flatgrass") && maps.includes("cs_office"));
  for (const key of ["gamemode", "map"]) {
    for (const { value } of field(gmod, key).choices!.values) assert.deepEqual(validateConfig(gmod, { [key]: value }), [], value);
  }
  // A CS:S map chosen from the list still says what players need (PR #18).
  assert.ok(field(gmod, "map").notice);
});

test("what the Workshop addons brought is read from the list the start script writes, a line at a time", () => {
  const content = [
    "map ttt_minecraft_b5 159321088",
    "gamemode prop_hunt 135509255",
    "map ttt_minecraft_b5 159321088", // twice: offered once
    "map gm_construct 1",
    "map bad;name 2", // not a name a map setting takes
    "gamemode Bad 3", // a gamemode's pattern is lowercase
    "something else entirely",
    "map ttt_67thway_v14 253297309",
  ].join("\n");
  const listed = readChoices(gmod, [{ path: "geeboard/content.txt", content }]);
  assert.deepEqual(listed.map?.map((c) => c.value), ["ttt_minecraft_b5", "gm_construct", "ttt_67thway_v14"]);
  assert.deepEqual(listed.gamemode?.map((c) => c.value), ["prop_hunt"]);
  assert.match(listed.map![0]!.label, /Workshop item 159321088/);

  // Shown after what the game has, and a name it already offers is not offered twice.
  const shown = fieldsAsShown(gmod.config, {}, listed);
  const maps = shown.find((f) => f.key === "map")!.choices!.values.map((c) => c.value);
  assert.equal(maps[0], "gm_construct");
  assert.equal(maps.filter((m) => m === "gm_construct").length, 1);
  assert.ok(maps.indexOf("ttt_67thway_v14") > maps.indexOf("cs_office"));
});

test("the start script lists each mounted addon's maps and gamemodes, afresh on every start, and still fits the agent", () => {
  const args = gmod.versions[0]!.args!;
  assert.ok(args.length <= 16 && args.every((a) => a.length <= 200));
  const script = args.slice(4).join("");
  assert.ok(script.indexOf("rm -f $g/addons/geeboard-* content.txt;") < script.indexOf(">>content.txt;"), "emptied before it is written");
  // Only for an item that was mounted, in the branch that mounts it.
  const listed = script.indexOf(">>content.txt;");
  assert.ok(script.indexOf('echo "Geeboard: Workshop item $i is mounted";') < listed);
  assert.ok(listed < script.indexOf('echo "Geeboard: Workshop item $i was not downloaded"'));
});

/* ── Project Zomboid ───────────────────────────────────────────── */

test("Zomboid's server options are keys of its .ini, as the game names them", () => {
  const rendered = renderConfig(b42, { sleepAllowed: true, sleepNeeded: true, playerSafehouse: true, safehouseRespawn: true, factions: false });
  const ini = applyPatch(rendered.files.find((f) => f.path === "Server/geeboard.ini")!, "");
  for (const line of ["SleepAllowed=true", "SleepNeeded=true", "PlayerSafehouse=true", "SafehouseAllowRespawn=true", "Faction=false"]) {
    assert.match(ini, new RegExp(`^${line}$`, "m"));
  }
  // And none of them is a world rule: each can change after the world exists.
  for (const key of ["sleepAllowed", "sleepNeeded", "playerSafehouse", "safehouseRespawn", "factions"]) assert.ok(!field(b42, key).fixedAfterCreation);
});

test("loot respawn is hours on build 42 and steps on build 41, and night length and the senses are world rules on both", () => {
  const lua = (game: GameDefinition, values: Record<string, string>) =>
    renderConfig(game, values, undefined, { creating: true }).files.find((f) => f.format === "lua")!.entries.map((e) => [e.key, e.value]);
  assert.deepEqual(lua(b42, { lootRespawn: "168", nightLength: "2", zombieSight: "5" }).slice(1), [
    ["NightLength", "2"],
    ["HoursForLootRespawn", "168"],
    ["ZombieLore.Sight", "5"],
  ]);
  assert.deepEqual(lua(b41, { lootRespawn: "3", zombieMemory: "5" }).slice(1), [
    ["LootRespawn", "3"],
    ["ZombieLore.Memory", "5"],
  ]);
  // Build 42's sixth memory step is not build 41's.
  assert.equal(validateConfig(b41, { zombieMemory: "6" }).length, 1);
  assert.equal(validateConfig(b42, { zombieMemory: "6" }).length, 0);
  for (const key of ["lootRespawn", "nightLength", "zombieMemory", "zombieSight", "zombieHearing"]) {
    assert.ok(field(b42, key).fixedAfterCreation && field(b41, key).fixedAfterCreation, key);
  }
});

test("the preset table covers every preset each build offers, and says each value as one of the setting's options", () => {
  for (const [line, game] of [["b42", b42], ["b41", b41]] as const) {
    const presets = field(game, "sandboxPreset").options!.map((o) => o.value);
    assert.deepEqual(Object.keys(ZOMBOID_PRESETS[line]).sort(), [...presets].sort(), line);
    for (const f of game.config.filter((f) => f.presetValues)) {
      for (const preset of presets) {
        const value = f.presetValues!.values[preset];
        assert.ok(value !== undefined, `${line} ${f.key} under ${preset}`);
        // Build 42's Outbreak has no one XP rate: the one value that is a sentence and not an option.
        if (value === "each skill at its own rate") continue;
        assert.ok(f.options!.some((o) => o.value !== "" && Number(o.value) === Number(value)), `${line} ${f.key} under ${preset}: ${value}`);
      }
    }
  }
  // Every world rule left to the preset says what it gives.
  for (const game of [b42, b41]) {
    for (const f of game.config.filter((f) => f.group === "World rules" && f.key !== "sandboxPreset")) assert.ok(f.presetValues, `${f.key}`);
  }
});

test("an empty world rule says what its preset gives, on the settings page and in the wizard as the preset changes", () => {
  const apocalypse = fieldsAsShown(b42.config, { sandboxPreset: "Apocalypse" });
  assert.equal(emptyLabel(apocalypse, "zombiePopulation"), "As the preset sets it: Normal");
  assert.equal(emptyLabel(apocalypse, "zombieSpeed"), "As the preset sets it: Random");
  assert.equal(emptyLabel(apocalypse, "dayLength"), "As the preset sets it: 1 hour 30 minutes");
  assert.equal(emptyLabel(apocalypse, "xpMultiplier"), "As the preset sets it: 1.0×");
  assert.equal(emptyLabel(apocalypse, "lootRespawn"), "As the preset sets it: Never");

  const later = fieldsAsShown(b42.config, { sandboxPreset: "SixMonthsLater" });
  assert.equal(emptyLabel(later, "zombiePopulation"), "As the preset sets it: Insane");
  assert.equal(emptyLabel(later, "startMonth"), "As the preset sets it: December");
  assert.equal(emptyLabel(later, "zombieRespawn"), "As the preset sets it: Normal", "the game's default, which this preset's file does not set");
  assert.equal(emptyLabel(fieldsAsShown(b42.config, { sandboxPreset: "Outbreak" }), "xpMultiplier"), "As the preset sets it: each skill at its own rate");

  // Build 41's Beginner turns water off at its eighth step, which the select did not offer before.
  assert.equal(emptyLabel(fieldsAsShown(b41.config, { sandboxPreset: "Beginner" }), "waterShutoff"), "As the preset sets it: 6 to 12 months");
  // Nothing stored yet: the preset's default.
  assert.equal(emptyLabel(fieldsAsShown(b41.config, {}), "zombieSpeed"), "As the preset sets it: Fast shamblers");
  // A chosen value is not touched, and neither is the definition.
  assert.equal(field(b42, "zombiePopulation").options![0]!.label, "As the preset sets it");
});

/* ── Terraria ──────────────────────────────────────────────────── */

test("Terraria has no language setting: in another language its server never says the line the panel waits for", () => {
  // Measured on vanilla 1.4.5.8: language=de-DE printed "Server gestartet". See the definition.
  assert.ok(!TERRARIA.config.some((f) => f.target.kind === "properties" && f.target.key === "language"));
  assert.equal(TERRARIA.health.readyPattern, "Server started");
});

/* ── Manifests ─────────────────────────────────────────────────── */

function terrariaManifest(): Record<string, any> {
  const m = JSON.parse(JSON.stringify(TERRARIA)) as Record<string, any>;
  m.manifest = 1;
  m.id = "community-terraria";
  m.family = "Terraria Community";
  delete m.official;
  delete m.versionSources;
  m.install = { kind: "image", env: TERRARIA.install.kind === "image" ? TERRARIA.install.env : {} };
  m.versions = m.versions.map((v: Record<string, any>) => ({ ...v, image: `${String(v.image)}@sha256:${createHash("sha256").update(String(v.image)).digest("hex")}` }));
  return m;
}

test("a manifest may share a variable between settings, and may not carry choices or a preset table", () => {
  const joined = terrariaManifest();
  joined.config.push(
    { key: "first", label: "First", type: "string", target: { kind: "env", name: "EXTRA_ARGS", joined: true }, default: "" },
    { key: "second", label: "Second", type: "string", target: { kind: "env", name: "EXTRA_ARGS", joined: true }, default: "" },
  );
  const accepted = validateManifest(joined);
  assert.ok(accepted.ok, JSON.stringify(!accepted.ok && accepted.problems.slice(0, 3)));

  const withChoices = terrariaManifest();
  withChoices.config[1].choices = { values: [{ value: "a", label: "A" }] };
  const refused = validateManifest(withChoices);
  assert.ok(!refused.ok && refused.problems.some((p) => p.path === "config[1].choices" && /shipped game's/.test(p.message)));

  const withTable = terrariaManifest();
  withTable.config[2].presetValues = { key: "worldSize", values: { "1": "0" } };
  const refusedTable = validateManifest(withTable);
  assert.ok(!refusedTable.ok && refusedTable.problems.some((p) => p.path === "config[2].presetValues" && /shipped game's/.test(p.message)));
});
