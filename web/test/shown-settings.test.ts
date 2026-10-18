import assert from "node:assert/strict";
import { test } from "node:test";
import { auditDefinition } from "../src/domain/games/audit.ts";
import { applyPatch, mergeCvars, renderConfig, settingShown, validateConfig } from "../src/domain/games/config.ts";
import { TERRARIA } from "../src/domain/games/definitions/terraria.ts";
import type { ConfigField, GameDefinition } from "../src/domain/games/types.ts";

/* A setting shown by another one's value (`shownWhen`), and one taken out of its file when empty (`unsetWhenEmpty`): drawn,
   checked and written by one rule, so that what the form hides is what the render leaves out. Garry's Mod's TTT settings are
   the case (test/garrys-mod.test.ts); this is the rule on a game made up for it. */

const CFG = "server.cfg";
const fields: ConfigField[] = [
  {
    key: "mode",
    label: "Mode",
    type: "enum",
    default: "plain",
    options: [{ value: "plain", label: "Plain" }, { value: "rounds", label: "Rounds" }],
    target: { kind: "env", name: "MODE" },
  },
  {
    key: "rotation",
    label: "Rotation",
    type: "enum",
    default: "",
    options: [{ value: "", label: "Off" }, { value: "on", label: "On" }],
    shownWhen: { key: "mode", oneOf: ["rounds"] },
    target: { kind: "env", name: "ROTATE" },
  },
  {
    key: "roundsPerMap",
    label: "Rounds per map",
    type: "number",
    default: 1,
    min: 1,
    max: 50,
    shownWhen: { key: "rotation", oneOf: ["on"] },
    target: { kind: "cvar", file: CFG, name: "round_limit" },
  },
  {
    key: "roundMinutes",
    label: "Round length",
    type: "number",
    default: "",
    min: 1,
    max: 60,
    unsetWhenEmpty: true,
    shownWhen: { key: "mode", oneOf: ["rounds"] },
    target: { kind: "cvar", file: CFG, name: "roundtime" },
  },
  { key: "name", label: "Name", type: "string", default: "x", target: { kind: "cvar", file: CFG, name: "hostname" } },
];
const game = { ...TERRARIA, id: "testland", name: "Testland", config: fields, templates: [] } as GameDefinition;
const field = (key: string) => fields.find((f) => f.key === key)!;

function cfg(values: Record<string, string | number | boolean>, existing: string, options: Parameters<typeof renderConfig>[3] = {}) {
  const rendered = renderConfig(game, values, undefined, options);
  const patch = rendered.files.find((f) => f.path === CFG);
  return { env: rendered.env, file: patch ? applyPatch(patch, existing) : existing };
}

test("a setting is shown while the one it reads has one of its values, and that one is shown too", () => {
  assert.equal(settingShown(game, field("rotation"), { mode: "plain" }), false);
  assert.equal(settingShown(game, field("rotation"), { mode: "rounds" }), true);
  // Its own rule holds and the one above it does not: hidden, as the form would hide the setting it reads.
  assert.equal(settingShown(game, field("roundsPerMap"), { mode: "plain", rotation: "on" }), false);
  assert.equal(settingShown(game, field("roundsPerMap"), { mode: "rounds", rotation: "on" }), true);
  // A value left out is the default's.
  assert.equal(settingShown(game, field("roundsPerMap"), { mode: "rounds" }), false);
  assert.equal(settingShown(game, field("name"), {}), true);
});

test("a hidden setting is not written, and the line it wrote is taken out", () => {
  const before = 'hostname "x"\nround_limit "1"\nroundtime "12"\n// mine\n';
  const { env, file } = cfg({ mode: "plain", rotation: "on", roundsPerMap: 1, roundMinutes: 12 }, before);
  assert.equal(env.ROTATE, undefined, "a hidden variable is left out");
  assert.equal(file, 'hostname "x"\n// mine\n');
});

