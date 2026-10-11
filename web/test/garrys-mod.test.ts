import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, mergeCvars, noticeApplies, noticesFor, readConfigValues, renderConfig } from "../src/domain/games/config.ts";
import { requireGame } from "../src/domain/games/registry.ts";
import { playerEvents } from "../src/domain/servers/players.ts";

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
  // A manifest carries at most 16, of 200 (domain/games/manifest.ts), and a shipped definition passes as one.
  assert.ok(args.length <= 16, `${args.length} arguments`);
  for (const arg of args) {
    assert.ok(arg.length <= 200, `an argument of ${arg.length} characters`);
    assert.doesNotMatch(arg, /[\x00-\x1f\x7f]/);
  }
  assert.deepEqual(args.slice(0, 4), ["bash", "-c", 'eval "$(printf %s "$@")"', "geeboard"]);
  const script = args.slice(4).join("");
  assert.match(script, /exec gosu steam bash -c 'set -o pipefail; script -qfec \/home\/gmod\/start\.sh/);
  // Only the lines of the panel's file that are a number are ever read as items.
  assert.match(script, /grep -oE '\^\[0-9\]\{1,20\}\$' workshop\.txt/);
});

test("an empty workshop.lua gets a comment, so the game does not log an [ERROR] including it", () => {
  const script = gmod.versions[0]!.args!.slice(4).join("");
  const filled = script.indexOf("[ -s workshop.lua ] || echo '-- Geeboard: no Workshop items' > workshop.lua;");
  assert.ok(filled > script.indexOf("touch server.cfg workshop.txt workshop.lua;"), "after the touch that makes it");
  assert.ok(filled < script.indexOf("ln -sf $w/workshop.lua"), "before the game is pointed at it");
});

test("after SteamCMD, one line in Geeboard's words says what the check with Steam did", () => {
  const script = gmod.versions[0]!.args!.slice(4).join("");
  // The marker is touched before SteamCMD runs, and the items are counted against it after.
  const marker = script.indexOf("touch $t;");
  const steamcmd = script.indexOf("+workshop_download_item");
  const counted = script.indexOf("find $c/$i -newer $t");
  assert.ok(marker > 0 && marker < steamcmd && steamcmd < counted);
  assert.match(script, /echo "Geeboard: \$n Workshop item\$\(\[ \$n = 1 \] \|\| echo s\) checked with Steam — \$k downloaded or updated, \$\(\(n-k-u\)\) already up to date, \$u not available/);
  // And still a line per item.
  assert.match(script, /echo "Geeboard: Workshop item \$i is mounted"/);
  assert.match(script, /echo "Geeboard: Workshop item \$i was not downloaded"/);
});

test("a player's game joining and leaving, as the console printed it on 11 October 2026", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 11, 12, 0, s)).toISOString();
  const events = playerEvents(gmod.console, [
    { line: 'Client "Danielao70" connected (203.0.113.7:27005).', at: at(1) },
    { line: "Dropped Danielao70 (76561198116147268) from server (Map maps/cs_office.bsp is missing)", at: at(9) },
    // A bot kicked from the console, seen while the definition was written.
    { line: "Dropped Bot01 (0) from server (Kicked from server)", at: at(12) },
  ]);
  assert.deepEqual(
    events.map((e) => [e.kind, e.name]),
    [
      ["join", "Danielao70"],
      ["leave", "Danielao70"],
      ["leave", "Bot01"],
    ],
  );
});

test("a TTT server starts on a map the image has", () => {
  const ttt = gmod.templates.find((template) => template.id === "ttt");
  assert.equal(ttt?.config.gamemode, "terrortown");
  assert.equal(ttt?.config.map, "cs_office");
});

test("a Counter-Strike: Source map tells people that every player's game needs CS:S content, and where to get it", () => {
  const map = gmod.config.find((field) => field.key === "map")!;
  for (const css of ["cs_office", "de_dust2", "de_dust", "cs_italy", "de_train"]) assert.ok(noticeApplies(map, css), css);
  // The whole value: a Workshop map with a CS:S name in it is not one, and neither are the game's own.
  for (const other of ["gm_construct", "gm_flatgrass", "ttt_minecraft_b5", "de_dust2_remake", "xcs_office", "CS_OFFICE"]) {
    assert.ok(!noticeApplies(map, other), other);
  }
  const said = map.notice!.text.join(" ");
  assert.match(said, /Owning Counter-Strike: Source on Steam/);
  assert.match(said, /Counter-Strike: Source content pack and CS:S maps pack/);
  assert.match(said, /unofficial site that is neither Valve's nor Geeboard's/);
  assert.ok(said.includes("garrysmod\\addons"), "the folder, as Windows writes it");
  assert.match(said, /add it on the Mods tab/);
  assert.equal(map.notice!.link?.href, "https://gmodcontent.com/");
  assert.match(map.help!, /every player's game needs CS:S content/);

  // The Overview shows it while the server is on one, and not otherwise.
  const ttt = gmod.templates.find((template) => template.id === "ttt")!;
  assert.deepEqual(noticesFor(gmod, { ...ttt.config }).map(({ field }) => field.key), ["map"]);
  assert.deepEqual(noticesFor(gmod, { map: "gm_construct" }), []);
  assert.match(ttt.blurb, /players need Counter-Strike: Source content/);
});
