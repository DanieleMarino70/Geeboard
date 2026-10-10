import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, mergeCvars, readConfigValues, renderConfig } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";

/* Garry's Mod, as arithmetic: what reaches server.cfg, and whether the
   start script fits the agent's rules for arguments. The game itself was
   run for real while the definition was written — see its comments. */

const gmod = requireGame("garrys-mod");

function cfgOf(values: Record<string, string | number | boolean>, existing = "") {
  const rendered = renderConfig(gmod, values, gmod.versions[0], { creating: true });
  const patch = rendered.files.find((file) => file.path === "geeboard/server.cfg");
  assert.ok(patch, "the settings write server.cfg");
  return applyPatch(patch, existing);
}

test("server.cfg gets each setting as a quoted cvar, and a switch as 1 or 0", () => {
  const cfg = cfgOf({ serverName: "Friday night TTT", password: "hunter 2; really", allowClientLua: true });
  assert.match(cfg, /^hostname "Friday night TTT"$/m);
  assert.match(cfg, /^sv_password "hunter 2; really"$/m);
  // "true" would read as 0 to the engine.
  assert.match(cfg, /^sv_allowcslua "1"$/m);
});

test("a quote or a line break in a value is refused, not written", () => {
  assert.throws(() => cfgOf({ password: 'x" ; rcon_password "y' }), /double quote or a line break/);
  assert.throws(() => cfgOf({ serverName: "two\nlines" }), /double quote or a line break/);
});

test("the game's own lines and comments stay; the panel's are set where they already are", () => {
  const existing = '// my notes\nhostname "Old name"\nttt_traitor_pct 0.3\nHOSTNAME "older"\n';
  const merged = mergeCvars(existing, [
    { key: "hostname", value: "New" },
    { key: "sv_password", value: "pw" },
  ]);
  assert.equal(merged, '// my notes\nhostname "New"\nttt_traitor_pct 0.3\nHOSTNAME "New"\nsv_password "pw"\n');
});

test("what server.cfg holds is read back as the settings form shows it", () => {
  const values = readConfigValues(gmod, [
    { path: "geeboard/server.cfg", content: 'hostname "Read back"\nsv_allowcslua 0 // off\nsv_password "s3cret"\n' },
  ]);
  assert.equal(values.serverName, "Read back");
  assert.equal(values.allowClientLua, false);
  assert.equal(values.password, "s3cret");
});

test("the start script reaches the agent as arguments it accepts", () => {
  const args = gmod.versions[0]!.args!;
  // daemon/src/provision.ts: at most 32 arguments of 512 characters, no control characters.
  assert.ok(args.length <= 32);
  for (const arg of args) {
    assert.ok(arg.length <= 512, `an argument of ${arg.length} characters`);
    assert.doesNotMatch(arg, /[\x00-\x1f\x7f]/);
  }
  assert.deepEqual(args.slice(0, 4), ["bash", "-c", 'eval "$(printf %s "$@")"', "geeboard"]);
  const script = args.slice(4).join("");
  assert.match(script, /exec gosu steam bash -c 'set -o pipefail; script -qfec \/home\/gmod\/start\.sh/);
  // Only the lines of the panel's file that are a number are ever read as items.
  assert.match(script, /grep -oE '\^\[0-9\]\{1,20\}\$' workshop\.txt/);
});

test("a TTT server starts on a map the image has", () => {
  const ttt = gmod.templates.find((template) => template.id === "ttt");
  assert.equal(ttt?.config.gamemode, "terrortown");
  assert.equal(ttt?.config.map, "cs_office");
});