test("shown, it is written; turning the rotation off takes its round limit back out", () => {
  const on = cfg({ mode: "rounds", rotation: "on", roundsPerMap: 2, roundMinutes: 12 }, "");
  assert.equal(on.env.ROTATE, "on");
  assert.match(on.file, /^round_limit "2"$/m);
  assert.match(on.file, /^roundtime "12"$/m);
  const off = cfg({ mode: "rounds", rotation: "", roundsPerMap: 2, roundMinutes: 12 }, on.file, { includeEmpty: true });
  assert.doesNotMatch(off.file, /round_limit/);
  assert.match(off.file, /^roundtime "12"$/m);
});

test("empty, a setting taken out when empty writes no line at first and takes its line out on a save", () => {
  const made = cfg({ mode: "rounds", roundMinutes: "" }, "", { creating: true });
  assert.doesNotMatch(made.file, /roundtime/);
  const saved = cfg({ mode: "rounds", roundMinutes: "" }, 'roundtime "12"\n', { includeEmpty: true });
  assert.doesNotMatch(saved.file, /roundtime/, "not written as an empty value, which the engine reads as 0");
});

test("a file's line the panel was never given is left as it is, hidden or not", () => {
  const { file } = cfg({ mode: "plain" }, 'round_limit "6"\n', { includeEmpty: true, stored: { mode: "plain" } });
  assert.equal(file, 'round_limit "6"\n');
});

test("a cvar to remove goes from every line that sets it, in any case, and is not added", () => {
  assert.equal(mergeCvars('a "1"\nROUND_LIMIT 3\nround_limit "1"\nb 2\n', [{ key: "round_limit", value: "", remove: true }]), 'a "1"\nb 2\n');
  assert.equal(mergeCvars('a "1"\n', [{ key: "round_limit", value: "", remove: true }]), 'a "1"\n');
});

test("a number taken out when empty may be empty; a hidden one is not checked at all", () => {
  const messages = (values: Record<string, unknown>) => validateConfig(game, values as never).map((p) => `${p.label} ${p.message}`);
  assert.deepEqual(messages({ mode: "rounds", roundMinutes: "" }), []);
  assert.deepEqual(messages({ mode: "rounds", roundMinutes: 99 }), ["Round length must be at most 60"]);
  // What a form still holds for a setting the save hides must not stop the save.
  assert.deepEqual(messages({ mode: "plain", roundMinutes: 99 }), []);
  // Any other number is still a number.
  assert.deepEqual(messages({ mode: "rounds", rotation: "on", roundsPerMap: "" }), ["Rounds per map must be a number"]);
});

test("the audit holds both to what they can mean", () => {
  const with_ = (changed: Partial<ConfigField>, key = "roundMinutes") =>
    auditDefinition({ ...game, config: fields.map((f) => (f.key === key ? ({ ...f, ...changed } as ConfigField) : f)) });
  assert.deepEqual(auditDefinition(game), []);
  assert.ok(with_({ shownWhen: { key: "nothing", oneOf: ["x"] } }).some((p) => /refers to a setting "nothing"/.test(p)));
  assert.ok(with_({ shownWhen: { key: "mode", oneOf: ["sideways"] } }).some((p) => /which it does not offer/.test(p)));
  assert.ok(with_({ shownWhen: { key: "roundsPerMap", oneOf: [1] } }, "rotation").some((p) => /comes back to itself/.test(p)));
  assert.ok(with_({ target: { kind: "properties", file: "x.properties", key: "k" } }).some((p) => /not an environment variable or a cvar/.test(p)));
  assert.ok(with_({ unsetWhenEmpty: undefined }).some((p) => /starts empty and is not taken out/.test(p)));
  assert.ok(with_({ default: 10 }).some((p) => /does not start empty/.test(p)));
  assert.ok(with_({ target: { kind: "env", name: "R" } }).some((p) => /taken out of its file when empty and is not a cvar/.test(p)));
});
