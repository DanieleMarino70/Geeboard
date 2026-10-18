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

/* ── 1.1.0: what the game saves, the map rotation and the TTT settings ── */

test("cfg/server.vdf, where the game keeps what was set in it, is linked into the server's folder with server.cfg", () => {
  const script = gmod.versions[0]!.args!.slice(4).join("");
  assert.ok(script.includes("ln -sf $w/server.cfg $w/server.vdf $g/cfg;"), "both into cfg/, by their own names");
});

test("the map rotation reads one variable, takes only TTT maps' names from the server's own list, and shuffles them", () => {
  const script = gmod.versions[0]!.args!.slice(4).join("");
  const rotation = script.indexOf('[ "$MAPCYCLE" ]&&');
  assert.ok(rotation > script.indexOf(">>content.txt"), "after the list of what the addons brought is written");
  assert.ok(rotation < script.indexOf("exec gosu steam"), "before the game starts");
  assert.ok(script.includes(String.raw`sed -nE 's/^map (ttt2?_[^ ]+) .*/\1/p' content.txt|shuf >mapcycle.txt&&ln -sf $w/mapcycle.txt $g/cfg;`));
  // The only variable of a setting the script reads.
  assert.deepEqual([...new Set(script.match(/\$[A-Z][A-Z_]*/g))], ["$MAPCYCLE"]);
  // The addons are given to `steam` once, after the loop, not once an item.
  assert.equal(script.split("chown -R steam:steam $x").length - 1, 1);
  assert.ok(script.indexOf("chown -R steam:steam $x") > script.indexOf('was not downloaded";fi;done;'));
});

const tttKeys = () => gmod.config.filter((f) => f.shownWhen?.key === "gamemode").map((f) => f.key);

test("the TTT settings are a terrortown server's: a Sandbox one writes none of them and takes out any it had", () => {
  assert.ok(tttKeys().length > 20);
  const sandbox = renderConfig(gmod, { gamemode: "sandbox", roundMinutes: 12, mapRotation: "workshop" }, gmod.versions[0], { includeEmpty: true });
  assert.equal(sandbox.env.MAPCYCLE, undefined);
  const cfg = applyPatch(sandbox.files.find((f) => f.path === "geeboard/server.cfg")!, 'hostname "x"\nttt_roundtime_minutes "12"\nttt_round_limit "1"\n');
  assert.doesNotMatch(cfg, /ttt_/);
});

test("a TTT server with the rotation on plays one round a map unless told, and writes only what was set", () => {
  const rendered = renderConfig(gmod, { gamemode: "terrortown", mapRotation: "workshop", roundMinutes: 7, traitorShare: "0.3", karma: "0" }, gmod.versions[0], { creating: true });
  assert.equal(rendered.env.MAPCYCLE, "workshop");
  const cfg = applyPatch(rendered.files.find((f) => f.path === "geeboard/server.cfg")!, "");
  assert.match(cfg, /^ttt_round_limit "1"$/m);
  assert.match(cfg, /^ttt_roundtime_minutes "7"$/m);
  assert.match(cfg, /^ttt_traitor_pct "0\.3"$/m);
  assert.match(cfg, /^ttt_karma "0"$/m);
  // Empty is no line: the server keeps what its own default, or its admin menu, set.
  for (const unset of ["ttt_preptime_seconds", "ttt_haste", "ttt_detective_pct", "ttt_karma_low_autokick"]) assert.doesNotMatch(cfg, new RegExp(unset));
});

test("with the rotation off, the round limit is not written, so TTT keeps its own and the map is not reloaded after every round", () => {
  const rendered = renderConfig(gmod, { gamemode: "terrortown", mapRotation: "", roundsPerMap: 1 }, gmod.versions[0], { includeEmpty: true });
  const cfg = applyPatch(rendered.files.find((f) => f.path === "geeboard/server.cfg")!, 'ttt_round_limit "1"\n');
  assert.doesNotMatch(cfg, /ttt_round_limit/);
});

test("every TTT variable is one both the TTT that comes with the game and TTT2 create", () => {
  // Read off the image's gamemodes/terrortown and TTT2 0.14.6b's Lua, October 2026.
  const both = new Set([
    "ttt_round_limit", "ttt_roundtime_minutes", "ttt_haste", "ttt_preptime_seconds", "ttt_posttime_seconds", "ttt_minimum_players",
    "ttt_firstpreptime", "ttt_haste_starting_minutes", "ttt_time_limit_minutes", "ttt_postround_dm", "ttt_idle_limit",
    "ttt_traitor_pct", "ttt_detective_pct", "ttt_detective_min_players", "ttt_traitor_max", "ttt_detective_max",
    "ttt_karma", "ttt_karma_low_autokick", "ttt_karma_low_amount", "ttt_karma_low_ban", "ttt_karma_low_ban_minutes",
    "ttt_karma_strict", "ttt_karma_persist",
  ]);
  const written = gmod.config.flatMap((f) => (f.target.kind === "cvar" && f.target.name.startsWith("ttt_") ? [f.target.name] : []));
  assert.deepEqual(new Set(written), both);
});
